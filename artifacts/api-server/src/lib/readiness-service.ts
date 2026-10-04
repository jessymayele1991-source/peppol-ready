import {
  IncidentSeverity,
  PeppolStatus,
  Prisma,
  type ReadinessScore,
} from "@prisma/client";
import { CompanyArchivedError } from "./company-service";
import { prisma } from "./prisma";
import {
  ENGINE_VERSION,
  calculateReadiness,
  type PeppolReadinessStatus,
  type ReadinessInput,
  type RiskIndicator,
  type RiskSeverity,
} from "./readiness-engine";

const STALE_ASSESSMENT_DAYS = 30;

function readAssessmentInput(details: Prisma.JsonValue | null): ReadinessInput {
  const value =
    details && typeof details === "object" && !Array.isArray(details)
      ? details
      : {};

  return {
    participantRegistered: value["participantRegistered"] === true,
    receivingAddressConfigured:
      value["receivingAddressConfigured"] === true,
    peppolCapableSoftware: value["peppolCapableSoftware"] === true,
    certificateValid: value["certificateValid"] === true,
    successfulTestInvoice: value["successfulTestInvoice"] === true,
  };
}

/**
 * What the accountant saw when answering, one optional note per question. Keys
 * match the answers, so a note always lands on the control point it belongs to.
 */
export type AssessmentEvidence = Partial<Record<keyof ReadinessInput, string>>;

/** Blank or whitespace-only notes are stored as absent, never as "". */
function normalizeEvidence(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const RISK_SEVERITIES: readonly RiskSeverity[] = ["info", "warning", "critical"];

/**
 * The risks exactly as the engine recorded them with the assessment. Returns
 * null for anything that is not a complete snapshot — assessments written before
 * the engine stored its risks carry only the answers — so the caller can fall
 * back to deriving them from those answers.
 */
function readStoredRisks(details: Prisma.JsonValue | null): RiskIndicator[] | null {
  const value =
    details && typeof details === "object" && !Array.isArray(details) ? details : null;
  const stored = value?.["risks"];
  if (!Array.isArray(stored)) return null;

  const risks: RiskIndicator[] = [];
  for (const entry of stored) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const { code, label, severity, message, remediation } = entry as Record<string, unknown>;
    if (
      typeof code !== "string" ||
      typeof label !== "string" ||
      typeof message !== "string" ||
      typeof remediation !== "string" ||
      typeof severity !== "string" ||
      !RISK_SEVERITIES.includes(severity as RiskSeverity)
    ) {
      return null;
    }
    risks.push({ code, label, severity: severity as RiskSeverity, message, remediation });
  }
  return risks;
}

/** The engine's own rule: one critical risk outranks any number of warnings. */
function riskLevelOf(risks: readonly RiskIndicator[]): RiskSeverity {
  if (risks.some((risk) => risk.severity === "critical")) return "critical";
  return risks.length > 0 ? "warning" : "info";
}

/**
 * Score and status come from the stored assessment, never from recalculating it:
 * the engine may have changed since, and the client pages read the same stored
 * values. The assessment row leads, the company columns are the fallback for a
 * client that was never assessed. Risks come from the stored snapshot, or from
 * the recorded answers when an older row has no snapshot.
 */
function readStoredAssessment(
  latestScore: Pick<ReadinessScore, "score" | "status" | "details"> | null,
  company: { readinessScore: number; peppolStatus: PeppolStatus },
) {
  const risks =
    readStoredRisks(latestScore?.details ?? null) ??
    calculateReadiness(readAssessmentInput(latestScore?.details ?? null)).risks;

  return {
    score: latestScore?.score ?? company.readinessScore,
    status: (latestScore?.status ?? company.peppolStatus) as PeppolReadinessStatus,
    risks,
    riskLevel: riskLevelOf(risks),
  };
}

function getStaleRisk(lastCheckedAt: Date | null, now: Date): RiskIndicator[] {
  if (!lastCheckedAt) {
    return [
      {
        code: "ASSESSMENT_MISSING",
        label: "Assessment missing",
        severity: "warning",
        message: "No readiness assessment has been recorded for this company.",
        remediation: "Run a complete Peppol readiness assessment.",
      },
    ];
  }

  const ageInDays =
    (now.getTime() - lastCheckedAt.getTime()) / (24 * 60 * 60 * 1000);

  return ageInDays > STALE_ASSESSMENT_DAYS
    ? [
        {
          code: "ASSESSMENT_STALE",
          label: "Assessment out of date",
          severity: "warning",
          message: `The latest readiness assessment is ${Math.floor(ageInDays)} days old.`,
          remediation: "Recalculate readiness using current company information.",
        },
      ]
    : [];
}

