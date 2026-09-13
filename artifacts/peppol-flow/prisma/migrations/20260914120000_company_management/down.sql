-- Hand-written rollback for 20260914120000_company_management.
--
-- Apply with:
--   psql "$DATABASE_URL" -f down.sql
--   pnpm --filter @workspace/peppol-flow exec prisma migrate resolve \
--     --rolled-back 20260914120000_company_management
--
-- Cost: phone, address, country and archive state of every client are lost, and
-- archived clients become active again. VAT and registration numbers stay in
-- their normalized form; the original spacing and dots are not recoverable.

ALTER TABLE "public"."companies" DROP CONSTRAINT IF EXISTS "companies_archivedAt_not_future";
ALTER TABLE "public"."companies" DROP CONSTRAINT IF EXISTS "companies_country_iso_alpha2";
ALTER TABLE "public"."companies" DROP CONSTRAINT IF EXISTS "companies_registrationNumber_normalized";
ALTER TABLE "public"."companies" DROP CONSTRAINT IF EXISTS "companies_vatNumber_normalized";

DROP INDEX IF EXISTS "public"."companies_organizationId_registrationNumber_key";
DROP INDEX IF EXISTS "public"."companies_organizationId_vatNumber_key";
DROP INDEX IF EXISTS "public"."companies_organizationId_archivedAt_name_idx";

ALTER TABLE "public"."companies"
  DROP COLUMN IF EXISTS "postalCode",
  DROP COLUMN IF EXISTS "phone",
  DROP COLUMN IF EXISTS "country",
  DROP COLUMN IF EXISTS "city",
  DROP COLUMN IF EXISTS "archivedAt",
  DROP COLUMN IF EXISTS "addressLine";
