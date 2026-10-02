-- Readiness consolidation.
--
-- One readiness model instead of two. `readiness_scores` becomes the canonical
-- assessment: it keeps the engine version that produced the score, so a
-- historical score stays explainable after the rules change, and it records who
-- completed the assessment under the same tenant check as tasks and reports.
-- `readiness_checks` moves from the unused scan model onto the assessment, where
-- it will hold per-question outcomes and evidence. `readiness_scans` and
-- `ReadinessCategory` are removed: no code, seed or test ever wrote them, so a
-- second status vocabulary and a second history disappear with them.
--
-- Destructive, so this refuses to run on a database where those tables hold
-- rows. Nothing in this file touches an existing `readiness_scores` row.

DO $$
DECLARE
  scan_count bigint;
  check_count bigint;
BEGIN
  SELECT count(*) INTO scan_count FROM "public"."readiness_scans";
  SELECT count(*) INTO check_count FROM "public"."readiness_checks";

  IF scan_count > 0 OR check_count > 0 THEN
    RAISE EXCEPTION
      'readiness_consolidation: readiness_scans holds % row(s) and readiness_checks holds % row(s). This migration drops readiness_scans and re-parents readiness_checks, which is only safe while both are empty. Export or migrate those rows into readiness_scores first, then run the migration again. Nothing was changed.',
      scan_count, check_count;
  END IF;
END $$;

-- AlterTable: the engine version behind every assessment. Existing rows were all
-- produced by the five-factor engine, which is version 1.
ALTER TABLE "public"."readiness_scores" ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "engineVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: re-parent the control points onto the assessment.
ALTER TABLE "public"."readiness_checks" DROP CONSTRAINT "readiness_checks_scanId_fkey";

DROP INDEX "public"."readiness_checks_scanId_key_key";

ALTER TABLE "public"."readiness_checks" RENAME COLUMN "scanId" TO "scoreId";

-- CreateIndex
CREATE UNIQUE INDEX "readiness_checks_scoreId_key_key" ON "public"."readiness_checks"("scoreId", "key");

-- AddForeignKey
ALTER TABLE "public"."readiness_scores" ADD CONSTRAINT "readiness_scores_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."readiness_checks" ADD CONSTRAINT "readiness_checks_scoreId_fkey" FOREIGN KEY ("scoreId") REFERENCES "public"."readiness_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The same tenant check tasks and reports already carry, reusing the function
-- from 20260912120000_tenant_integrity: '@company' resolves the organization
-- through companyId, so an assessment can never credit a user from another firm.
CREATE TRIGGER "readiness_scores_enforce_tenant_membership"
  BEFORE INSERT OR UPDATE OF "companyId", "completedById"
  ON "public"."readiness_scores"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."enforce_tenant_membership"('@company', 'completedById');

-- DropTable: the unused scan model. Its indexes, foreign keys, CHECK constraints
-- and membership trigger go with it.
DROP TABLE "public"."readiness_scans";

-- DropEnum: only ever used by readiness_scans.category.
DROP TYPE "public"."ReadinessCategory";
