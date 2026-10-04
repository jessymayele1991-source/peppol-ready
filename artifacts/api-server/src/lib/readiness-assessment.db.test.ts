import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * What a recorded assessment actually stores, against PostgreSQL: one control
 * point per question with its evidence note, the acting user, the engine
 * version, an audit trail without the accountant's own words, and a read path
 * that returns exactly what the write path returned. Requires a migrated
 * database:
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

describe.skipIf(!url)("recording an assessment in the database", async () => {
  process.env["DATABASE_URL"] = url;
  const { calculateAndPersistCompanyReadiness, getLatestCompanyAssessment } = await import("./readiness-service");
  const { ENGINE_VERSION } = await import("./readiness-engine");
  const { CompanyArchivedError } = await import("./company-service");

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

  /** Records an assessment that is expected to succeed; null means the client was unreachable. */
  async function record(
    companyId: string,
    input = answers,
    actor = actorA,
    evidence: Record<string, string> = {},
  ) {
    const recorded = await calculateAndPersistCompanyReadiness(companyId, input, actor, undefined, evidence);
    if (!recorded) throw new Error(`assessment refused for ${companyId}`);
    return recorded;
  }

  beforeAll(async () => {
    await db.organization.createMany({
      data: [
        { id: orgA, name: "Firm A", slug: id("firm-a") },
        { id: orgB, name: "Firm B", slug: id("firm-b") },
      ],
    });
    for (const [user, organizationId] of [
      [actorA.userId, orgA],
      [actorB.userId, orgB],
    ] as const) {
      await db.user.create({
        data: {
          id: user,
          name: user,
          email: `${user}@assessment.test`,
          memberships: { create: { organizationId } },
        },
      });
    }
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { email: { endsWith: "@assessment.test" } } });
    await db.$disconnect();
  });

  describe("control points", () => {
    it("stores one per question, with the note trimmed and blanks as absent", async () => {
      const company = await newCompany(orgA, "Checks");

      await record(company.id, answers, actorA, {
        participantRegistered: "  Peppol directory, 4 October  ",
        peppolCapableSoftware: "   ",
        certificateValid: "",
      });

      const checks = await db.readinessCheck.findMany({
        where: { score: { companyId: company.id } },
        orderBy: { key: "asc" },
      });
      expect(checks).toHaveLength(5);
      expect(Object.fromEntries(checks.map((check) => [check.key, check.evidence]))).toEqual({
        participantRegistered: "Peppol directory, 4 October",
        receivingAddressConfigured: null,
        peppolCapableSoftware: null,
        certificateValid: null,
        successfulTestInvoice: null,
      });
      // The outcome per control point is the engine's, not the caller's.
      expect(Object.fromEntries(checks.map((check) => [check.key, check.passed]))).toEqual(answers);
    });

    it("keeps each assessment's control points separate, and removes them with it", async () => {
      const company = await newCompany(orgA, "Twice");

      const first = await record(company.id, answers, actorA, { participantRegistered: "first" });
      const second = await record(company.id, { ...answers, successfulTestInvoice: true }, actorA, {
        participantRegistered: "second",
      });

      expect(first.assessmentId).not.toBe(second.assessmentId);
      expect(await db.readinessCheck.count({ where: { score: { companyId: company.id } } })).toBe(10);
      expect(
        (await db.readinessCheck.findFirstOrThrow({ where: { scoreId: second.assessmentId, key: "participantRegistered" } })).evidence,
      ).toBe("second");

      await db.readinessScore.delete({ where: { id: first.assessmentId } });
      expect(await db.readinessCheck.count({ where: { scoreId: first.assessmentId } })).toBe(0);
      expect(await db.readinessCheck.count({ where: { scoreId: second.assessmentId } })).toBe(5);
    });
  });

  describe("provenance", () => {
    it("records the acting user and the engine version", async () => {
      const company = await newCompany(orgA, "Provenance");

      const recorded = await record(company.id);

      const stored = await db.readinessScore.findUniqueOrThrow({ where: { id: recorded.assessmentId } });
      expect(stored.completedById).toBe(actorA.userId);
      expect(stored.engineVersion).toBe(ENGINE_VERSION);
      expect(recorded.completedById).toBe(actorA.userId);
    });

    it("stores the answers and the risk snapshot, and no longer the factors", async () => {
      const company = await newCompany(orgA, "Details");

      const recorded = await record(company.id);

      const stored = await db.readinessScore.findUniqueOrThrow({ where: { id: recorded.assessmentId } });
      const details = stored.details as Record<string, unknown>;
      expect(Object.keys(details).sort()).toEqual(
        [...Object.keys(answers), "risks"].sort(),
      );
      expect(details["factors"]).toBeUndefined();
      expect(Array.isArray(details["risks"])).toBe(true);
    });
  });

  describe("audit trail", () => {
    it("names the assessment and its outcome, never the evidence", async () => {
      const company = await newCompany(orgA, "Audit");
      const note = "Seen in the access point portal on 4 October";

      const recorded = await record(company.id, answers, actorA, { receivingAddressConfigured: note });

      const events = await db.auditEvent.findMany({ where: { entityId: company.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ eventType: "readiness.calculated", actorId: actorA.userId });
      expect(events[0]?.metadata).toMatchObject({
        assessmentId: recorded.assessmentId,
        engineVersion: ENGINE_VERSION,
        score: recorded.score,
        status: recorded.status,
      });
      expect(JSON.stringify(events[0]?.metadata)).not.toContain(note);
      expect(JSON.stringify(events[0]?.metadata)).not.toContain("portal");
    });
  });

  describe("reading it back", () => {
    it("returns exactly what recording returned", async () => {
      const company = await newCompany(orgA, "Round trip");
      const recorded = await record(company.id, answers, actorA, {
        participantRegistered: "directory",
        successfulTestInvoice: "no test sent yet",
      });

      const read = await getLatestCompanyAssessment(actorA, company.id);

      expect(read.found).toBe(true);
      expect(read.assessment).toEqual(recorded);
    });

    it("returns the most recent assessment", async () => {
      const company = await newCompany(orgA, "Most recent");
      await record(company.id);
      const second = await record(company.id, { ...answers, successfulTestInvoice: true });

      const read = await getLatestCompanyAssessment(actorA, company.id);
      expect(read.assessment?.assessmentId).toBe(second.assessmentId);
      expect(read.assessment?.score).toBe(80);
    });

    it("separates a client without assessments from a client of another firm", async () => {
      const own = await newCompany(orgA, "Unassessed");
      const other = await newCompany(orgB, "Other firm");
      await record(other.id, answers, actorB);

      expect(await getLatestCompanyAssessment(actorA, own.id)).toEqual({ found: true, assessment: null });
      expect(await getLatestCompanyAssessment(actorA, other.id)).toEqual({ found: false });
    });

    it("stays readable for an archived client", async () => {
      const company = await newCompany(orgA, "Archived read");
      const recorded = await record(company.id);
      await db.company.update({ where: { id: company.id }, data: { archivedAt: new Date() } });

      const read = await getLatestCompanyAssessment(actorA, company.id);
      expect(read.assessment?.assessmentId).toBe(recorded.assessmentId);
    });
  });

  describe("archived clients", () => {
    it("refuses a new assessment and leaves no control points behind", async () => {
      const company = await newCompany(orgA, "Archived write");
      await db.company.update({ where: { id: company.id }, data: { archivedAt: new Date() } });

      await expect(
        calculateAndPersistCompanyReadiness(company.id, answers, actorA, undefined, {
          participantRegistered: "should not be stored",
        }),
      ).rejects.toBeInstanceOf(CompanyArchivedError);

      expect(await db.readinessScore.count({ where: { companyId: company.id } })).toBe(0);
      expect(await db.readinessCheck.count({ where: { score: { companyId: company.id } } })).toBe(0);
      expect(await db.auditEvent.count({ where: { entityId: company.id } })).toBe(0);
    });
  });

  describe("tenant isolation", () => {
    it("refuses to assess another firm's client", async () => {
      const company = await newCompany(orgB, "Not yours");

      expect(await calculateAndPersistCompanyReadiness(company.id, answers, actorA)).toBeNull();
      expect(await db.readinessScore.count({ where: { companyId: company.id } })).toBe(0);
    });
  });
});
