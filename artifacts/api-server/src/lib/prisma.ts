import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  peppolFlowPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.peppolFlowPrisma ??
  new PrismaClient({
    log:
      process.env["NODE_ENV"] === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.peppolFlowPrisma = prisma;
}