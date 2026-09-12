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
