import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The consolidated readiness model against PostgreSQL: the dashboard reports the
 * stored assessment rather than recalculating it, assessments written before the
 * engine stored its risks still produce risks, every assessment records the
 * engine version behind it, and an assessment can only credit a member of its
 * own organization. Requires a migrated database:
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

describe.skipIf(!url)("readiness consolidation in the database", async () => {
  process.env["DATABASE_URL"] = url;
  const { getReadinessDashboard, calculateAndPersistCompanyReadiness } = await import("./readiness-service");
  const { ENGINE_VERSION } = await import("./readiness-engine");

  const db = new PrismaClient({ datasourceUrl: url });
  const run = randomUUID().slice(0, 8);
  const id = (name: string) => `${name}_${run}`;
  const orgA = id("org_a");
  const orgB = id("org_b");
  const answers = {
    participantRegistered: true,
    receivingAddressConfigured: true,
    peppolCapableSoftware: false,
    certificateValid: true,
    successfulTestInvoice: false,
  };

  /** The dashboard entry for one client, by id. */
  async function dashboardEntry(organizationId: string, companyId: string) {
    const dashboard = await getReadinessDashboard(organizationId);
    const entry = dashboard?.companies.find((company) => company.id === companyId);
    if (!entry) throw new Error(`client ${companyId} missing from the dashboard`);
    return entry;
  }

  const newCompany = (organizationId: string, name: string) =>
    db.company.create({ data: { organizationId, name: `${name} ${run}` } });

  beforeAll(async () => {
    await db.organization.createMany({
      data: [
        { id: orgA, name: "Firm A", slug: id("firm-a") },
        { id: orgB, name: "Firm B", slug: id("firm-b") },
      ],
    });
    for (const [user, organizationId] of [
      [id("member_a"), orgA],
      [id("member_b"), orgB],
    ] as const) {
      await db.user.create({
        data: {
          id: user,
          name: user,
          email: `${user}@consolidation.test`,
          memberships: { create: { organizationId } },
        },
      });
    }
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { email: { endsWith: `@consolidation.test` } } });
    await db.$disconnect();
  });

  describe("source of truth", () => {
    it("reports the stored score and status, even where recalculation would disagree", async () => {
      const company = await newCompany(orgA, "Stored wins");
      // Deliberately contradictory: the stored assessment says ready, while the
      // answers it was recorded from would score zero. Nothing in the database
      // ties the two together, so this is exactly the divergence that appears
      // once the engine changes.
      await db.readinessScore.create({
        data: {
          companyId: company.id,
          score: 100,
          status: "READY",
          checkedAt: new Date(),
          source: "manual_assessment",
          details: {
            participantRegistered: false,
            receivingAddressConfigured: false,
            peppolCapableSoftware: false,
            certificateValid: false,
            successfulTestInvoice: false,
          },
        },
      });
      await db.company.update({
        where: { id: company.id },
        data: { readinessScore: 100, peppolStatus: "READY", lastCheckedAt: new Date() },
      });

      const entry = await dashboardEntry(orgA, company.id);

      expect(entry.score).toBe(100);
      expect(entry.status).toBe("READY");
    });

    it("falls back to the company columns for a client that was never assessed", async () => {
      const company = await newCompany(orgA, "Never assessed");

      const entry = await dashboardEntry(orgA, company.id);

      expect(entry).toMatchObject({ score: 0, status: "NOT_REGISTERED", lastCheckedAt: null });
      // The client page reads the same two columns.
      const stored = await db.company.findUniqueOrThrow({ where: { id: company.id } });
      expect([stored.readinessScore, stored.peppolStatus]).toEqual([entry.score, entry.status]);
    });

    it("gives the dashboard and the stored client row the same figures after an assessment", async () => {
      const company = await newCompany(orgA, "Agreement");
      await calculateAndPersistCompanyReadiness(company.id, answers, {
        userId: id("member_a"),
        organizationId: orgA,
      });

      const entry = await dashboardEntry(orgA, company.id);
      const stored = await db.company.findUniqueOrThrow({ where: { id: company.id } });
      const assessment = await db.readinessScore.findFirstOrThrow({
        where: { companyId: company.id },
        orderBy: { checkedAt: "desc" },
      });

      expect(entry.score).toBe(stored.readinessScore);
      expect(entry.status).toBe(stored.peppolStatus);
      expect([assessment.score, assessment.status]).toEqual([entry.score, entry.status]);
    });
  });

  describe("legacy assessments", () => {
    it("derives risks from the recorded answers when the row has no risk snapshot", async () => {
      const company = await newCompany(orgA, "Legacy row");
      // The shape every assessment had before the engine stored its own risks,
      // and the shape the development seed still writes.
      await db.readinessScore.create({
        data: {
          companyId: company.id,
          score: 65,
          status: "CONFIGURING",
          checkedAt: new Date(),
          source: "manual_review",
          details: answers,
        },
      });

      const entry = await dashboardEntry(orgA, company.id);

      expect(entry.score).toBe(65);
      expect(entry.risks.map((risk) => risk.code)).toEqual(
        expect.arrayContaining(["SOFTWARE_NOT_READY", "TEST_INVOICE_MISSING"]),
      );
      // Every risk is complete enough for the API contract.
      for (const risk of entry.risks) {
        expect(risk).toMatchObject({
          code: expect.any(String),
          label: expect.any(String),
          message: expect.any(String),
          remediation: expect.any(String),
        });
        expect(["info", "warning", "critical"]).toContain(risk.severity);
      }
    });

    it("prefers the stored snapshot over the answers when both are present", async () => {
      const company = await newCompany(orgA, "Snapshot wins");
      await db.readinessScore.create({
        data: {
          companyId: company.id,
          score: 30,
          status: "AT_RISK",
          checkedAt: new Date(),
          source: "manual_assessment",
          details: {
            ...answers,
            risks: [
              {
                code: "SNAPSHOT_ONLY",
                label: "Recorded with the assessment",
                severity: "critical",
                message: "Stored with the assessment, not derived afterwards.",
                remediation: "Nothing; this proves the snapshot is used.",
              },
            ],
          },
        },
      });

      const entry = await dashboardEntry(orgA, company.id);

      expect(entry.risks.map((risk) => risk.code)).toContain("SNAPSHOT_ONLY");
      expect(entry.risks.map((risk) => risk.code)).not.toContain("SOFTWARE_NOT_READY");
    });

    it("falls back when a snapshot is incomplete, instead of serving a half risk", async () => {
      const company = await newCompany(orgA, "Broken snapshot");
      await db.readinessScore.create({
        data: {
          companyId: company.id,
          score: 65,
          status: "CONFIGURING",
          checkedAt: new Date(),
          details: { ...answers, risks: [{ code: "HALF", severity: "warning" }] },
        },
      });

      const entry = await dashboardEntry(orgA, company.id);

      expect(entry.risks.map((risk) => risk.code)).not.toContain("HALF");
      expect(entry.risks.map((risk) => risk.code)).toContain("SOFTWARE_NOT_READY");
    });
  });

  describe("engine version", () => {
    it("stamps every new assessment with the engine that produced it", async () => {
      const company = await newCompany(orgA, "Versioned");
      await calculateAndPersistCompanyReadiness(company.id, answers, {
        userId: id("member_a"),
        organizationId: orgA,
      });

      const assessment = await db.readinessScore.findFirstOrThrow({ where: { companyId: company.id } });
      expect(assessment.engineVersion).toBe(ENGINE_VERSION);
      expect(ENGINE_VERSION).toBe(1);
    });

    it("defaults the assessments the migration backfilled to version 1", async () => {
      const company = await newCompany(orgA, "Backfilled");
      const assessment = await db.readinessScore.create({
        data: { companyId: company.id, score: 10, status: "AT_RISK", checkedAt: new Date() },
      });

      expect(assessment.engineVersion).toBe(1);
    });
  });

  describe("tenant protection", () => {
    it("refuses an assessment credited to a member of another organization", async () => {
      const company = await newCompany(orgA, "Cross tenant");

      // The trigger raises foreign_key_violation, which Prisma reports as P2003
      // without a constraint name — unlike a real foreign key, and the way the
      // tenant integrity tests tell the trigger apart. The SQL level below
      // asserts the message itself.
      await expect(
        db.readinessScore.create({
          data: {
            companyId: company.id,
            completedById: id("member_b"),
            score: 50,
            status: "CONFIGURING",
            checkedAt: new Date(),
          },
        }),
      ).rejects.toMatchObject({ code: "P2003", meta: { constraint: null } });

      await expect(
        db.$executeRaw`INSERT INTO "readiness_scores" ("id", "companyId", "completedById", "score", "status", "checkedAt")
                       VALUES (${id("score_raw")}, ${company.id}, ${id("member_b")}, 50, 'CONFIGURING', now())`,
      ).rejects.toThrow(`readiness_scores.completedById must reference a member of organization ${orgA}`);
      expect(await db.readinessScore.count({ where: { companyId: company.id } })).toBe(0);
    });

    it("accepts a member of the assessment's own organization", async () => {
      const company = await newCompany(orgA, "Own member");

      const assessment = await db.readinessScore.create({
        data: {
          companyId: company.id,
          completedById: id("member_a"),
          score: 50,
          status: "CONFIGURING",
          checkedAt: new Date(),
        },
      });

      expect(assessment.completedById).toBe(id("member_a"));
    });

    it("keeps the assessment when the user who completed it is deleted", async () => {
      const leaver = id("user_leaver");
      await db.user.create({
        data: {
          id: leaver,
          name: "Leaver",
          email: `${leaver}@consolidation.test`,
          memberships: { create: { organizationId: orgA } },
        },
      });
      const company = await newCompany(orgA, "Leaver assessment");
      const assessment = await db.readinessScore.create({
        data: {
          companyId: company.id,
          completedById: leaver,
          score: 50,
          status: "CONFIGURING",
          checkedAt: new Date(),
        },
      });

      await db.user.delete({ where: { id: leaver } });

      const kept = await db.readinessScore.findUniqueOrThrow({ where: { id: assessment.id } });
      expect(kept.completedById).toBeNull();
    });
  });

  describe("checks hang on the assessment", () => {
    it("stores a control point with its evidence and removes it with the assessment", async () => {
      const company = await newCompany(orgA, "With checks");
      const assessment = await db.readinessScore.create({
        data: { companyId: company.id, score: 50, status: "CONFIGURING", checkedAt: new Date() },
      });
      await db.readinessCheck.create({
        data: { scoreId: assessment.id, key: "participantRegistered", passed: true, evidence: "Peppol directory, 2 Oct" },
      });

      // One outcome per control point per assessment.
      await expect(
        db.readinessCheck.create({ data: { scoreId: assessment.id, key: "participantRegistered", passed: false } }),
      ).rejects.toThrow();

      await db.readinessScore.delete({ where: { id: assessment.id } });
      expect(await db.readinessCheck.count({ where: { scoreId: assessment.id } })).toBe(0);
    });
  });
});
