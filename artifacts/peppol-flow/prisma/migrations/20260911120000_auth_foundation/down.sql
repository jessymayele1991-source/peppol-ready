-- Hand-written rollback. Prisma does not generate down migrations, and without
-- this file the rollback plan for phase 4.0 exists only on paper.
--
-- Apply with:
--   psql "$DATABASE_URL" -f down.sql
--   pnpm --filter @workspace/peppol-flow exec prisma migrate resolve \
--     --rolled-back 20260911120000_auth_foundation
--
-- Cost: every active session is dropped and stored password hashes are lost.
-- No other table is touched.

DROP INDEX IF EXISTS "public"."user_sessions_expiresAt_idx";
DROP TABLE IF EXISTS "public"."user_sessions";
ALTER TABLE "public"."users" DROP COLUMN IF EXISTS "passwordHash";
