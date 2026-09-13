import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_DATABASE_OBJECTS,
  evaluateDatabaseObjects,
  evaluateMigrations,
  type AppliedMigration,
} from "./migration-guard";

const migrationsDir = join(import.meta.dirname, "../../../peppol-flow/prisma/migrations");

const done = (migration_name: string): AppliedMigration => ({
  migration_name,
  finished_at: new Date("2026-09-01T00:00:00Z"),
  rolled_back_at: null,
});

describe("evaluateMigrations", () => {
  const expected = ["20260903_a", "20260904_b", "20260911_c"];

  it("is satisfied when every shipped migration finished", () => {
    expect(evaluateMigrations(expected, expected.map(done))).toEqual({
      ok: true,
      missing: [],
      failed: [],
      unknown: [],
    });
  });

  it("refuses a database that is behind the build", () => {
    const state = evaluateMigrations(expected, [done("20260903_a"), done("20260904_b")]);

    expect(state.ok).toBe(false);
    expect(state.missing).toEqual(["20260911_c"]);
  });

  it("refuses a database that was never migrated", () => {
    const state = evaluateMigrations(expected, []);

    expect(state.ok).toBe(false);
    expect(state.missing).toEqual(expected);
  });

  it("refuses a migration that started but never finished", () => {
    const state = evaluateMigrations(expected, [
      done("20260903_a"),
      done("20260904_b"),
      { migration_name: "20260911_c", finished_at: null, rolled_back_at: null },
    ]);

    expect(state.ok).toBe(false);
    expect(state.failed).toEqual(["20260911_c"]);
    expect(state.missing).toEqual(["20260911_c"]);
  });

  it("treats a rolled-back migration as not applied", () => {
    const state = evaluateMigrations(expected, [
      done("20260903_a"),
      done("20260904_b"),
      { migration_name: "20260911_c", finished_at: new Date(), rolled_back_at: new Date() },
    ]);

    expect(state.ok).toBe(false);
    expect(state.missing).toEqual(["20260911_c"]);
    expect(state.failed).toEqual([]);
  });

  it("accepts a failed attempt that was later re-applied", () => {
    const state = evaluateMigrations(expected, [
      ...expected.map(done),
      { migration_name: "20260911_c", finished_at: null, rolled_back_at: new Date() },
    ]);

    expect(state.ok).toBe(true);
  });

  it("starts, with a report, when the database is ahead of the build", () => {
    const state = evaluateMigrations(expected, [...expected.map(done), done("20261001_d")]);

    expect(state.ok).toBe(true);
    expect(state.unknown).toEqual(["20261001_d"]);
  });
});

describe("evaluateDatabaseObjects", () => {
  const all = {
    constraints: [...REQUIRED_DATABASE_OBJECTS.constraints, "unrelated_pkey"],
    triggers: [...REQUIRED_DATABASE_OBJECTS.triggers],
    functions: [...REQUIRED_DATABASE_OBJECTS.functions],
  };

  it("is satisfied when every enforcing object is present", () => {
    expect(evaluateDatabaseObjects(REQUIRED_DATABASE_OBJECTS, all)).toEqual({ ok: true, missing: [] });
  });

  it("refuses a database whose schema diff dropped the membership triggers", () => {
    const result = evaluateDatabaseObjects(REQUIRED_DATABASE_OBJECTS, { ...all, triggers: [], functions: [] });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      "trigger tasks_enforce_tenant_membership",
      "trigger reports_enforce_tenant_membership",
      "trigger readiness_scans_enforce_tenant_membership",
      "function enforce_tenant_membership",
    ]);
  });

  it("refuses a database whose foreign keys carry other names", () => {
    const renamed = all.constraints.map((name) => name.replace("_fkey", "_fk"));
    const result = evaluateDatabaseObjects(REQUIRED_DATABASE_OBJECTS, { ...all, constraints: renamed });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("constraint tasks_companyId_organizationId_fkey");
  });

  it("names exactly what the tenant integrity migration creates", () => {
    const sql = readFileSync(join(migrationsDir, "20260912120000_tenant_integrity", "migration.sql"), "utf8");
    for (const name of [
      ...REQUIRED_DATABASE_OBJECTS.constraints,
      ...REQUIRED_DATABASE_OBJECTS.triggers,
      ...REQUIRED_DATABASE_OBJECTS.functions,
    ]) {
      expect(sql).toContain(`"${name}"`);
    }
  });
});

