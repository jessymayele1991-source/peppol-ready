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
  const details: Prisma.InputJsonValue = {
    participantRegistered: input.participantRegistered,
    receivingAddressConfigured: input.receivingAddressConfigured,
    peppolCapableSoftware: input.peppolCapableSoftware,
    certificateValid: input.certificateValid,
    successfulTestInvoice: input.successfulTestInvoice,
    factors: assessment.factors,
    risks: assessment.risks,
  };

  await prisma.$transaction(async (tx) => {
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

    await tx.readinessScore.create({
      data: {
        companyId,
        engineVersion: ENGINE_VERSION,
        score: assessment.score,
        status: assessment.status as PeppolStatus,
        checkedAt,
        source,
        details,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: company.organizationId,
        actorId: actor.userId,
        eventType: "readiness.calculated",
        entityType: "company",
        entityId: companyId,
        metadata: {
          score: assessment.score,
          status: assessment.status,
          source,
          checkedAt: checkedAt.toISOString(),
        },
      },
    });
  });

  return {
    companyId,
    ...assessment,
    calculatedAt: checkedAt,
  };
}