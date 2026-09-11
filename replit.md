# Peppol Ready

Peppol Ready helps accounting firms monitor and improve Peppol readiness, compliance, adoption, and risk across their client network.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/peppol-flow run db:migrate` — apply pending Prisma migrations
- `pnpm --filter @workspace/peppol-flow run db:seed` — seed development data (idempotent)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Prisma ORM
- Validation: Zod, generated from the OpenAPI spec by Orval
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/peppol-flow/src/App.tsx` — routed application shell and workspace navigation
- `artifacts/peppol-flow/src/pages/dashboard.tsx` — dashboard composition
- `artifacts/peppol-flow/src/components/peppol-ui.tsx` — reusable product UI primitives
- `artifacts/peppol-flow/src/lib/mock-data.ts` — typed dashboard data source for the first UI pass
- `artifacts/peppol-flow/prisma/schema.prisma` — PostgreSQL multi-tenant persistence foundation
- `artifacts/peppol-flow/prisma/seed.ts` — idempotent development seed data
- `artifacts/peppol-flow/prisma/migrations/` — checked-in Prisma migrations
- `artifacts/peppol-flow/prisma.config.ts` — Prisma schema, migration, and seed configuration
- `artifacts/peppol-flow/src/index.css` — product theme, typography, motion, and responsive styles
- `artifacts/peppol-flow/src/i18n/i18n.tsx` — locale discovery, translation context, per-user preference, and locale-aware formatting
- `artifacts/peppol-flow/src/locales/*.json` — Dutch, English, French, and German UI copy
- `artifacts/api-server/src/lib/readiness-engine.ts` — deterministic weighted scoring and explainable risk rules
- `artifacts/api-server/src/lib/readiness-service.ts` — Prisma-backed assessments and dashboard aggregation
- `artifacts/api-server/src/routes/readiness.ts` — readiness calculation and dashboard endpoints
- `lib/api-spec/openapi.yaml` — typed readiness API contract
- `docs/peppol-ready-architecture.md` — product boundaries, routes, permissions, domain model, wireframes, and implementation sequence

## Architecture decisions

- The first pass is intentionally mock-data driven so the information architecture can be validated before business rules and authentication are introduced.
- Tenant ownership is represented at the persistence boundary through organizations and memberships; client records belong to an organization.
- Operational records are organization-scoped, with companies owning readiness history and optional links from tasks and incidents.
- Prisma is the single ORM. The schema, migrations, and seed live in `artifacts/peppol-flow/prisma/`; the API server consumes the generated client. Never introduce a second ORM against the same database.
- Seed records use stable IDs and upserts so development seeding is safe to rerun.
- Readiness is calculated from five explicit factors totaling 100 points; every failed factor produces an explainable remediation signal.
- The target schema supports normalized client contacts, ten-check readiness scans, generated reports, per-user locale preferences, and audit activity.
- Scope explicitly excludes invoice processing, banking, OCR, ledgers, VAT filings, and accounting transactions.
- Dashboard reads are organization-scoped and derive KPIs, breakdowns, risk actions, incidents, and trends from stored assessments.
- Dutch is the default UI language. Every user-facing string must come from the locale files; never hardcode interface copy in components.
- Locale files are discovered automatically. Add another complete JSON locale with `meta.code` and `meta.name` to expose a new language without changing application code.
- Language preference is stored per user, and all dates, numbers, and currencies must use the shared i18n formatters.
- Supporting routes share the same shell and use intentional empty states rather than pretending their workflows are complete.

## Product

The current release provides a dashboard-first SaaS shell for client readiness monitoring, including readiness KPIs, distribution and trend views, action prioritization, incident visibility, and a searchable client overview.

## User preferences

- Use the uploaded dashboard screenshot as a visual reference without copying it exactly.
- Prioritize premium enterprise SaaS polish and responsive behavior.

## Gotchas

- The dashboard uses the readiness API; the remaining shell identity data is still static until authentication is added.
- Run database commands from the PeppolFlow package: `db:generate`, `db:migrate`, and `db:seed`.
- In the OpenAPI contract, score/count fields use `type: number`; this workspace's generated Zod target does not support the emitted `z.int()` helper.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
