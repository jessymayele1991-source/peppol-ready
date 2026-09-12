import { PrismaClient } from "@prisma/client";
import { loadLocalEnv } from "./load-local-env";
import { resolveSeedPassword } from "./seed-guard";

/**
 * Development bootstrap: seeds the demo data only into a database that has no
 * users yet, so starting the local environment again never overwrites what was
 * changed while developing. Run `pnpm db:seed` to reseed on purpose.
 *
 * The seed's own guard is checked first, so this refuses production exactly
 * as the seed does, before touching the database.
 */
loadLocalEnv();
resolveSeedPassword(process.env);

const prisma = new PrismaClient();
const users = await prisma.user.count();
await prisma.$disconnect();

if (users > 0) {
  console.log(`Seed skipped: the database already has ${users} user(s).`);
} else {
  console.log("Empty database: seeding development data.");
  // seed.ts runs on import and exits with 1 on failure; it prints nothing on
  // success, so report completion once the process ends cleanly.
  process.on("exit", (code) => {
    if (code === 0) console.log("Seed complete.");
  });
  await import("./seed");
}
