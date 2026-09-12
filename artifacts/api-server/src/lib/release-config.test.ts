import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTrustProxyHops } from "./proxy-config";
import { SESSION_SECRET_POLICY, resolveSessionSecret } from "./session-secret";

const repoRoot = join(import.meta.dirname, "../../../..");

describe("SESSION_SECRET in production", () => {
  const strong = "Vq7mX2pL9sR4tW8yZ1bN6cD3fG5hJ0kQ-strong";

  it("accepts a random secret of the recommended shape", () => {
    expect(resolveSessionSecret(strong, true)).toBe(strong);
    // openssl rand -base64 48 and openssl rand -hex 32 both pass.
    expect(resolveSessionSecret("k3J9x0Qm2vL7pR5tY8wZ1aB4cD6eF9gH0iJ2kL4mN6oP8qR0sT2uV4wX6yZ8aB0c", true)).toBeTruthy();
    expect(resolveSessionSecret("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", true)).toBeTruthy();
  });

  it.each([
    ["missing", undefined, /required in production/],
    ["empty", "", /required in production/],
    ["the development fallback", "peppol-ready-development-secret", /public development value/],
    ["one character", "x", new RegExp(`at least ${SESSION_SECRET_POLICY.minLength} characters; it is 1`)],
    ["31 characters", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P", /at least 32 characters; it is 31/],
    ["long but not random", "a".repeat(64), /fewer than 10 distinct characters/],
    ["a repeated short word", "secretsecretsecretsecretsecretsecret", /fewer than 10 distinct characters/],
  ])("refuses a %s secret, and says how to fix it", (_label, value, message) => {
    expect(() => resolveSessionSecret(value, true)).toThrow(message);
    expect(() => resolveSessionSecret(value, true)).toThrow(/openssl rand -base64 48/);
  });

  it("keeps development and tests working without a secret", () => {
    expect(resolveSessionSecret(undefined, false)).toBe("peppol-ready-development-secret");
    expect(resolveSessionSecret("short", false)).toBe("short");
  });
});

describe("TRUST_PROXY_HOPS", () => {
  it("defaults to one hop", () => {
    expect(resolveTrustProxyHops(undefined)).toBe(1);
    expect(resolveTrustProxyHops("")).toBe(1);
  });

  it.each([["0", 0], ["1", 1], ["2", 2], ["5", 5]])("accepts %s", (value, hops) => {
    expect(resolveTrustProxyHops(value)).toBe(hops);
  });

  it.each(["true", "-1", "1.5", "6", "all", "loopback"])("refuses %s rather than guessing", (value) => {
    expect(() => resolveTrustProxyHops(value)).toThrow(/whole number from 0 to 5/);
  });
});

describe("pnpm build-script configuration", () => {
  const workspace = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const allowBuilds = Object.fromEntries(
    [...(workspace.split(/^allowBuilds:\s*$/m)[1] ?? "").matchAll(/^\s{2}'?([@\w/.-]+)'?:\s*(.+)$/gm)].map(
      (match) => [match[1], match[2]?.trim()],
    ),
  );
  const onlyBuilt = [...(workspace.split(/^onlyBuiltDependencies:\s*$/m)[1] ?? "").split(/^\S/m)[0]!.matchAll(/^\s+-\s+'?([@\w/.-]+)'?/gm)].map(
    (match) => match[1],
  );

  it("never carries the placeholder pnpm writes for undecided packages as a value", () => {
    const settings = workspace
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(settings).not.toContain("set this to true or false");
  });

  it("gives every allowBuilds entry a real boolean, so pnpm 11+ does not fail the install", () => {
    expect(Object.keys(allowBuilds).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(allowBuilds)) {
      expect([name, value]).toEqual([name, expect.stringMatching(/^(true|false)$/)]);
    }
  });

  it("decides every dependency that pnpm reported as having install scripts", () => {
    for (const name of ["esbuild", "prisma", "@prisma/client", "@prisma/engines"]) {
      expect(allowBuilds).toHaveProperty([name]);
    }
  });

  it("keeps pnpm 10 and pnpm 11+ in step for packages allowed to build", () => {
    for (const [name, value] of Object.entries(allowBuilds)) {
      if (value === "true") expect(onlyBuilt).toContain(name);
    }
  });
});

describe("seed guard", () => {
  const peppolFlow = join(repoRoot, "artifacts/peppol-flow");
  const tsx = join(peppolFlow, "node_modules/.bin/tsx");

  function runSeed(env: Record<string, string | undefined>) {
    const result = spawnSync(tsx, ["prisma/seed.ts"], {
      cwd: peppolFlow,
      // Only what the seed needs, so the developer's own DATABASE_URL or
      // SEED_PASSWORD can never leak into these runs.
      env: Object.fromEntries(
        Object.entries({
          PATH: process.env["PATH"],
          HOME: process.env["HOME"],
          ESBUILD_BINARY_PATH: process.env["ESBUILD_BINARY_PATH"],
          ...env,
        }).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      encoding: "utf8",
      timeout: 60_000,
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  // A database that cannot be reached: a refusal must happen before connecting.
  const remote = "postgresql://seed:seed@db.example.invalid:5432/app";

  it.skipIf(!existsSync(tsx))("refuses under NODE_ENV=production, even with a password", { timeout: 90_000 }, () => {
    const run = runSeed({ NODE_ENV: "production", DATABASE_URL: remote, SEED_PASSWORD: "a-long-enough-password" });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("Refusing to seed: NODE_ENV is production");
  });

  it.skipIf(!existsSync(tsx))("refuses a remote database without SEED_PASSWORD", { timeout: 90_000 }, () => {
    const run = runSeed({ DATABASE_URL: remote });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("SEED_PASSWORD is required when DATABASE_URL is not a local database");
  });

  it.skipIf(!existsSync(tsx))("refuses the public development password for a remote database", { timeout: 90_000 }, () => {
    const run = runSeed({ DATABASE_URL: remote, SEED_PASSWORD: "peppol-ready-dev" });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("public development password");
  });

  it.skipIf(!existsSync(tsx))("refuses a short SEED_PASSWORD", { timeout: 90_000 }, () => {
    const run = runSeed({ DATABASE_URL: remote, SEED_PASSWORD: "short" });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("at least 12 characters");
  });

  it("classifies database hosts, treating anything unclear as remote", async () => {
    // Loaded by path at runtime: the seed guard lives in the peppol-flow package,
    // outside this package's TypeScript project.
    const guardPath = join(peppolFlow, "prisma/seed-guard.ts");
    const { isLocalDatabase } = (await import(guardPath)) as {
      isLocalDatabase: (databaseUrl: string | undefined) => boolean;
    };
    expect(isLocalDatabase("postgresql://u:p@localhost:5432/db")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@127.0.0.1:5432/db")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@[::1]:5432/db")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@helium/heliumdb?sslmode=disable")).toBe(false);
    expect(isLocalDatabase("postgresql://u:p@ep-cool-lake.neon.tech/db")).toBe(false);
    expect(isLocalDatabase("postgresql://u:p@localhost/db?host=/var/run/postgresql")).toBe(false);
    expect(isLocalDatabase("not a url")).toBe(false);
    expect(isLocalDatabase(undefined)).toBe(false);
  });
});
