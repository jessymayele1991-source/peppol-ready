import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads the repository's root `.env` for local development, when it exists.
 *
 * Prisma skips its own `.env` loading as soon as a prisma.config.ts is present,
 * so the Prisma CLI and the scripts in this directory load it here instead.
 * `process.loadEnvFile` never overrides a variable that is already set, so
 * values from the shell, Docker Compose or Replit Secrets always win, and on
 * Replit — where there is no `.env` — this does nothing.
 */
export function loadLocalEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const envFile = resolve(here, "../../../.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
