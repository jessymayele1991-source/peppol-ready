-- Client management: contact and address fields, archiving, and one client per
-- VAT number and per registration number within an organization.
--
-- Additive. The only change to existing rows is normalizing VAT and
-- registration numbers to the stored form (upper case, no spaces or dots, empty
-- becomes NULL), which is what makes the unique indexes meaningful.

-- Pre-flight: refuse to run, changing nothing, if normalizing would merge two
-- existing clients of one organization onto the same number. Those clients must
-- be reviewed by a person; picking one automatically would lose data.
DO $$
DECLARE
  duplicate_vat integer;
  duplicate_registration integer;
BEGIN
  SELECT count(*) INTO duplicate_vat FROM (
    SELECT "organizationId", upper(regexp_replace("vatNumber", '[[:space:].]', '', 'g')) AS normalized
    FROM "public"."companies"
    WHERE nullif(regexp_replace("vatNumber", '[[:space:].]', '', 'g'), '') IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO duplicate_registration FROM (
    SELECT "organizationId", upper(regexp_replace("registrationNumber", '[[:space:].]', '', 'g')) AS normalized
    FROM "public"."companies"
    WHERE nullif(regexp_replace("registrationNumber", '[[:space:].]', '', 'g'), '') IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) > 1
  ) duplicates;

  IF duplicate_vat > 0 OR duplicate_registration > 0 THEN
    RAISE EXCEPTION 'company_management: % duplicate VAT number group(s) and % duplicate registration number group(s) within an organization. Merge or correct those clients, then run the migration again. Nothing was changed.',
      duplicate_vat, duplicate_registration;
  END IF;
END $$;

-- Normalize existing identifiers to the stored form.
UPDATE "public"."companies"
SET "vatNumber" = nullif(upper(regexp_replace("vatNumber", '[[:space:].]', '', 'g')), '')
WHERE "vatNumber" IS NOT NULL;

UPDATE "public"."companies"
SET "registrationNumber" = nullif(upper(regexp_replace("registrationNumber", '[[:space:].]', '', 'g')), '')
WHERE "registrationNumber" IS NOT NULL;

-- AlterTable
ALTER TABLE "public"."companies" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT;

-- CreateIndex
CREATE INDEX "companies_organizationId_archivedAt_name_idx" ON "public"."companies"("organizationId", "archivedAt", "name");

-- CreateIndex
CREATE UNIQUE INDEX "companies_organizationId_vatNumber_key" ON "public"."companies"("organizationId", "vatNumber");

-- CreateIndex
CREATE UNIQUE INDEX "companies_organizationId_registrationNumber_key" ON "public"."companies"("organizationId", "registrationNumber");

-- Identifiers are stored normalized, enforced by the database so no write path
-- can store "BE 0123.456.789" next to "BE0123456789" and slip past the index.
ALTER TABLE "public"."companies"
  ADD CONSTRAINT "companies_vatNumber_normalized"
  CHECK ("vatNumber" IS NULL OR ("vatNumber" <> '' AND "vatNumber" = upper(regexp_replace("vatNumber", '[[:space:].]', '', 'g'))));

ALTER TABLE "public"."companies"
  ADD CONSTRAINT "companies_registrationNumber_normalized"
  CHECK ("registrationNumber" IS NULL OR ("registrationNumber" <> '' AND "registrationNumber" = upper(regexp_replace("registrationNumber", '[[:space:].]', '', 'g'))));

ALTER TABLE "public"."companies"
  ADD CONSTRAINT "companies_country_iso_alpha2"
  CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');

ALTER TABLE "public"."companies"
  ADD CONSTRAINT "companies_archivedAt_not_future"
  CHECK ("archivedAt" IS NULL OR "archivedAt" <= now() + interval '5 minutes');
