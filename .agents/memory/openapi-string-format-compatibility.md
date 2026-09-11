---
name: OpenAPI string format compatibility
description: String `format` keywords that break Zod generation in this workspace.
---

Do not use `format: email` on OpenAPI string schemas in this workspace. Plain `type: string` generates cleanly.

**Why:** Orval maps `format: email` to the top-level `zod.email()` helper, which is a Zod v4 API. The workspace catalog pins Zod 3.25.x, where the equivalent is `z.string().email()`, so `typecheck:libs` fails after otherwise successful generation. This is the same failure mode as [[openapi-numeric-compatibility]] — the generator emits helpers the pinned Zod does not expose.

**How to apply:** Validate email shape in the service layer, or use `pattern` instead. Before adding any other string `format`, regenerate and run `pnpm run typecheck` — `format: date-time` is already in use and is safe. Note that Orval's `clean: true` wipes the output folder before generating, so a failed run leaves `lib/api-client-react/src/generated/` empty until you fix the spec and regenerate.
