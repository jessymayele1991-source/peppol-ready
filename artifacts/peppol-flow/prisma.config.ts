import { defineConfig } from "prisma/config";
import { loadLocalEnv } from "./prisma/load-local-env";

// Prisma does not read `.env` itself once this config file exists.
loadLocalEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
