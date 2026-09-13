# Peppol Ready

Peppol Ready helps accounting firms monitor and improve Peppol readiness, compliance, adoption, and risk across their client network.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/peppol-flow run db:migrate` — apply pending Prisma migrations
- `pnpm --filter @workspace/peppol-flow run db:seed` — seed development data (idempotent)
- `pnpm --filter @workspace/peppol-flow run db:deploy` — apply pending migrations without prompting; production runs this before every start
- Required env: `DATABASE_URL` — Postgres connection string
- Required env in production: `SESSION_SECRET` — signs session cookies and keys log pseudonyms. At least 32 characters from at least 10 distinct characters, never the development value; the server refuses to start otherwise. Generate with `openssl rand -base64 48`. Rotating it signs everyone out.
- Optional env: `TRUST_PROXY_HOPS` — number of reverse proxies in front of the API (default 1). Must match the measured chain exactly: too high lets clients forge their address past the sign-in limit, too low makes all clients share one limit.
- Optional env: `LOG_PROXY_CHAIN` — `true` adds X-Forwarded-For, `req.ip` and `req.ips` to request logs, for measuring the proxy chain. Client addresses are personal data; switch it off after measuring.
- Optional env: `WEB_ORIGIN` — enables CORS with credentials for local development, where the web artifact and the API run on different ports. Unset in production, where both are served from one origin.
- Optional env: `SEED_PASSWORD` — password for the seeded demo accounts. Required for any database that is not on localhost (including a Replit workspace database), at least 12 characters, and never the public development password there. The seed refuses to run at all under `NODE_ENV=production`.
- Optional env: `TEST_DATABASE_URL` — a migrated Postgres database; enables the tenant integrity tests, which are skipped without it

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
- `artifacts/api-server/src/lib/company-service.ts` — client and contact management: tenant-scoped, row-locked writes with their audit events
- `artifacts/api-server/src/routes/companies.ts` — client and contact endpoints
- `artifacts/api-server/src/lib/audit-event.ts` — the shared audit row builder, used by auth and client events
- `artifacts/peppol-flow/src/pages/clients.tsx` and `client-detail.tsx` — client list (query state in the URL) and client detail
- `artifacts/peppol-flow/src/components/clients/` — client and contact forms, validated against the generated `@workspace/api-zod` schemas
- `artifacts/api-server/src/lib/permissions.ts` — the capability matrix; the single source for both server enforcement and the capabilities shipped in the session
- `artifacts/api-server/src/middlewares/require-auth.ts` — the only place tenant context is established
- `artifacts/peppol-flow/src/auth/session-context.tsx` — session identity, sign-out, and workspace switching in the UI
- `lib/api-spec/openapi.yaml` — typed readiness API contract
- `docs/peppol-ready-architecture.md` — product boundaries, routes, permissions, domain model, wireframes, and implementation sequence

## Architecture decisions

- Tenant ownership is represented at the persistence boundary through organizations and memberships; client records belong to an organization.
- Operational records are organization-scoped, with companies owning readiness history and optional links from tasks and incidents.
- Prisma is the single ORM. The schema, migrations, and seed live in `artifacts/peppol-flow/prisma/`; the API server consumes the generated client. Never introduce a second ORM against the same database.
- Tenant context is derived from the session through the user's membership, never from a request parameter. `requireAuth` is the only place it is established; every organization-scoped query filters on `req.auth.organizationId`.
- The capability matrix lives only in `permissions.ts`. Routes gate on a capability, and the session ships the same derivation to the client, so the interface hides exactly what the API refuses. Never restate role checks in a component.
- Sessions are httpOnly cookies backed by a Prisma-modelled table. The web artifact and the API share an origin in production, so no token is ever stored in JavaScript.
- The API accepts JSON bodies only. There is deliberately no urlencoded parser: it would let a cross-site HTML form sign a visitor into another account.
- Password verification always runs the full scrypt derivation, against a stand-in hash when the account or its hash is missing, so response time does not reveal which emails have accounts.
- Sign-in is limited per client address (failed or invalid attempts only, so an office behind one NAT address is never locked out by successes), per email address (failures, keyed on the normalized email whether or not an account exists), and by a cap on concurrent password verifications. See `artifacts/api-server/src/lib/login-rate-limit.ts`.
- The server refuses to start when the database is behind the migrations it was built with. `build.mjs` bakes the migration list into the bundle and `index.ts` compares it with `_prisma_migrations` before listening, so a skipped migration fails the startup health check instead of serving 500s.
- Readiness assessment time and source are owned by the server. The contract rejects them (request bodies are strict: undeclared fields fail validation), the service sets them, and PostgreSQL CHECK constraints refuse future assessment timestamps from any write path.
- Self-service registration (`POST /auth/register`) creates an organization named after the person, the user, and an OWNER membership with an `auth.registered` audit event in one transaction, then starts the session through the same `startSession` path as sign-in. An address that already has an account answers 409, which does reveal that it is registered; the separate per-address registration limit (10 per hour) bounds that. Email verification does not exist yet.
- Sign-in, sign-out and organization switches are audited in `audit_events`, committed by `PrismaSessionStore` in the same transaction as the session write. Audit events are queued with `queueAuditOnSave` / `queueAuditOnDestroy`; never write them from a route directly. A switch writes one event in each organization and names neither to the other.
- Failed sign-ins go to structured warn logs (`auth.login.failed`), never to `audit_events`: an unknown account has no organization, and a database write only for real accounts would reopen account enumeration. The email is logged only as an HMAC pseudonym.
- Tenant boundaries are enforced by PostgreSQL, not only by API code. Task, Incident and Report reference companies through composite foreign keys on (companyId, organizationId). User references on tasks, reports and readiness scans pass the `enforce_tenant_membership` trigger, which checks membership at write time only, so history survives a member leaving. `AuditEvent.actorId` is deliberately exempt: a membership check there could block a sign-out audit.
- Client writes lock the client row (`SELECT … WHERE id AND organizationId FOR UPDATE`) and then write only through `updateMany`/`deleteMany` filtered on the organization, checking the count. There is no `update({ where: { id } })` on companies or contacts; `tenant-scope.test.ts` enforces this. Another firm's client answers 404 on every route.
- Archiving is a state, not a deletion: `POST /companies/:id/archive` and `/restore` (clients.archive, OWNER and ADMIN). An archived client is read-only (409 on edits, contact changes and readiness calculation) and left out of the dashboard, its trend and its incidents. Archive and restore are idempotent and audited only when the state changes.
- VAT and registration numbers are stored upper case without whitespace or dots and are unique per organization, enforced by unique indexes and CHECK constraints. An archived client keeps its numbers, so re-adding one answers 409 with a hint to restore it.
- Client audit events (`company.*`, `contact.*`) carry the entity id, the actor and the names of changed fields only, never values. An edit that changes nothing writes nothing.
- Client and contact inputs never carry readiness score, Peppol status, last check, organization or archive state: request bodies are strict and reject them with 400.
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

The current release provides a dashboard-first SaaS shell for client readiness monitoring, including readiness KPIs, distribution and trend views, action prioritization, incident visibility, and client management: a searchable, filterable client list, client details, contacts, and archiving.

## User preferences

- Use the uploaded dashboard screenshot as a visual reference without copying it exactly.
- Prioritize premium enterprise SaaS polish and responsive behavior.

## Gotchas

- Run database commands from the PeppolFlow package: `db:generate`, `db:migrate`, and `db:seed`.
- In the OpenAPI contract, score/count fields use `type: number`; this workspace's generated Zod target does not support the emitted `z.int()` helper. For the same reason, avoid `format: email` — it emits a Zod v4 helper the pinned Zod 3 lacks.
- Orval runs with `clean: true`, so a failed generation leaves `lib/api-client-react/src/generated/` empty until the spec is fixed and codegen rerun.
- The workspace excludes non-linux esbuild and rollup binaries on purpose, so vitest and the build only run on the linux deployment target. Typecheck runs anywhere.
- Replit's nodejs-24 module ships pnpm 10.26.1. Install scripts are configured twice in `pnpm-workspace.yaml`: `onlyBuiltDependencies` for pnpm 10 and `allowBuilds` for pnpm 11+, which fails the install on any package without a boolean. Keep them in step and never commit pnpm's "set this to true or false" placeholder. `packageManager` is deliberately not pinned: under corepack a pinned version makes every other pnpm refuse to run.
- Prisma's own install scripts are disabled, so a fresh install has no generated client. `pnpm run typecheck` (and so `pnpm run build`) runs `db:generate` first, as the API build already does. Run `pnpm run db:generate` before invoking `tsc` or vitest directly on a fresh checkout.
- Replit applies its own schema diff to the production database at publish time. The server therefore also verifies, at startup, that the tenant-integrity constraints, trigger and function exist, and refuses to start if a diff left them out. Never mark Prisma migrations as applied by hand to get past a failed start.
- Login rate limits live in process memory. They reset on every restart or redeploy, and each instance counts separately, so with N instances the effective limit is N times the configured one. A shared store would only replace `FixedWindowLimiter`; the route would not change.
- The per-address limit keys on `req.ip`, which relies on `trust proxy` matching the real number of proxy hops. If the API is reachable without passing the platform proxy, `X-Forwarded-For` can be forged and the per-address limit bypassed; the per-account limit and the verification cap still apply.
- Dev startup also runs the migration guard: run `db:migrate` against a fresh database before `pnpm --filter @workspace/api-server run dev`.
- The `companyTenant` relations on Task, Incident and Report exist only to create the composite foreign keys. Query through `company`, never through `companyTenant`.
- The membership trigger raises `foreign_key_violation`. Prisma reports it as P2003 with no constraint name and without the trigger's message; map P2003 to a client error when adding write endpoints for tasks, reports or scans.
- The company management migration refuses to run if one organization holds two clients whose VAT or registration numbers are equal after normalization, and changes nothing. Merge or correct them, run `prisma migrate resolve --rolled-back 20260914120000_company_management`, then deploy again.
- Prisma passes `contains` to `LIKE` without escaping `%`, `_` and `\`. Escape user search input with `escapeLike` (see `company-service.ts`) or a search for `%` matches every row.
- `prisma.config.ts` fixes the schema and migrations path, so `prisma migrate deploy --schema <other>` still applies the checked-in migrations.
- The tenant integrity migration refuses to run if existing data already crosses a tenant boundary or holds a future assessment timestamp, and changes nothing. Resolve the rows, run `prisma migrate resolve --rolled-back 20260912120000_tenant_integrity`, then deploy again.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
