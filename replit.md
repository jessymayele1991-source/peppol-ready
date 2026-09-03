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
- `artifacts/peppol-flow/src/index.css` — product theme, typography, motion, and responsive styles

## Architecture decisions

- The first pass is intentionally mock-data driven so the information architecture can be validated before business rules and authentication are introduced.
- Tenant ownership is represented at the persistence boundary through organizations and memberships; client records belong to an organization.
- Supporting routes share the same shell and use intentional empty states rather than pretending their workflows are complete.

## Product

The current release provides a dashboard-first SaaS shell for client readiness monitoring, including readiness KPIs, distribution and trend views, action prioritization, incident visibility, and a searchable client overview.

## User preferences

- Use the uploaded dashboard screenshot as a visual reference without copying it exactly.
- Prioritize premium enterprise SaaS polish and responsive behavior.

## Gotchas

- Mock data is not persisted yet; the Prisma schema is ready for the next backend pass.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
