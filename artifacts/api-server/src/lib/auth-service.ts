import { randomBytes } from "node:crypto";
import { MembershipRole, Prisma } from "@prisma/client";
import { hashPassword, verifyPassword } from "@workspace/password";
import { AUTH_EVENTS, authEvent } from "./auth-audit";
import { prisma } from "./prisma";
import { capabilitiesForRole, type Capability } from "./permissions";

export type SessionPayload = {
  user: {
    id: string;
    name: string;
    email: string;
    avatarInitials: string;
    preferredLocale: string;
  };
  organization: { id: string; name: string; plan: string };
  role: MembershipRole;
  capabilities: Capability[];
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    role: MembershipRole;
  }>;
};

/**
 * avatarInitials is nullable in the database but required by the contract, so
 * the fallback lives here rather than in every consumer.
 */
export function deriveInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "?";
}

/**
 * The one normalization for sign-in emails. The credential lookup and the
 * per-account rate limit both key on it, so casing or padding cannot be used
 * to spread attempts across separate counters.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const membershipSelect = {
  organizationId: true,
  role: true,
  organization: { select: { id: true, name: true, plan: true } },
} as const;

/**
 * Never selects passwordHash. Ordered by organization name so the workspace
 * switcher does not have to sort.
 */
const userSelect = {
  id: true,
  name: true,
  email: true,
  avatarInitials: true,
  preferredLocale: true,
  memberships: {
    select: membershipSelect,
    orderBy: { organization: { name: "asc" } },
  },
} as const;

/**
 * Response time does not depend on whether the account exists: the user lookup
 * runs for every email, and verifyPassword performs the full scrypt derivation
 * against a stand-in hash when there is no user or no stored hash. Membership
 * is only inspected after verification, so an account without a workspace
 * costs the same as a wrong password.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ userId: string; organizationId: string } | null> {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, passwordHash: true, memberships: { select: membershipSelect, orderBy: { organization: { name: "asc" } } } },
  });

  const passwordMatches = await verifyPassword(
    password,
    user?.passwordHash ?? null,
  );
  if (!user || !passwordMatches) return null;

  // A user without a membership has no tenant to act in, so there is nothing
  // to sign in to.
  const firstMembership = user.memberships[0];
  if (!firstMembership) return null;

  return { userId: user.id, organizationId: firstMembership.organizationId };
}

/**
 * Builds the session payload, and returns null whenever the stored session no
 * longer matches reality — a deleted user, or a membership that was revoked
 * while the session was alive.
 */
export async function loadSession(
  userId: string,
  organizationId: string,
): Promise<SessionPayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userSelect,
  });
  if (!user) return null;

  const active = user.memberships.find(
    (membership) => membership.organizationId === organizationId,
  );
  if (!active) return null;

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarInitials: user.avatarInitials ?? deriveInitials(user.name),
      preferredLocale: user.preferredLocale,
    },
    organization: {
      id: active.organization.id,
      name: active.organization.name,
      plan: active.organization.plan,
    },
    role: active.role,
    capabilities: capabilitiesForRole(active.role),
    memberships: user.memberships.map((membership) => ({
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      role: membership.role,
    })),
  };
}

/**
 * Confirms the signed-in user is a member of the target organization. Without
 * this check the tenant boundary removed from the query string would simply
 * reappear here.
 */
export async function canAccessOrganization(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true },
  });

  return membership !== null;
}

/** Raised when the email address already belongs to an account. */
export class EmailInUseError extends Error {
  constructor() {
    super("An account with this email address already exists.");
    this.name = "EmailInUseError";
  }
}

/**
 * A deliberately loose shape check: something@domain.tld with no spaces. The
 * contract cannot express it (format: email generates a Zod helper this
 * workspace's Zod does not have), and real validity is only ever proven by
 * delivering mail to the address.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(email: string): boolean {
  return EMAIL_SHAPE.test(email);
}

/** Collapses runs of whitespace so "  Elise   Martin " is stored as "Elise Martin". */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * URL-safe and unique: a readable part from the name plus a random suffix, so
 * two firms with the same name never collide on the unique slug.
 */
export function organizationSlug(name: string): string {
  const readable = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const suffix = randomBytes(4).toString("hex");
  return readable ? `${readable}-${suffix}` : `workspace-${suffix}`;
}

function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.["target"];
  return Array.isArray(target) ? target.includes(field) : String(target ?? "").includes(field);
}

/**
 * Creates an account for someone who has none: a new organization, the user,
 * and an OWNER membership linking them, with an `auth.registered` audit event —
 * all in one transaction, so a failure leaves no organization without an owner
 * and no user without a workspace.
 *
 * The organization is named after the person; renaming it belongs to the
 * workspace settings. Returns the same shape as verifyCredentials, so the caller
 * starts the session exactly as sign-in does.
 */
export async function registerAccount(
  input: { name: string; email: string; password: string },
  context: { ip: string | null; userAgent: string | null },
): Promise<{ userId: string; organizationId: string }> {
  const name = normalizeName(input.name);
  const email = normalizeEmail(input.email);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new EmailInUseError();

  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name, slug: organizationSlug(name) },
        select: { id: true },
      });
      const user = await tx.user.create({
        data: { name, email, passwordHash },
        select: { id: true },
      });
      await tx.membership.create({
        data: { organizationId: organization.id, userId: user.id, role: MembershipRole.OWNER },
      });
      await tx.auditEvent.create({
        data: authEvent({
          eventType: AUTH_EVENTS.registered,
          organizationId: organization.id,
          userId: user.id,
          metadata: context,
        }),
      });

      return { userId: user.id, organizationId: organization.id };
    });
  } catch (error) {
    // Two registrations for one address can both pass the check above; the
    // unique index decides, and the loser's transaction — its organization
    // included — is rolled back.
    if (isUniqueViolationOn(error, "email")) throw new EmailInUseError();
    throw error;
  }
}
