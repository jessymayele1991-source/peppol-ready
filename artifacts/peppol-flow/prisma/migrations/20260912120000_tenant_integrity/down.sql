-- Hand-written rollback for 20260912120000_tenant_integrity. Prisma does not
-- generate down migrations.
--
-- Apply with:
--   psql "$DATABASE_URL" -f down.sql
--   pnpm --filter @workspace/peppol-flow exec prisma migrate resolve \
--     --rolled-back 20260912120000_tenant_integrity
--
-- Cost: none to data. Only the enforcement objects are removed; after rollback
-- the database once again accepts cross-organization references and future
-- assessment timestamps, and the API server's migration guard refuses to start
-- a build that ships this migration.

DROP TRIGGER IF EXISTS "readiness_scans_enforce_tenant_membership" ON "public"."readiness_scans";
DROP TRIGGER IF EXISTS "reports_enforce_tenant_membership" ON "public"."reports";
DROP TRIGGER IF EXISTS "tasks_enforce_tenant_membership" ON "public"."tasks";
DROP FUNCTION IF EXISTS "public"."enforce_tenant_membership"();

ALTER TABLE "public"."readiness_scans" DROP CONSTRAINT IF EXISTS "readiness_scans_completedAt_not_future";
ALTER TABLE "public"."readiness_scans" DROP CONSTRAINT IF EXISTS "readiness_scans_startedAt_not_future";
ALTER TABLE "public"."companies" DROP CONSTRAINT IF EXISTS "companies_lastCheckedAt_not_future";
ALTER TABLE "public"."readiness_scores" DROP CONSTRAINT IF EXISTS "readiness_scores_checkedAt_not_future";

ALTER TABLE "public"."reports" DROP CONSTRAINT IF EXISTS "reports_companyId_organizationId_fkey";
ALTER TABLE "public"."incidents" DROP CONSTRAINT IF EXISTS "incidents_companyId_organizationId_fkey";
ALTER TABLE "public"."tasks" DROP CONSTRAINT IF EXISTS "tasks_companyId_organizationId_fkey";
DROP INDEX IF EXISTS "public"."companies_id_organizationId_key";