describe("shipped migrations", () => {
  const directories = readdirSync(migrationsDir).filter((entry) =>
    statSync(join(migrationsDir, entry)).isDirectory(),
  );

  it("every migration directory holds a migration.sql", () => {
    expect(directories.length).toBeGreaterThan(0);
    for (const directory of directories) {
      expect(statSync(join(migrationsDir, directory, "migration.sql")).isFile()).toBe(true);
    }
  });

  it("names sort chronologically, which the build relies on", () => {
    for (const directory of directories) {
      expect(directory).toMatch(/^\d{14}_[a-z0-9_]+$/);
    }
  });

  it("includes the auth foundation that sign-in depends on", () => {
    expect(directories).toContain("20260911120000_auth_foundation");
  });

  it("includes the tenant integrity migration, after the auth foundation", () => {
    const sorted = [...directories].sort();
    expect(sorted.indexOf("20260912120000_tenant_integrity")).toBeGreaterThan(
      sorted.indexOf("20260911120000_auth_foundation"),
    );
  });

  it("the tenant integrity migration checks existing data before any DDL", () => {
    const sql = readFileSync(join(migrationsDir, "20260912120000_tenant_integrity", "migration.sql"), "utf8");
    const preflight = sql.indexOf("DO $$");
    const firstDdl = sql.search(/^(CREATE|ALTER)\s/m);

    expect(preflight).toBeGreaterThan(-1);
    expect(firstDdl).toBeGreaterThan(preflight);
    expect(sql).not.toMatch(/^\s*DROP\s/im);
  });

  it("includes the client management migration, after tenant integrity", () => {
    const sorted = [...directories].sort();
    expect(sorted.indexOf("20260914120000_company_management")).toBeGreaterThan(
      sorted.indexOf("20260912120000_tenant_integrity"),
    );
  });

  it("the client management migration refuses duplicate identifiers before normalizing or any DDL", () => {
    const sql = readFileSync(join(migrationsDir, "20260914120000_company_management", "migration.sql"), "utf8");
    const preflight = sql.indexOf("DO $$");
    const normalize = sql.search(/^UPDATE\s+"public"\."companies"/m);
    const firstDdl = sql.search(/^(CREATE|ALTER)\s/m);

    expect(preflight).toBeGreaterThan(-1);
    expect(normalize).toBeGreaterThan(preflight);
    expect(firstDdl).toBeGreaterThan(normalize);
    expect(sql).toMatch(/RAISE EXCEPTION/);
    expect(sql).not.toMatch(/^\s*DROP\s/im);
    for (const name of [
      "companies_organizationId_vatNumber_key",
      "companies_organizationId_registrationNumber_key",
      "companies_vatNumber_normalized",
      "companies_registrationNumber_normalized",
      "companies_country_iso_alpha2",
      "companies_archivedAt_not_future",
    ]) {
      expect(sql).toContain(`"${name}"`);
    }
  });

  it("build.mjs bakes the migration list into the bundle", () => {
    const build = readFileSync(join(import.meta.dirname, "../../build.mjs"), "utf8");

    expect(build).toMatch(/__PRISMA_MIGRATIONS__:\s*JSON\.stringify\(migrations\)/);
    expect(build).toMatch(/prisma\/migrations/);
  });

  it("the entrypoint checks migrations before it starts listening", () => {
    const entry = readFileSync(join(import.meta.dirname, "../index.ts"), "utf8");

    const guard = entry.indexOf("assertMigrationsApplied(");
    const objects = entry.indexOf("assertDatabaseObjectsPresent(");
    const listen = entry.indexOf("app.listen(");
    expect(guard).toBeGreaterThan(-1);
    expect(objects).toBeGreaterThan(guard);
    expect(listen).toBeGreaterThan(objects);
  });

  it("production applies migrations before starting the server", () => {
    const artifact = readFileSync(join(import.meta.dirname, "../../.replit-artifact/artifact.toml"), "utf8");
    const run = artifact.slice(artifact.indexOf("[services.production.run]"));

    expect(run).toMatch(/db:deploy && exec node[^"]*dist\/index\.mjs/);
  });
});
