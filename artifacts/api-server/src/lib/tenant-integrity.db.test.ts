import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the tenant boundary is enforced by PostgreSQL itself, with no API code
 * involved. Requires a database migrated to the current schema:
 *
 *   TEST_DATABASE_URL=postgresql://… pnpm --filter @workspace/api-server run test
 *
 * Skipped when TEST_DATABASE_URL is unset. Every row it creates hangs off two
 * organizations with a unique suffix, removed by cascade afterwards.
 */
const url = process.env["TEST_DATABASE_URL"];

describe.skipIf(!url)("tenant integrity in the database", () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const run = randomUUID().slice(0, 8);
  const id = (name: string) => `${name}_${run}`;

  const orgA = id("org_a");
  const orgB = id("org_b");
  const companyA = id("company_a");
  const companyB = id("company_b");
  const memberA = id("user_member_a");
  const memberB = id("user_member_b");

  /** Constraint violations surface through Prisma with the constraint's name. */
  async function expectRejected(write: Promise<unknown>, pattern: RegExp) {
    await expect(write).rejects.toThrow(pattern);
  }

  /**
   * The membership trigger raises foreign_key_violation. Prisma reports that as
   * P2003 but, unlike a real foreign key, with no constraint name — which is how
   * these tests tell the trigger apart from the ordinary user foreign keys, all
   * of which are satisfied here because every referenced user exists.
   */
  async function expectMembershipRejected(write: Promise<unknown>) {
    await expect(write).rejects.toMatchObject({ code: "P2003", meta: { constraint: null } });
  }

  beforeAll(async () => {
    await db.organization.createMany({
      data: [
        { id: orgA, name: "Firm A", slug: id("firm-a") },
        { id: orgB, name: "Firm B", slug: id("firm-b") },
      ],
    });
    await db.user.createMany({
      data: [
        { id: memberA, name: "Member A", email: `${memberA}@firm.test` },
        { id: memberB, name: "Member B", email: `${memberB}@firm.test` },
      ],
    });
    await db.membership.createMany({
      data: [
        { organizationId: orgA, userId: memberA, role: "MEMBER" },
        { organizationId: orgB, userId: memberB, role: "MEMBER" },
      ],
    });
    await db.company.createMany({
      data: [
        { id: companyA, organizationId: orgA, name: "Client of A" },
        { id: companyB, organizationId: orgB, name: "Client of B" },
      ],
    });
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: { in: [memberA, memberB] } } });
    await db.$disconnect();
  });

  describe("company references", () => {
    it("refuses a task pointing at another organization's company", async () => {
      await expectRejected(
        db.task.create({ data: { organizationId: orgA, companyId: companyB, title: "cross-tenant" } }),
        /tasks_companyId_organizationId_fkey/,
      );
    });

    it("refuses an incident pointing at another organization's company", async () => {
      await expectRejected(
        db.incident.create({ data: { organizationId: orgA, companyId: companyB, title: "cross-tenant", occurredAt: new Date() } }),
        /incidents_companyId_organizationId_fkey/,
      );
    });

    it("refuses a report pointing at another organization's company", async () => {
      await expectRejected(
        db.report.create({ data: { organizationId: orgA, companyId: companyB, type: "READINESS" } }),
        /reports_companyId_organizationId_fkey/,
      );
    });

    it("refuses moving an existing task onto another organization's company", async () => {
      const task = await db.task.create({ data: { organizationId: orgA, companyId: companyA, title: "own" } });
      await expectRejected(
        db.task.update({ where: { id: task.id }, data: { companyId: companyB } }),
        /tasks_companyId_organizationId_fkey/,
      );
    });

    it("accepts references inside the organization, and none at all", async () => {
      await expect(db.task.create({ data: { organizationId: orgA, companyId: companyA, title: "own" } })).resolves.toBeTruthy();
      await expect(db.incident.create({ data: { organizationId: orgA, companyId: companyA, title: "own", occurredAt: new Date() } })).resolves.toBeTruthy();
      await expect(db.report.create({ data: { organizationId: orgA, companyId: companyA, type: "READINESS" } })).resolves.toBeTruthy();
      await expect(db.task.create({ data: { organizationId: orgA, title: "no company" } })).resolves.toBeTruthy();
    });

    it("still clears companyId when a company is deleted", async () => {
      const doomed = await db.company.create({ data: { id: id("company_doomed"), organizationId: orgA, name: "Doomed" } });
      const task = await db.task.create({ data: { organizationId: orgA, companyId: doomed.id, title: "orphaned" } });

      await db.company.delete({ where: { id: doomed.id } });

      expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).companyId).toBeNull();
    });
  });

  describe("user references", () => {
    it("refuses assigning a task to a member of another organization", async () => {
      await expectMembershipRejected(
        db.task.create({ data: { organizationId: orgA, assignedToId: memberB, title: "cross-tenant assignee" } }),
      );
    });

    it("refuses crediting a task's creation to a non-member", async () => {
      await expectMembershipRejected(
        db.task.create({ data: { organizationId: orgA, createdById: memberB, title: "cross-tenant creator" } }),
      );
    });

    it("refuses a report generated by a non-member", async () => {
      await expectMembershipRejected(
        db.report.create({ data: { organizationId: orgA, generatedById: memberB, type: "RISK" } }),
      );
    });

    it("refuses a readiness scan completed by a member of another organization", async () => {
      await expectMembershipRejected(
        db.readinessScan.create({ data: { companyId: companyA, completedById: memberB, score: 50, category: "ADVANCED", completedAt: new Date() } }),
      );
    });

    it("names the column and organization when refusing, at the SQL level", async () => {
      await expect(
        db.$executeRaw`INSERT INTO "tasks" ("id", "organizationId", "assignedToId", "title", "updatedAt")
                       VALUES (${id("task_raw")}, ${orgA}, ${memberB}, 'raw', now())`,
      ).rejects.toThrow(`tasks.assignedToId must reference a member of organization ${orgA}`);
    });

    it("accepts members of the row's own organization", async () => {
      await expect(db.task.create({ data: { organizationId: orgA, assignedToId: memberA, createdById: memberA, title: "own" } })).resolves.toBeTruthy();
      await expect(db.report.create({ data: { organizationId: orgA, generatedById: memberA, type: "RISK" } })).resolves.toBeTruthy();
      await expect(db.readinessScan.create({ data: { companyId: companyA, completedById: memberA, score: 50, category: "ADVANCED" } })).resolves.toBeTruthy();
    });

    it("keeps history when a member leaves, and refuses new assignments to them", async () => {
      const leaver = id("user_leaver");
      await db.user.create({ data: { id: leaver, name: "Leaver", email: `${leaver}@firm.test` } });
      await db.membership.create({ data: { organizationId: orgA, userId: leaver } });
      const task = await db.task.create({ data: { organizationId: orgA, assignedToId: leaver, title: "assigned before leaving" } });

      await db.membership.delete({ where: { organizationId_userId: { organizationId: orgA, userId: leaver } } });

      // Unrelated edits to the historical row still work.
      await expect(db.task.update({ where: { id: task.id }, data: { status: "COMPLETED" } })).resolves.toBeTruthy();
      // A new assignment does not.
      await expectMembershipRejected(
        db.task.create({ data: { organizationId: orgA, assignedToId: leaver, title: "assigned after leaving" } }),
      );

      await db.task.delete({ where: { id: task.id } });
      await db.user.delete({ where: { id: leaver } });
    });

    it("refuses moving a task to another organization while keeping its assignee", async () => {
      const task = await db.task.create({ data: { organizationId: orgA, assignedToId: memberA, title: "movable" } });
      await expectMembershipRejected(
        db.task.update({ where: { id: task.id }, data: { organizationId: orgB } }),
      );
    });
  });

  describe("assessment timestamps", () => {
    const answers = { score: 80, status: "CONFIGURING" as const, source: "manual_assessment" };

    it("refuses a readiness score dated in the future", async () => {
      await expectRejected(
        db.readinessScore.create({ data: { ...answers, companyId: companyA, checkedAt: new Date(Date.now() + 60 * 60 * 1000) } }),
        /readiness_scores_checkedAt_not_future/,
      );
    });

    it("refuses a company whose last check lies in the future", async () => {
      await expectRejected(
        db.company.update({ where: { id: companyA }, data: { lastCheckedAt: new Date("2099-01-01T00:00:00Z") } }),
        /companies_lastCheckedAt_not_future/,
      );
    });

    it("refuses a readiness scan completed in the future", async () => {
      await expectRejected(
        db.readinessScan.create({ data: { companyId: companyA, score: 50, category: "ADVANCED", completedAt: new Date("2099-01-01T00:00:00Z") } }),
        /readiness_scans_completedAt_not_future/,
      );
    });

    it("accepts the present and the past", async () => {
      await expect(db.readinessScore.create({ data: { ...answers, companyId: companyA, checkedAt: new Date() } })).resolves.toBeTruthy();
      await expect(db.readinessScore.create({ data: { ...answers, companyId: companyA, checkedAt: new Date("2025-01-01T00:00:00Z") } })).resolves.toBeTruthy();
    });
  });

  describe("migration", () => {
    it("is recorded as applied and not rolled back", async () => {
      const rows = await db.$queryRaw<Array<{ finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT finished_at, rolled_back_at FROM "_prisma_migrations"
        WHERE migration_name = '20260912120000_tenant_integrity'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.finished_at).not.toBeNull();
      expect(rows[0]?.rolled_back_at).toBeNull();
    });

    it("installed every enforcement object", async () => {
      const constraints = await db.$queryRaw<Array<{ conname: string }>>`
        SELECT conname FROM pg_constraint WHERE conname IN (
          'tasks_companyId_organizationId_fkey', 'incidents_companyId_organizationId_fkey',
          'reports_companyId_organizationId_fkey', 'readiness_scores_checkedAt_not_future',
          'companies_lastCheckedAt_not_future', 'readiness_scans_startedAt_not_future',
          'readiness_scans_completedAt_not_future')`;
      const triggers = await db.$queryRaw<Array<{ tgname: string }>>`
        SELECT tgname FROM pg_trigger WHERE tgname IN (
          'tasks_enforce_tenant_membership', 'reports_enforce_tenant_membership',
          'readiness_scans_enforce_tenant_membership')`;
      expect(constraints).toHaveLength(7);
      expect(triggers).toHaveLength(3);
    });

    it("deleting an organization still cascades through everything it owns", async () => {
      const org = id("org_cascade");
      const user = id("user_cascade");
      await db.organization.create({ data: { id: org, name: "Cascade", slug: id("cascade") } });
      await db.user.create({ data: { id: user, name: "Cascade", email: `${user}@firm.test` } });
      await db.membership.create({ data: { organizationId: org, userId: user } });
      const company = await db.company.create({ data: { organizationId: org, name: "Cascade client" } });
      await db.task.create({ data: { organizationId: org, companyId: company.id, assignedToId: user, title: "cascade" } });
      await db.incident.create({ data: { organizationId: org, companyId: company.id, title: "cascade", occurredAt: new Date() } });

      await expect(db.organization.delete({ where: { id: org } })).resolves.toBeTruthy();
      expect(await db.task.count({ where: { organizationId: org } })).toBe(0);
      await db.user.delete({ where: { id: user } });
    });
  });
});
