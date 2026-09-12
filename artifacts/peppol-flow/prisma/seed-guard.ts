/**
 * Decides whether the seed may run and which password the seeded accounts get.
 *
 * The seed writes demo accounts — including an OWNER — that all share one
 * password, and overwrites rows with its fixed ids on every run. That is right
 * for a throwaway development database and never right for production, so:
 *
 * - NODE_ENV=production refuses outright.
 * - Any database that is not on this machine requires an explicit
 *   SEED_PASSWORD. Remote development databases, such as the one a Replit
 *   workspace provides, count as not on this machine.
 * - The public development password is accepted only for a local database.
 */

export const DEVELOPMENT_SEED_PASSWORD = "peppol-ready-dev";
export const MIN_SEED_PASSWORD_LENGTH = 12;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Unparseable or socket-based URLs count as remote: the safe answer. */
export function isLocalDatabase(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const url = new URL(databaseUrl);
    return LOCAL_HOSTS.has(url.hostname) && !url.searchParams.has("host");
  } catch {
    return false;
  }
}

export function resolveSeedPassword(env: NodeJS.ProcessEnv): string {
  if (env["NODE_ENV"] === "production") {
    throw new Error(
      "Refusing to seed: NODE_ENV is production. The seed writes demo accounts that share one password and must never run against a production database.",
    );
  }

  const local = isLocalDatabase(env["DATABASE_URL"]);
  const provided = env["SEED_PASSWORD"];

  if (!provided) {
    if (local) return DEVELOPMENT_SEED_PASSWORD;
    throw new Error(
      "Refusing to seed: SEED_PASSWORD is required when DATABASE_URL is not a local database. Set it to a password of at least " +
        `${MIN_SEED_PASSWORD_LENGTH} characters for this environment's demo accounts.`,
    );
  }

  if (provided === DEVELOPMENT_SEED_PASSWORD && !local) {
    throw new Error(
      "Refusing to seed: SEED_PASSWORD is the public development password, which is only allowed for a local database.",
    );
  }

  if (provided.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(
      `Refusing to seed: SEED_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters.`,
    );
  }

  return provided;
}
