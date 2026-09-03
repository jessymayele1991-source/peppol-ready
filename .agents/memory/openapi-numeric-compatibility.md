---
name: OpenAPI numeric compatibility
description: Numeric schema rule for the workspace's Orval and Zod versions.
---

Use OpenAPI `type: number` for generated score, count, and other numeric response fields in this workspace rather than `type: integer`.

**Why:** The current Orval output maps `integer` to `z.int()`, but the pinned Zod package does not expose that helper, causing library typechecking to fail after otherwise successful generation.

**How to apply:** Keep integer-only validation inside application logic or boundary refinements until the generator and Zod versions are upgraded together.