import { prisma } from "./prisma";

/** A row from Prisma's own bookkeeping table, `_prisma_migrations`. */
export type AppliedMigration = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export type MigrationState = {
  ok: boolean;
  /** Shipped with this build but never applied to the database. */
  missing: string[];
  /** Started and neither finished nor rolled back: a failed or interrupted run. */
  failed: string[];
  /** Applied to the database but unknown to this build — a newer schema. */
  unknown: string[];
};

/**
 * Pure comparison between the migrations this build was compiled with and the
 * database's record of what ran. A migration that was rolled back counts as not
 * applied. Unknown migrations do not block startup: they occur legitimately
 * while an older build is still serving after a newer one migrated.
 */
export function evaluateMigrations(
  expected: readonly string[],
  applied: readonly AppliedMigration[],
): MigrationState {
  const completed = new Set(
    applied
      .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
      .map((row) => row.migration_name),
  );

  const failed = applied
    .filter((row) => row.finished_at === null && row.rolled_back_at === null)
    .map((row) => row.migration_name);

  const missing = expected.filter((name) => !completed.has(name));

  const known = new Set(expected);
  const unknown = [...completed].filter((name) => !known.has(name));

  return {
    ok: missing.length === 0 && failed.length === 0,
    missing,
    failed,
    unknown,
  };
}

/**
 * Database objects that enforce security rules and that a schema-diff tool can
 * silently leave out. Replit, for one, applies its own drizzle-kit based schema
 * diff to the production database at publish time; such a diff copies tables
 * and columns but is not guaranteed to carry triggers, functions or named
 * constraints. A database can then hold every Prisma migration record and every
 * table while missing the tenant boundary itself. These names come from
 * 20260912120000_tenant_integrity.
 */
export const REQUIRED_DATABASE_OBJECTS = {
  constraints: [
    "tasks_companyId_organizationId_fkey",
    "incidents_companyId_organizationId_fkey",
    "reports_companyId_organizationId_fkey",
    "readiness_scores_checkedAt_not_future",
    "companies_lastCheckedAt_not_future",
    "readiness_scans_startedAt_not_future",
    "readiness_scans_completedAt_not_future",
  ],
  triggers: [
    "tasks_enforce_tenant_membership",
    "reports_enforce_tenant_membership",
    "readiness_scans_enforce_tenant_membership",
  ],
  functions: ["enforce_tenant_membership"],
} as const;

export type PresentDatabaseObjects = {
  constraints: readonly string[];
  triggers: readonly string[];
  functions: readonly string[];
};

/** Pure comparison: every required object must be present by exact name. */
export function evaluateDatabaseObjects(
  required: typeof REQUIRED_DATABASE_OBJECTS,
  present: PresentDatabaseObjects,
): { ok: boolean; missing: string[] } {
  const missing = [
    ...required.constraints
      .filter((name) => !present.constraints.includes(name))
      .map((name) => `constraint ${name}`),
    ...required.triggers
      .filter((name) => !present.triggers.includes(name))
      .map((name) => `trigger ${name}`),
    ...required.functions
      .filter((name) => !present.functions.includes(name))
      .map((name) => `function ${name}`),
  ];
  return { ok: missing.length === 0, missing };
}

/**
 * Refuses to start when a security-enforcing database object is missing, even
 * if the migration history says everything was applied.
 */
export async function assertDatabaseObjectsPresent(): Promise<void> {
  const names = (rows: Array<{ name: string }>) => rows.map((row) => row.name);

  const [constraints, triggers, functions] = await Promise.all([
    prisma.$queryRaw<Array<{ name: string }>>`
      SELECT c.conname AS name FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public'`,
    prisma.$queryRaw<Array<{ name: string }>>`
      SELECT t.tgname AS name FROM pg_trigger t
      JOIN pg_class r ON r.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled <> 'D'`,
    prisma.$queryRaw<Array<{ name: string }>>`
      SELECT p.proname AS name FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'`,
  ]);

  const result = evaluateDatabaseObjects(REQUIRED_DATABASE_OBJECTS, {
    constraints: names(constraints),
    triggers: names(triggers),
    functions: names(functions),
  });

  if (!result.ok) {
    throw new Error(
      `The database is missing security-enforcing objects (${result.missing.join(", ")}). ` +
        "Its schema was not produced by this build's Prisma migrations. Do not mark migrations as applied by hand; " +
        "restore the objects from 20260912120000_tenant_integrity/migration.sql before starting the server.",
    );
  }
}

/**
 * Refuses to let the server start against a database that is behind this
 * build. Without it, a deploy that skipped `prisma migrate deploy` starts
 * cleanly and then fails every sign-in with a 500 on a missing column.
 */
export async function assertMigrationsApplied(
  expected: readonly string[],
): Promise<MigrationState> {
  let applied: AppliedMigration[];
  try {
    applied = await prisma.$queryRaw<AppliedMigration[]>`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
    `;
  } catch (cause) {
    throw new Error(
      "Could not read _prisma_migrations. The database is unreachable or has never been migrated; run `prisma migrate deploy`.",
      { cause },
    );
  }

  const state = evaluateMigrations(expected, applied);
  if (!state.ok) {
    const details = [
      state.missing.length > 0 ? `missing: ${state.missing.join(", ")}` : null,
      state.failed.length > 0 ? `failed: ${state.failed.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `The database is not at the schema this build requires (${details}). Run \`prisma migrate deploy\` before starting the server.`,
    );
  }

  return state;
}
