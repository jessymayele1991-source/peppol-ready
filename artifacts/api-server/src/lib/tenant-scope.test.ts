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
      "routes/companies.ts",
      "lib/readiness-service.ts",
      "lib/company-service.ts",
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

  it("puts every client route behind requireAuth and a clients capability", () => {
    const source = read("routes/companies.ts");
    const routes = [
      ...source.matchAll(/router\.(get|post|patch|delete)\(\s*"([^"]+)"([\s\S]*?)async\s*\(/g),
    ].map((match) => ({ method: match[1], path: match[2], chain: match[3] ?? "" }));

    expect(routes).toHaveLength(10);
    for (const route of routes) {
      expect(route.chain, `${route.method} ${route.path}`).toContain("requireAuth");
      expect(route.chain, `${route.method} ${route.path}`).toMatch(/requireCapability\("clients\.(view|write|archive)"\)/);
    }
    // Reads need view, archive and restore need archive, everything else needs write.
    for (const route of routes) {
      const expected =
        route.method === "get" ? "clients.view" : /\/(archive|restore)$/.test(route.path ?? "") ? "clients.archive" : "clients.write";
      expect(route.chain, `${route.method} ${route.path}`).toContain(`requireCapability("${expected}")`);
    }
  });

  it("never writes a client or contact by id alone", () => {
    const source = read("lib/company-service.ts") + read("lib/readiness-service.ts");

    // update/delete/upsert on a single row can only filter on its unique id.
    expect(source).not.toMatch(/\.(company|clientContact)\.(update|delete|upsert)\(/);
  });

  it("scopes every bulk write to the caller's organization", () => {
    const source = read("lib/company-service.ts") + read("lib/readiness-service.ts");
    // The where filter runs up to the data key, or to the end of the call.
    const writes = [
      ...source.matchAll(/\.(company|clientContact)\.(updateMany|deleteMany)\(\{\s*where:\s*([\s\S]*?)(?:\bdata:|\}\s*\))/g),
    ];

    expect(writes.length).toBe(6);
    for (const write of writes) {
      const where = write[3] ?? "";
      expect(where, write[0]).toMatch(/organizationId|scope\b/);
    }
    // `scope` is the contact filter, which itself carries the organization.
    expect(source).toMatch(/const scope = \{ id: contactId, companyId, company: \{ organizationId: actor\.organizationId \} \}/);
  });

  it("locks the client row within the caller's organization before writing", () => {
    const source = read("lib/company-service.ts");

    expect(source).toMatch(
      /WHERE "id" = \$\{companyId\} AND "organizationId" = \$\{actor\.organizationId\}\s*FOR UPDATE/,
    );
    // Exactly one raw query, and it is that lock.
    expect(source.match(/\$queryRaw/g)).toHaveLength(1);
  });

  it("keeps the health check outside the session", () => {
    expect(read("routes/health.ts")).not.toMatch(/requireAuth/);
  });
});
