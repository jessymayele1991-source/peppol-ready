-- Rollback for 20261002120000_readiness_consolidation.
--
-- Restores the scan model and puts the control points back on it. No
-- `readiness_scores` row is read, written or deleted here.
--
-- Cost of rolling back: the two columns added to `readiness_scores` are dropped,
-- so their values are lost. `engineVersion` is reconstructable (every row was 1),
-- and `completedById` is only written from phase 2B onwards.
--
-- Apply with:
--   psql "$DATABASE_URL" -f down.sql
--   psql "$DATABASE_URL" -c "DELETE FROM _prisma_migrations \
--     WHERE migration_name = '20261002120000_readiness_consolidation'"
--
-- The second statement is what makes the migration re-appliable. Do not reach for
-- `prisma migrate resolve --rolled-back` here: that command marks a *failed*
-- attempt, so on a database where this migration once failed and later succeeded
-- it flags the failed row and leaves the successful one in place — `migrate
-- deploy` then reports "No pending migrations to apply" and the database stays
-- rolled back. Verified against PostgreSQL, 2 October 2026.
--
-- Run all of this before reverting the application code: the earlier
-- `migration-guard.ts` requires the readiness_scans objects restored below and
-- refuses to start the server without them.

DROP TRIGGER IF EXISTS "readiness_scores_enforce_tenant_membership" ON "public"."readiness_scores";

ALTER TABLE "public"."readiness_checks" DROP CONSTRAINT IF EXISTS "readiness_checks_scoreId_fkey";
ALTER TABLE "public"."readiness_scores" DROP CONSTRAINT IF EXISTS "readiness_scores_completedById_fkey";

DROP INDEX IF EXISTS "public"."readiness_checks_scoreId_key_key";

CREATE TYPE "public"."ReadinessCategory" AS ENUM ('NOT_STARTED', 'BASIC', 'ADVANCED', 'READY', 'FULLY_COMPLIANT');

CREATE TABLE "public"."readiness_scans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "completedById" TEXT,
    "score" INTEGER NOT NULL,
    "category" "public"."ReadinessCategory" NOT NULL,
    "source" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "readiness_scans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "readiness_scans_companyId_completedAt_idx" ON "public"."readiness_scans"("companyId", "completedAt");

ALTER TABLE "public"."readiness_scans" ADD CONSTRAINT "readiness_scans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."readiness_scans" ADD CONSTRAINT "readiness_scans_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."readiness_scans"
  ADD CONSTRAINT "readiness_scans_startedAt_not_future"
  CHECK ("startedAt" <= now() + interval '5 minutes');

ALTER TABLE "public"."readiness_scans"
  ADD CONSTRAINT "readiness_scans_completedAt_not_future"
  CHECK ("completedAt" IS NULL OR "completedAt" <= now() + interval '5 minutes');

CREATE TRIGGER "readiness_scans_enforce_tenant_membership"
  BEFORE INSERT OR UPDATE OF "companyId", "completedById"
  ON "public"."readiness_scans"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."enforce_tenant_membership"('@company', 'completedById');

ALTER TABLE "public"."readiness_checks" RENAME COLUMN "scoreId" TO "scanId";

CREATE UNIQUE INDEX "readiness_checks_scanId_key_key" ON "public"."readiness_checks"("scanId", "key");

ALTER TABLE "public"."readiness_checks" ADD CONSTRAINT "readiness_checks_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "public"."readiness_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."readiness_scores" DROP COLUMN IF EXISTS "completedById";
ALTER TABLE "public"."readiness_scores" DROP COLUMN IF EXISTS "engineVersion";
