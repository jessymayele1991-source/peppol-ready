import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { verifyPassword } from "@workspace/password";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Registration against PostgreSQL: the organization, user, OWNER membership and
 * audit event commit together or not at all. Requires a migrated database:
 *
 *   TEST_DATABASE_URL=postgresql://… pnpm --filter @workspace/api-server run test
 *
 * Skipped when TEST_DATABASE_URL is unset. Accounts use a unique suffix and are
 * removed afterwards, their organizations by cascade.
 */
const url = process.env["TEST_DATABASE_URL"];

describe.skipIf(!url)("registration in the database", async () => {
  // The service uses the application's Prisma client, which reads DATABASE_URL
  // on its first query.
  process.env["DATABASE_URL"] = url;
  const { EmailInUseError, registerAccount } = await import("./auth-service");

  const db = new PrismaClient({ datasourceUrl: url });
  const run = randomUUID().slice(0, 8);
  const email = (name: string) => `${name}.${run}@registration.test`;
  const context = { ip: "203.0.113.7", userAgent: "registration-db-test" };
  const PASSWORD = "a long enough password";

  afterAll(async () => {
    const users = await db.user.findMany({
      where: { email: { endsWith: `.${run}@registration.test` } },
      select: { id: true, memberships: { select: { organizationId: true } } },
    });
    const organizationIds = users.flatMap((user) => user.memberships.map((m) => m.organizationId));
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    await db.$disconnect();
  });

  it("commits the organization, user, OWNER membership and audit event together", async () => {
    const { userId, organizationId } = await registerAccount(
      { name: "Eigenaar Database", email: email("owner"), password: PASSWORD },
      context,
    );

    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const organization = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const membership = await db.membership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId, userId } },
    });
    const audit = await db.auditEvent.findMany({ where: { organizationId } });

    expect(user.email).toBe(email("owner"));
    expect(await verifyPassword(PASSWORD, user.passwordHash)).toBe(true);
    expect(organization).toMatchObject({ name: "Eigenaar Database", plan: "PROFESSIONAL" });
    expect(membership.role).toBe("OWNER");
    expect(audit).toEqual([
      expect.objectContaining({ eventType: "auth.registered", actorId: userId, metadata: context }),
    ]);
  });

  it("gives two firms with the same name different slugs", async () => {
    const first = await registerAccount({ name: "Zelfde Naam", email: email("same-a"), password: PASSWORD }, context);
    const second = await registerAccount({ name: "Zelfde Naam", email: email("same-b"), password: PASSWORD }, context);

    const [a, b] = await Promise.all([
      db.organization.findUniqueOrThrow({ where: { id: first.organizationId } }),
      db.organization.findUniqueOrThrow({ where: { id: second.organizationId } }),
    ]);
    expect(a.slug).not.toBe(b.slug);
  });

  it("refuses an existing address without creating an organization", async () => {
    await registerAccount({ name: "Eerste", email: email("taken"), password: PASSWORD }, context);

    await expect(
      registerAccount({ name: `Tweede ${run}`, email: email("taken").toUpperCase(), password: PASSWORD }, context),
    ).rejects.toBeInstanceOf(EmailInUseError);
    // Counted by a name unique to this run: other test files write organizations concurrently.
    expect(await db.organization.count({ where: { name: `Tweede ${run}` } })).toBe(0);
  });

  it("lets exactly one of two simultaneous registrations for one address win, and rolls the other back", async () => {
    const names = [`Race Een ${run}`, `Race Twee ${run}`];
    const results = await Promise.allSettled(
      names.map((name) => registerAccount({ name, email: email("race"), password: PASSWORD }, context)),
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(EmailInUseError);

    // The loser's organization was created inside its transaction and must be gone.
    expect(await db.organization.count({ where: { name: { in: names } } })).toBe(1);
    expect(await db.user.count({ where: { email: email("race") } })).toBe(1);
  });
});
