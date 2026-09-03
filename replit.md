# PeppolFlow

PeppolFlow helps accounting teams monitor and improve Peppol readiness across their client network.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
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
- `artifacts/api-server/src/lib/readiness-engine.ts` — deterministic weighted scoring and explainable risk rules
- `artifacts/api-server/src/lib/readiness-service.ts` — Prisma-backed assessments and dashboard aggregation
- `artifacts/api-server/src/routes/readiness.ts` — readiness calculation and dashboard endpoints
- `lib/api-spec/openapi.yaml` — typed readiness API contract

## Architecture decisions

- The first pass is intentionally mock-data driven so the information architecture can be validated before business rules and authentication are introduced.
- Tenant ownership is represented at the persistence boundary through organizations and memberships; client records belong to an organization.
- Operational records are organization-scoped, with companies owning readiness history and optional links from tasks and incidents.
- Seed records use stable IDs and upserts so development seeding is safe to rerun.
- Readiness is calculated from five explicit factors totaling 100 points; every failed factor produces an explainable remediation signal.
- Dashboard reads are organization-scoped and derive KPIs, breakdowns, risk actions, incidents, and trends from stored assessments.
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
