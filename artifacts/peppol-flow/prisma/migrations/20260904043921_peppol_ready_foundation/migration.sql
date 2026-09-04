-- CreateEnum
CREATE TYPE "public"."ReadinessCategory" AS ENUM ('NOT_STARTED', 'BASIC', 'ADVANCED', 'READY', 'FULLY_COMPLIANT');

-- CreateEnum
CREATE TYPE "public"."ReportType" AS ENUM ('READINESS', 'RISK', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "public"."ReportStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "public"."companies" ADD COLUMN     "industry" TEXT,
ADD COLUMN     "vatNumber" TEXT;

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "preferredLocale" TEXT NOT NULL DEFAULT 'nl';

-- CreateTable
CREATE TABLE "public"."client_contacts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "public"."readiness_checks" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "evidence" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "readiness_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "generatedById" TEXT,
    "type" "public"."ReportType" NOT NULL,
    "status" "public"."ReportStatus" NOT NULL DEFAULT 'PENDING',
    "locale" TEXT NOT NULL DEFAULT 'nl',
    "filePath" TEXT,
    "periodStart" TIMESTAMPTZ(3),
    "periodEnd" TIMESTAMPTZ(3),
    "generatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_contacts_companyId_isPrimary_idx" ON "public"."client_contacts"("companyId", "isPrimary");

-- CreateIndex
CREATE INDEX "readiness_scans_companyId_completedAt_idx" ON "public"."readiness_scans"("companyId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "readiness_checks_scanId_key_key" ON "public"."readiness_checks"("scanId", "key");

-- CreateIndex
CREATE INDEX "reports_organizationId_type_createdAt_idx" ON "public"."reports"("organizationId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "reports_companyId_idx" ON "public"."reports"("companyId");

-- AddForeignKey
ALTER TABLE "public"."client_contacts" ADD CONSTRAINT "client_contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."readiness_scans" ADD CONSTRAINT "readiness_scans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."readiness_scans" ADD CONSTRAINT "readiness_scans_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."readiness_checks" ADD CONSTRAINT "readiness_checks_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "public"."readiness_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reports" ADD CONSTRAINT "reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reports" ADD CONSTRAINT "reports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reports" ADD CONSTRAINT "reports_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
