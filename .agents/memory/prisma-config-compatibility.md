---
name: Prisma configuration compatibility
description: Compatibility rule for Prisma configuration in this workspace.
---

Use `defineConfig` for schema, migrations, and seed settings, but keep the PostgreSQL `DATABASE_URL` reference in `schema.prisma`; do not import the newer `env` helper from `prisma/config`.

**Why:** The installed Prisma 6.16 configuration module supports `defineConfig` but does not expose the newer `env()` helper, so configs using it fail before Prisma can load the schema.

**How to apply:** When changing Prisma configuration, preserve the datasource URL in the schema and validate with `prisma validate` before running migrations.