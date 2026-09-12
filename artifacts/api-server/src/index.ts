import app from "./app";
import { logger } from "./lib/logger";
import { assertMigrationsApplied } from "./lib/migration-guard";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  // Before listening: a server that is not listening fails the deployment's
  // startup health check, so a database behind this build blocks the rollout.
  const state = await assertMigrationsApplied(__PRISMA_MIGRATIONS__);
  if (state.unknown.length > 0) {
    logger.warn(
      { unknown: state.unknown },
      "Database has migrations this build does not know about",
    );
  }
  logger.info(
    { migrations: __PRISMA_MIGRATIONS__.length },
    "Database schema is current",
  );

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

start().catch((err: unknown) => {
  logger.fatal({ err }, "Refusing to start");
  process.exit(1);
});