function mapIncidentSeverity(severity: IncidentSeverity): RiskSeverity {
  if (severity === "CRITICAL") return "critical";
  if (severity === "WARNING") return "warning";
  return "info";
}

function createCriticalIncidentRisk(): RiskIndicator {
  return {
    code: "OPEN_CRITICAL_INCIDENT",
    label: "Critical incident open",
    severity: "critical",
    message: "An unresolved critical incident may block Peppol document exchange.",
    remediation: "Resolve the critical incident and repeat the readiness assessment.",
  };
}

function formatPeriod(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildTrend(
  scores: Array<Pick<ReadinessScore, "score" | "checkedAt">>,
  now: Date,
) {
  const scoreBuckets = new Map<string, number[]>();
  for (const score of scores) {
    const period = formatPeriod(score.checkedAt);
    const bucket = scoreBuckets.get(period) ?? [];
    bucket.push(score.score);
    scoreBuckets.set(period, bucket);
  }

  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - index), 1),
    );
    const period = formatPeriod(date);
    const bucket = scoreBuckets.get(period) ?? [];
    return bucket.length > 0
      ? {
      period,
      label: date.toLocaleString("en", {
        month: "short",
        timeZone: "UTC",
      }),
      averageScore: Math.round(
        bucket.reduce((total, score) => total + score, 0) / bucket.length,
      ),
    }
      : null;
  }).filter((point): point is NonNullable<typeof point> => point !== null);
}

/**
 * The stored assessment in the shape the API returns. Both the route that
 * records an assessment and the route that reads the latest one go through
 * here, so what a client sees right after assessing is what it sees on the next
 * page load.
 */
function toAssessmentResponse(assessment: {
  id: string;
  companyId: string;
  engineVersion: number;
  completedById: string | null;
  score: number;
  status: PeppolStatus;
  checkedAt: Date;
  details: Prisma.JsonValue | null;
  checks: Array<{ key: string; passed: boolean; evidence: string | null }>;
}) {
  const recomputed = calculateReadiness(readAssessmentInput(assessment.details));
  const risks = readStoredRisks(assessment.details) ?? recomputed.risks;

  return {
    assessmentId: assessment.id,
    companyId: assessment.companyId,
    engineVersion: assessment.engineVersion,
    completedById: assessment.completedById,
    score: assessment.score,
    status: assessment.status as PeppolReadinessStatus,
    riskLevel: riskLevelOf(risks),
    // Labels and weights are presentation of the rules, not stored data; the
    // answers come from the assessment, so they describe this assessment.
    factors: recomputed.factors,
    risks,
    // Ordered by the engine's own factor order, not by how the database
    // returned them, so recording and reading an assessment answer identically.
    checks: recomputed.factors.flatMap((factor) => {
      const stored = assessment.checks.find((check) => check.key === factor.key);
      return stored ? [{ key: stored.key, passed: stored.passed, evidence: stored.evidence }] : [];
    }),
    calculatedAt: assessment.checkedAt,
  };
}

const assessmentSelect = {
  id: true,
  companyId: true,
  engineVersion: true,
  completedById: true,
  score: true,
  status: true,
  checkedAt: true,
  details: true,
  checks: { select: { key: true, passed: true, evidence: true }, orderBy: { key: "asc" } },
} as const satisfies Prisma.ReadinessScoreSelect;

/**
 * The most recent assessment of a client in the caller's organization, or null
 * when the client was never assessed. Tenant-scoped through the company, which
 * owns the assessment: an assessment id alone would accept any row in the
 * database. Archived clients can be read; they just cannot be assessed.
 */
export async function getLatestCompanyAssessment(
  actor: { userId: string; organizationId: string },
  companyId: string,
) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: actor.organizationId },
    select: { id: true },
  });
  if (!company) return { found: false as const };

  const assessment = await prisma.readinessScore.findFirst({
    where: { companyId, company: { organizationId: actor.organizationId } },
    orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
    select: assessmentSelect,
  });

  return { found: true as const, assessment: assessment ? toAssessmentResponse(assessment) : null };
}

