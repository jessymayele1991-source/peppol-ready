import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tenant isolation is a property of every query, not of one function, so these
 * guard the shape of the code rather than a single call. A database-backed
 * test that signs in as two firms belongs in phase 4.1, once companies have
 * CRUD endpoints to exercise; until then these catch the regressions that
 * actually happened here: a tenant read from a request parameter, and a
 * lookup by id alone.
 */
const srcDir = join(import.meta.dirname, "..");

function read(relativePath: string) {
  return readFileSync(join(srcDir, relativePath), "utf8");
}

describe("tenant context", () => {
  it("is never taken from request parameters", () => {
    for (const file of [
      "routes/readiness.ts",
      "routes/auth.ts",
      "lib/readiness-service.ts",
    ]) {
      const source = read(file);

      expect(source).not.toMatch(/req\.query\s*\.\s*organizationId/);
      expect(source).not.toMatch(/req\.params\s*\.\s*organizationId/);
      expect(source).not.toMatch(/req\.body\s*\.\s*organizationId/);
    }
  });

  it("reaches organization-scoped routes only behind requireAuth", () => {
    const source = read("routes/readiness.ts");
    // Everything between the route path and its handler is the middleware
    // chain; requireAuth has to be in it.
    const chains = [
      ...source.matchAll(/router\.(?:get|post|patch|delete)\(([\s\S]*?)async\s*\(/g),
    ].map((match) => match[1] ?? "");

    expect(chains).toHaveLength(2);
    for (const chain of chains) {
      expect(chain).toContain("requireAuth");
    }
  });

  it("scopes the company lookup to the caller's organization", () => {
    const source = read("lib/readiness-service.ts");

    // findUnique on an id cannot express a tenant filter; findFirst can.
    expect(source).not.toMatch(/prisma\.company\.findUnique/);
    expect(source).toMatch(
      /prisma\.company\.findFirst\(\{\s*where:\s*\{\s*id:\s*companyId,\s*organizationId:/,
    );
  });

  it("records the acting user on the audit event", () => {
    expect(read("lib/readiness-service.ts")).toMatch(
      /actorId:\s*actor\.userId/,
    );
  });

  it("verifies membership before moving the session to another organization", () => {
    const source = read("routes/auth.ts");

    expect(source).toMatch(/canAccessOrganization\(/);
    expect(source).toMatch(/forbidden\(/);
  });

  it("keeps the health check outside the session", () => {
    expect(read("routes/health.ts")).not.toMatch(/requireAuth/);
  });
});
