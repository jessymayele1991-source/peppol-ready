import type { MembershipRole } from "@prisma/client";
import { verifyPassword } from "@workspace/password";
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
 * Verifies credentials in constant time with respect to whether the account
 * exists: an unknown email still runs a hash comparison against null, which
 * verifyPassword answers with false rather than an early return upstream.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ userId: string; organizationId: string } | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
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