export async function getReadinessDashboard(organizationId: string) {
  const now = new Date();
  const sixMonthsAgo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
  );

  const [organization, historicalScores, incidents] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        companies: {
          // Archived clients are no longer monitored.
          where: { archivedAt: null },
          orderBy: [{ readinessScore: "asc" }, { name: "asc" }],
          include: {
            readinessScores: {
              orderBy: { checkedAt: "desc" },
              take: 1,
            },
            incidents: {
              where: { status: { not: "RESOLVED" } },
              orderBy: { occurredAt: "desc" },
              take: 5,
            },
          },
        },
      },
    }),
    prisma.readinessScore.findMany({
      where: {
        company: { organizationId, archivedAt: null },
        checkedAt: { gte: sixMonthsAgo },
      },
      select: { score: true, checkedAt: true },
      orderBy: { checkedAt: "asc" },
    }),
    prisma.incident.findMany({
      where: {
        organizationId,
        OR: [{ companyId: null }, { company: { archivedAt: null } }],
      },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { occurredAt: "desc" },
      take: 5,
    }),
  ]);

  if (!organization) return null;

  const companies = organization.companies.map((company) => {
    const latestScore = company.readinessScores[0] ?? null;
    const assessment = readStoredAssessment(latestScore, company);
    const operationalRisks = getStaleRisk(
      latestScore?.checkedAt ?? company.lastCheckedAt,
      now,
    );
    if (
      company.incidents.some(
        (incident) => incident.severity === "CRITICAL",
      )
    ) {
      operationalRisks.push(createCriticalIncidentRisk());
    }

    return {
      id: company.id,
      name: company.name,
      email: company.email,
      accountingPackage: company.accountingPackage,
      status: assessment.status,
      score: assessment.score,
      lastCheckedAt: latestScore?.checkedAt ?? company.lastCheckedAt,
      riskLevel:
        operationalRisks.some((risk) => risk.severity === "critical")
          ? ("critical" as const)
          : assessment.riskLevel,
      risks: [...assessment.risks, ...operationalRisks],
    };
  });

  const breakdown = {
    ready: companies.filter((company) => company.status === "READY").length,
    configuring: companies.filter(
      (company) => company.status === "CONFIGURING",
    ).length,
    atRisk: companies.filter((company) => company.status === "AT_RISK").length,
    notRegistered: companies.filter(
      (company) => company.status === "NOT_REGISTERED",
    ).length,
  };

  const actionMap = new Map<
    string,
    { code: string; label: string; count: number; severity: RiskSeverity }
  >();
  for (const company of companies) {
    for (const risk of company.risks) {
      const current = actionMap.get(risk.code);
      actionMap.set(risk.code, {
        code: risk.code,
        label: risk.label,
        count: (current?.count ?? 0) + 1,
        severity: risk.severity,
      });
    }
  }

  const severityRank: Record<RiskSeverity, number> = {
    critical: 3,
    warning: 2,
    info: 1,
  };

  return {
    organization: {
      id: organization.id,
      name: organization.name,
    },
    generatedAt: now,
    kpis: {
      totalCompanies: companies.length,
      peppolReady: breakdown.ready,
      actionRequired: companies.filter((company) => company.risks.length > 0)
        .length,
      highRisk: companies.filter(
        (company) => company.riskLevel === "critical",
      ).length,
      notRegistered: breakdown.notRegistered,
      averageScore:
        companies.length > 0
          ? Math.round(
              companies.reduce((total, company) => total + company.score, 0) /
                companies.length,
            )
          : 0,
    },
    breakdown,
    trend: buildTrend(historicalScores, now),
    actions: [...actionMap.values()]
      .sort(
        (left, right) =>
          severityRank[right.severity] - severityRank[left.severity] ||
          right.count - left.count,
      )
      .slice(0, 5),
    incidents: incidents.map((incident) => ({
      id: incident.id,
      title: incident.title,
      companyId: incident.company?.id ?? null,
      companyName: incident.company?.name ?? null,
      severity: mapIncidentSeverity(incident.severity),
      status: incident.status,
      occurredAt: incident.occurredAt,
    })),
    companies: companies.map(({ riskLevel: _riskLevel, ...company }) => company),
  };
}

