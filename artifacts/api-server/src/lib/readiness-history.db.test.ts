import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A client's assessment history against PostgreSQL: the order it comes back in,
 * the change against the previous assessment including the rule that a change in
 * scoring rules is never presented as progress, who recorded it, and the tenant
 * boundary of a single assessment. Requires a migrated database:
 *
 *   TEST_DATABASE_URL=postgresql://… pnpm --filter @workspace/api-server run test
 *
 * Skipped when TEST_DATABASE_URL is unset.
 */
const url = process.env["TEST_DATABASE_URL"];

vi.mock("./logger", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
});

describe.skipIf(!url)("assessment history in the database", async () => {
  process.env["DATABASE_URL"] = url;
  const { listCompanyAssessments, getCompanyAssessment, getLatestCompanyAssessment, calculateAndPersistCompanyReadiness } =
    await import("./readiness-service");

  const db = new PrismaClient({ datasourceUrl: url });
  const run = randomUUID().slice(0, 8);
  const id = (name: string) => `${name}_${run}`;
  const orgA = id("org_a");
  const orgB = id("org_b");
  const actorA = { userId: id("member_a"), organizationId: orgA };
  const actorB = { userId: id("member_b"), organizationId: orgB };

  const answers = {
    participantRegistered: true,
    receivingAddressConfigured: true,
    peppolCapableSoftware: false,
    certificateValid: true,
    successfulTestInvoice: false,
  };

  const newCompany = (organizationId: string, name: string) =>
    db.company.create({ data: { organizationId, name: `${name} ${run}` } });

  async function record(companyId: string, input = answers, actor = actorA, evidence: Record<string, string> = {}) {
    const recorded = await calculateAndPersistCompanyReadiness(companyId, input, actor, undefined, evidence);
    if (!recorded) throw new Error(`assessment refused for ${companyId}`);
    return recorded;
  }

  /** Assessments recorded in one request share a clock to the millisecond; spread them. */
  async function recordAt(companyId: string, score: number, checkedAt: Date, engineVersion = 1) {
    return db.readinessScore.create({
      data: {
        companyId,
        completedById: actorA.userId,
        engineVersion,
        score,
        status: "CONFIGURING",
        checkedAt,
        source: "manual_assessment",
        details: { ...answers, risks: [] },
      },
      select: { id: true },
    });
  }

  const history = async (companyId: string, query = {}) => {
    const result = await listCompanyAssessments(actorA, companyId, query);
    if (!result.found) throw new Error("client not found");
    return result.page;
  };

  beforeAll(async () => {
    await db.organization.createMany({
      data: [
        { id: orgA, name: "Firm A", slug: id("firm-a") },
        { id: orgB, name: "Firm B", slug: id("firm-b") },
      ],
    });
    for (const [user, organizationId, name] of [
      [actorA.userId, orgA, "Nora Member"],
      [actorB.userId, orgB, "Other Firm"],
    ] as const) {
      await db.user.create({
        data: { id: user, name, email: `${user}@history.test`, memberships: { create: { organizationId } } },
      });
    }
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { email: { endsWith: "@history.test" } } });
    await db.$disconnect();
  });

  describe("order and paging", () => {
    it("answers newest first and pages without repeating or skipping", async () => {
      const company = await newCompany(orgA, "Paging");
      const base = Date.now() - 10 * 60 * 1000;
      const ids = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push((await recordAt(company.id, 50 + index, new Date(base + index * 1000))).id);
      }
      const newestFirst = [...ids].reverse();

      const first = await history(company.id, { pageSize: 2 });
      const second = await history(company.id, { pageSize: 2, page: 2 });
      const third = await history(company.id, { pageSize: 2, page: 3 });

      expect(first.total).toBe(5);
      expect([...first.items, ...second.items, ...third.items].map((item) => item.assessmentId)).toEqual(newestFirst);
      expect(third.items).toHaveLength(1);
    });

    it("orders assessments that share a timestamp by id, so paging stays stable", async () => {
      const company = await newCompany(orgA, "Same instant");
      const sameMoment = new Date(Date.now() - 60 * 1000);
      const ids = [
        (await recordAt(company.id, 10, sameMoment)).id,
        (await recordAt(company.id, 20, sameMoment)).id,
        (await recordAt(company.id, 30, sameMoment)).id,
      ].sort()
        .reverse();

      const first = await history(company.id, { pageSize: 2 });
      const second = await history(company.id, { pageSize: 2, page: 2 });

      expect([...first.items, ...second.items].map((item) => item.assessmentId)).toEqual(ids);
    });

    it("answers an empty page beyond the last one", async () => {
      const company = await newCompany(orgA, "Beyond");
      await record(company.id);

      expect(await history(company.id, { page: 9 })).toMatchObject({ items: [], total: 1 });
    });
  });

  describe("change against the previous assessment", () => {
    it("states the difference, including for the oldest row of a page", async () => {
      const company = await newCompany(orgA, "Delta");
      const base = Date.now() - 10 * 60 * 1000;
      for (const [index, score] of [40, 55, 70].entries()) {
        await recordAt(company.id, score, new Date(base + index * 1000));
      }

      // Page size 2 holds 70 and 55; the row for 55 can only know its change
      // because the service reads one row beyond the page.
      const first = await history(company.id, { pageSize: 2 });
      expect(first.items.map((item) => [item.score, item.previousScore, item.scoreDelta])).toEqual([
        [70, 55, 15],
        [55, 40, 15],
      ]);

      const second = await history(company.id, { pageSize: 2, page: 2 });
      expect(second.items.map((item) => [item.score, item.previousScore, item.scoreDelta])).toEqual([
        [40, null, null],
      ]);
    });

    it("reports a drop and a standstill as such", async () => {
      const company = await newCompany(orgA, "Up and down");
      const base = Date.now() - 10 * 60 * 1000;
      for (const [index, score] of [80, 60, 60].entries()) {
        await recordAt(company.id, score, new Date(base + index * 1000));
      }

      const { items } = await history(company.id);
      expect(items.map((item) => item.scoreDelta)).toEqual([0, -20, null]);
    });

    it("states no change across scoring rules, so a rule change never reads as progress", async () => {
      const company = await newCompany(orgA, "Two engines");
      const base = Date.now() - 10 * 60 * 1000;
      await recordAt(company.id, 65, new Date(base), 1);
      await recordAt(company.id, 80, new Date(base + 1000), 2);

      const { items } = await history(company.id);
      expect(items[0]).toMatchObject({ score: 80, engineVersion: 2, previousScore: null, scoreDelta: null });
      expect(items[1]).toMatchObject({ score: 65, engineVersion: 1 });
    });
  });

  describe("what a row says about its author", () => {
    it("names the colleague who recorded it", async () => {
      const company = await newCompany(orgA, "Author");
      await record(company.id);

      const { items } = await history(company.id);
      expect(items[0]).toMatchObject({ completedById: actorA.userId, completedByName: "Nora Member" });
    });

    it("keeps the assessment and drops the name when the colleague is removed", async () => {
      const leaver = id("user_leaver");
      await db.user.create({
        data: {
          id: leaver,
          name: "Leaver",
          email: `${leaver}@history.test`,
          memberships: { create: { organizationId: orgA } },
        },
      });
      const company = await newCompany(orgA, "Leaver");
      await record(company.id, answers, { userId: leaver, organizationId: orgA });

      await db.user.delete({ where: { id: leaver } });

      const { items } = await history(company.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ completedById: null, completedByName: null });
    });

    it("carries exactly the summary fields, so no evidence can ride along", async () => {
      const company = await newCompany(orgA, "Summary shape");
      await record(company.id, answers, actorA, { participantRegistered: "a note that must not travel" });

      const { items } = await history(company.id);

      // Checked against the service, not against the response schema: zod would
      // silently strip a leaked field at the HTTP boundary and hide the leak.
      expect(Object.keys(items[0] ?? {}).sort()).toEqual([
        "assessmentId",
        "calculatedAt",
        "completedById",
        "completedByName",
        "engineVersion",
        "previousScore",
        "riskCount",
        "score",
        "scoreDelta",
        "status",
      ]);
      expect(JSON.stringify(items)).not.toContain("a note that must not travel");
    });

    it("counts the risks of each assessment", async () => {
      const company = await newCompany(orgA, "Risks");
      await record(company.id, { ...answers, successfulTestInvoice: true });
      await record(company.id, {
        participantRegistered: false,
        receivingAddressConfigured: false,
        peppolCapableSoftware: false,
        certificateValid: false,
        successfulTestInvoice: false,
      });

      const { items } = await history(company.id);
      expect(items.map((item) => item.riskCount)).toEqual([5, 1]);
    });
  });

  describe("one assessment", () => {
    it("answers exactly what recording and the latest endpoint answer", async () => {
      const company = await newCompany(orgA, "Round trip");
      const recorded = await record(company.id, answers, actorA, { participantRegistered: "directory" });

      const detail = await getCompanyAssessment(actorA, company.id, recorded.assessmentId);
      const latest = await getLatestCompanyAssessment(actorA, company.id);

      expect(detail).toEqual(recorded);
      expect(detail).toEqual(latest.assessment);
      expect(detail?.checks.find((check) => check.key === "participantRegistered")?.evidence).toBe("directory");
    });

    it("refuses an assessment of another client, of another firm, and an unknown id", async () => {
      const company = await newCompany(orgA, "Mine");
      const sibling = await newCompany(orgA, "Sibling");
      const foreign = await newCompany(orgB, "Theirs");
      const mine = await record(company.id);
      const theirs = await record(foreign.id, answers, actorB);

      expect(await getCompanyAssessment(actorA, sibling.id, mine.assessmentId)).toBeNull();
      expect(await getCompanyAssessment(actorA, foreign.id, theirs.assessmentId)).toBeNull();
      expect(await getCompanyAssessment(actorA, company.id, "does_not_exist")).toBeNull();
      expect(await listCompanyAssessments(actorA, foreign.id)).toEqual({ found: false });
    });

    it("stays readable for an archived client", async () => {
      const company = await newCompany(orgA, "Archived");
      const recorded = await record(company.id);
      await db.company.update({ where: { id: company.id }, data: { archivedAt: new Date() } });

      expect((await history(company.id)).total).toBe(1);
      expect(await getCompanyAssessment(actorA, company.id, recorded.assessmentId)).not.toBeNull();
    });
  });
});
