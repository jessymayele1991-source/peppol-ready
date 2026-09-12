import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { hashPassword } from "@workspace/password";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runs the real Express app — parsers, session middleware, routes, and error
 * handler exactly as mounted in app.ts — with only the database and the
 * logger replaced.
 */
const state = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../lib/logger", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
});

vi.mock("../lib/prisma", () => {
  const byId = (id: string) =>
    [...state.users.values()].find((user) => user["id"] === id) ?? null;

  return {
    prisma: {
      user: {
        findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) =>
          where.email !== undefined
            ? (state.users.get(where.email) ?? null)
            : byId(where.id ?? ""),
        ),
      },
      userSession: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({})),
        deleteMany: vi.fn(async () => ({ count: 0 })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      membership: { findUnique: vi.fn(async () => null) },
      auditEvent: { create: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    },
  };
});

const { default: app } = await import("../app");
const { prisma } = await import("../lib/prisma");
const { LOGIN_LIMITS, resetLoginProtection } = await import("../lib/login-rate-limit");

const findUser = vi.mocked(prisma.user.findUnique);

let server: Server;
let base: string;

beforeAll(async () => {
  const passwordHash = await hashPassword("correct horse battery staple");
  state.users.set("elise@firm.test", {
    id: "user_elise",
    name: "Elise Martin",
    email: "elise@firm.test",
    avatarInitials: "EM",
    preferredLocale: "nl",
    passwordHash,
    memberships: [
      { organizationId: "org_a", role: "OWNER", organization: { id: "org_a", name: "Firm A", plan: "PROFESSIONAL" } },
    ],
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetLoginProtection();
  findUser.mockClear();
});

function login(body: string, contentType = "application/json") {
  return fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

const json = (value: unknown) => JSON.stringify(value);

describe("body parser errors", () => {
  it("answers malformed JSON with 400, not 500", async () => {
    const response = await login('{"email":');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "bad_request", message: "The request body is not valid JSON." },
    });
  });

  it("answers an oversized body with 413, not 500", async () => {
    const response = await login(json({ email: "a".repeat(120_000), password: "x" }));

    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("payload_too_large");
  });

  it("applies the same handling on every JSON endpoint", async () => {
    const response = await fetch(`${base}/auth/organization`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("bad_request");
  });

  it("never reaches the database for a body it could not parse", async () => {
    await login('{"email":');
    await login(json({ email: "a".repeat(120_000), password: "x" }));

    expect(findUser).not.toHaveBeenCalled();
  });
});

describe("sign-in from a cross-site form", () => {
  it("rejects a urlencoded form body before any credential check", async () => {
    const response = await login(
      "email=elise%40firm.test&password=correct+horse+battery+staple",
      "application/x-www-form-urlencoded",
    );

    expect(response.status).toBe(400);
    expect(findUser).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a text/plain form body carrying JSON", async () => {
    const response = await login(
      json({ email: "elise@firm.test", password: "correct horse battery staple" }),
      "text/plain",
    );

    expect(response.status).toBe(400);
    expect(findUser).not.toHaveBeenCalled();
  });

  it("still signs in over JSON", async () => {
    const response = await login(json({ email: "elise@firm.test", password: "correct horse battery staple" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/peppol_ready_sid=.*HttpOnly/i);
  });
});

describe("login rate limiting", () => {
  it("blocks an account after repeated failures, with Retry-After", { timeout: 60_000 }, async () => {
    for (let i = 0; i < LOGIN_LIMITS.perAccount; i += 1) {
      const response = await login(json({ email: "elise@firm.test", password: `wrong-${i}` }));
      expect(response.status).toBe(401);
    }

    const blocked = await login(json({ email: "elise@firm.test", password: "correct horse battery staple" }));

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toEqual({
      error: { code: "too_many_requests", message: "Too many sign-in attempts. Try again later." },
    });
    // The blocked attempt was refused before any password work.
    expect(findUser).toHaveBeenCalledTimes(LOGIN_LIMITS.perAccount);
  });

  it("counts the account across casing and padding", { timeout: 60_000 }, async () => {
    const variants = ["elise@firm.test", "ELISE@firm.test", " Elise@Firm.Test "];
    for (let i = 0; i < LOGIN_LIMITS.perAccount; i += 1) {
      await login(json({ email: variants[i % variants.length], password: "wrong" }));
    }

    const blocked = await login(json({ email: "elise@FIRM.test", password: "wrong" }));
    expect(blocked.status).toBe(429);
  });

  it("limits unknown emails exactly like real accounts", { timeout: 60_000 }, async () => {
    for (let i = 0; i < LOGIN_LIMITS.perAccount; i += 1) {
      await login(json({ email: "nobody@firm.test", password: "wrong" }));
    }

    const blocked = await login(json({ email: "nobody@firm.test", password: "wrong" }));
    expect(blocked.status).toBe(429);
  });

  it("clears the account counter after a successful sign-in", { timeout: 60_000 }, async () => {
    for (let i = 0; i < LOGIN_LIMITS.perAccount - 1; i += 1) {
      await login(json({ email: "elise@firm.test", password: "wrong" }));
    }
    const success = await login(json({ email: "elise@firm.test", password: "correct horse battery staple" }));
    expect(success.status).toBe(200);

    const afterReset = await login(json({ email: "elise@firm.test", password: "wrong" }));
    expect(afterReset.status).toBe(401);
  });

  it("never locks out an address for successful sign-ins", { timeout: 60_000 }, async () => {
    // An office behind one NAT address signing in at the start of the day.
    for (let i = 0; i < LOGIN_LIMITS.perClient + 5; i += 1) {
      const response = await login(json({ email: "elise@firm.test", password: "correct horse battery staple" }));
      expect(response.status).toBe(200);
    }
  });

  it("blocks a client address after too many failed or invalid attempts", async () => {
    // Invalid bodies are cheap and still count, so spraying cannot stay under the limit.
    for (let i = 0; i < LOGIN_LIMITS.perClient; i += 1) {
      const response = await login(json({}));
      expect(response.status).toBe(400);
    }

    const blocked = await login(json({ email: "elise@firm.test", password: "correct horse battery staple" }));

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(findUser).not.toHaveBeenCalled();
  });

  it("caps concurrent password verifications", { timeout: 60_000 }, async () => {
    const burst = LOGIN_LIMITS.concurrentVerifications + 8;
    const responses = await Promise.all(
      Array.from({ length: burst }, (_, i) =>
        login(json({ email: `spray-${i}@firm.test`, password: "wrong" })),
      ),
    );
    const statuses = responses.map((response) => response.status);

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(LOGIN_LIMITS.concurrentVerifications);
    expect(statuses.every((status) => status === 401 || status === 429)).toBe(true);
  });
});
