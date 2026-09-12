import { hashPassword, verifyPassword } from "@workspace/password";
import { beforeAll, describe, expect, it, vi } from "vitest";

const users = vi.hoisted(() => new Map<string, unknown>());

vi.mock("./prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string } }) =>
        where.email ? (users.get(where.email) ?? null) : null,
      ),
    },
  },
}));

const { verifyCredentials } = await import("./auth-service");

/**
 * Median wall time of `fn`. Medians rather than means: a single GC pause or a
 * busy threadpool on a shared CI runner must not decide the outcome.
 */
async function medianMs(fn: () => Promise<unknown>, runs = 7): Promise<number> {
  await fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint();
    await fn();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? 0;
}

/**
 * Before the fix the ratio was ~160 000x (0.002 ms against 331 ms). A band of
 * 0.6–1.67 is wide enough to absorb machine noise and far too narrow for any
 * skipped derivation to pass.
 */
function expectComparable(unknownMs: number, knownMs: number) {
  const ratio = knownMs / unknownMs;
  expect(ratio).toBeGreaterThan(0.6);
  expect(ratio).toBeLessThan(1 / 0.6);
}

let realHash: string;

beforeAll(async () => {
  realHash = await hashPassword("correct horse battery staple");
  users.set("known@firm.test", {
    id: "user_known",
    passwordHash: realHash,
    memberships: [{ organizationId: "org_a", role: "OWNER", organization: { id: "org_a", name: "A", plan: "PROFESSIONAL" } }],
  });
  users.set("nopassword@firm.test", {
    id: "user_nopassword",
    passwordHash: null,
    memberships: [],
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    expect(await verifyPassword("correct horse battery staple", realHash)).toBe(true);
    expect(await verifyPassword("wrong", realHash)).toBe(false);
  });

  it("never authenticates without a usable hash", async () => {
    for (const unusable of [null, undefined, "", "garbage", "scrypt$x$y$z$$", "bcrypt$1$2$3$a$b"]) {
      expect(await verifyPassword("anything", unusable)).toBe(false);
    }
  });

  it("costs the same for an absent hash as for a real one", { timeout: 60_000 }, async () => {
    const absent = await medianMs(() => verifyPassword("guess", null));
    const real = await medianMs(() => verifyPassword("guess", realHash));
    expectComparable(absent, real);
  });

  it("costs the same for a malformed hash as for a real one", { timeout: 60_000 }, async () => {
    const malformed = await medianMs(() => verifyPassword("guess", "scrypt$not$a$hash$$"));
    const real = await medianMs(() => verifyPassword("guess", realHash));
    expectComparable(malformed, real);
  });
});

describe("verifyCredentials timing", () => {
  it("takes as long for an unknown email as for a known one with a wrong password", { timeout: 60_000 }, async () => {
    const unknown = await medianMs(() => verifyCredentials("nobody@firm.test", "guess"));
    const known = await medianMs(() => verifyCredentials("known@firm.test", "guess"));
    expectComparable(unknown, known);
  });

  it("takes as long for an account without a password as for one with a password", { timeout: 60_000 }, async () => {
    const withoutPassword = await medianMs(() => verifyCredentials("nopassword@firm.test", "guess"));
    const known = await medianMs(() => verifyCredentials("known@firm.test", "guess"));
    expectComparable(withoutPassword, known);
  });

  it("answers null for every failure shape", async () => {
    expect(await verifyCredentials("nobody@firm.test", "guess")).toBeNull();
    expect(await verifyCredentials("known@firm.test", "guess")).toBeNull();
    expect(await verifyCredentials("nopassword@firm.test", "guess")).toBeNull();
  });

  it("signs in with the right password, whatever the email casing", async () => {
    expect(await verifyCredentials("  KNOWN@firm.test ", "correct horse battery staple")).toEqual({
      userId: "user_known",
      organizationId: "org_a",
    });
  });
});
