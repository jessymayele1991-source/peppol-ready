import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateMigrations, type AppliedMigration } from "./migration-guard";

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

  it("build.mjs bakes the migration list into the bundle", () => {
    const build = readFileSync(join(import.meta.dirname, "../../build.mjs"), "utf8");

    expect(build).toMatch(/__PRISMA_MIGRATIONS__:\s*JSON\.stringify\(migrations\)/);
    expect(build).toMatch(/prisma\/migrations/);
  });

  it("the entrypoint checks migrations before it starts listening", () => {
    const entry = readFileSync(join(import.meta.dirname, "../index.ts"), "utf8");

    const guard = entry.indexOf("assertMigrationsApplied(");
    const listen = entry.indexOf("app.listen(");
    expect(guard).toBeGreaterThan(-1);
    expect(listen).toBeGreaterThan(guard);
  });

  it("production applies migrations before starting the server", () => {
    const artifact = readFileSync(join(import.meta.dirname, "../../.replit-artifact/artifact.toml"), "utf8");
    const run = artifact.slice(artifact.indexOf("[services.production.run]"));

    expect(run).toMatch(/db:deploy && exec node[^"]*dist\/index\.mjs/);
  });
});