/**
 * Where an assessment came from. Set by the server for each code path that
 * records one, never taken from a request: a client-chosen source let a manual
 * entry pass for an automated synchronisation in the audit trail.
 */
export const ASSESSMENT_SOURCE = {
  manual: "manual_assessment",
} as const;

export type AssessmentSource =
  (typeof ASSESSMENT_SOURCE)[keyof typeof ASSESSMENT_SOURCE];

/**
 * The assessment time is always the moment the server records it. A
 * client-supplied time let a member date an assessment in the future, which then
 * stayed the "latest" score forever and silenced the stale-assessment warning.
 * The database also rejects future timestamps (see the tenant integrity
 * migration), so no other write path can reintroduce this.
 */
export async function calculateAndPersistCompanyReadiness(
  companyId: string,
  input: ReadinessInput,
  actor: { userId: string; organizationId: string },
  source: AssessmentSource = ASSESSMENT_SOURCE.manual,
  evidence: AssessmentEvidence = {},
) {
  // Scoped to the caller's organization: looking a company up by id alone
  // would accept any company id in the database.
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: actor.organizationId },
    select: { id: true, organizationId: true, archivedAt: true },
  });
  if (!company) return null;
  if (company.archivedAt) throw new CompanyArchivedError();

  const checkedAt = new Date();
  const assessment = calculateReadiness(input);
  // The answers feed the legacy risk fallback and the risks are the snapshot the
  // dashboard reads. Per-factor outcomes live in readiness_checks, so they are
  // deliberately not repeated here.
  const details: Prisma.InputJsonValue = {
    participantRegistered: input.participantRegistered,
    receivingAddressConfigured: input.receivingAddressConfigured,
    peppolCapableSoftware: input.peppolCapableSoftware,
    certificateValid: input.certificateValid,
    successfulTestInvoice: input.successfulTestInvoice,
    risks: assessment.risks,
  };

  const recorded = await prisma.$transaction(async (tx) => {
    // Scoped to the organization and to an active client in the same statement
    // that writes, and first: if the client was archived since the lookup
    // above, nothing is recorded.
    const { count } = await tx.company.updateMany({
      where: { id: companyId, organizationId: actor.organizationId, archivedAt: null },
      data: {
        readinessScore: assessment.score,
        peppolStatus: assessment.status as PeppolStatus,
        lastCheckedAt: checkedAt,
      },
    });
    if (count !== 1) throw new CompanyArchivedError();

    // The actor comes from the session, never from the request: a body-supplied
    // user would let a member credit a colleague. The membership trigger on
    // readiness_scores is the database's own backstop.
    const stored = await tx.readinessScore.create({
      data: {
        companyId,
        completedById: actor.userId,
        engineVersion: ENGINE_VERSION,
        score: assessment.score,
        status: assessment.status as PeppolStatus,
        checkedAt,
        source,
        details,
      },
      select: { id: true },
    });

    // One control point per factor, with the note the accountant left for it.
    // Written after the archive check above, inside the same transaction, so an
    // assessment that is refused leaves no control points behind.
    await tx.readinessCheck.createMany({
      data: assessment.factors.map((factor) => ({
        scoreId: stored.id,
        key: factor.key,
        passed: factor.passed,
        evidence: normalizeEvidence(evidence[factor.key]),
      })),
    });

    await tx.auditEvent.create({
      data: {
        organizationId: company.organizationId,
        actorId: actor.userId,
        eventType: "readiness.calculated",
        entityType: "company",
        entityId: companyId,
        // Identifiers and outcome only. Evidence notes are the accountant's own
        // words about a client and never enter the audit trail.
        metadata: {
          assessmentId: stored.id,
          engineVersion: ENGINE_VERSION,
          score: assessment.score,
          status: assessment.status,
          source,
          checkedAt: checkedAt.toISOString(),
        },
      },
    });

    return stored.id;
  });

  return toAssessmentResponse({
    id: recorded,
    companyId,
    engineVersion: ENGINE_VERSION,
    completedById: actor.userId,
    score: assessment.score,
    status: assessment.status as PeppolStatus,
    checkedAt,
    details: details as Prisma.JsonValue,
    checks: assessment.factors.map((factor) => ({
      key: factor.key,
      passed: factor.passed,
      evidence: normalizeEvidence(evidence[factor.key]),
    })),
  });
}