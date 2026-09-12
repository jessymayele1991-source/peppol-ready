import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const logLines = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../lib/logger", async () => {
  const { default: pino } = await import("pino");
  const { Writable } = await import("node:stream");
  const sink = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split("\n").filter(Boolean)) logLines.push(JSON.parse(line));
      done();
    },
  });
  return { logger: pino({ level: "info" }, sink) };
});

vi.mock("../lib/prisma", async () => {
  const { createFakePrisma } = await import("../test/fake-prisma");
  const fake = createFakePrisma();
  return { prisma: fake.prisma, fake };
});

const { default: app } = await import("../app");
const { fake } = (await import("../lib/prisma")) as unknown as {
  fake: ReturnType<typeof import("../test/fake-prisma").createFakePrisma>;
};
const { resetLoginProtection } = await import("../lib/login-rate-limit");

const PASSWORD = "correct horse battery staple";

let server: Server;
let base: string;

beforeAll(async () => {
  await fake.addUser({
    id: "user_elise",
    name: "Elise Martin",
    email: "elise@firm.test",
    password: PASSWORD,
    memberships: [
      { organizationId: "org_a", organizationName: "Firm A", role: "OWNER" },
      { organizationId: "org_b", organizationName: "Firm B", role: "MEMBER" },
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
  fake.reset();
  resetLoginProtection();
  logLines.length = 0;
});

function post(path: string, body: unknown, cookie?: string) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "audit-test/1.0",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn() {
  const response = await post("/auth/login", { email: "elise@firm.test", password: PASSWORD });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  return cookie as string;
}

/** Nothing secret may appear anywhere in an audit record or security log line. */
function expectNoSecrets(value: unknown, sessionCookie?: string) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(PASSWORD);
  expect(serialized).not.toContain("passwordHash");
  expect(serialized).not.toMatch(/scrypt\$/);
  expect(serialized.toLowerCase()).not.toContain("cookie");
  if (sessionCookie) {
    const sid = decodeURIComponent(sessionCookie.split("=")[1] ?? "");
    expect(serialized).not.toContain(sid.slice(2, 26));
  }
}

describe("auth.login.success", () => {
  it("records the sign-in in the organization it lands in, with the actor", async () => {
    const cookie = await signIn();

    expect(fake.state.audit).toEqual([
      {
        organizationId: "org_a",
        actorId: "user_elise",
        eventType: "auth.login.success",
        entityType: "user",
        entityId: "user_elise",
        metadata: { method: "password", ip: expect.any(String), userAgent: "audit-test/1.0" },
      },
    ]);
    expectNoSecrets(fake.state.audit, cookie);
  });

  it("commits the audit event in the same transaction as the session", async () => {
    await signIn();

    expect(fake.state.transactions).toBe(1);
    expect(fake.state.sessions.size).toBe(1);
    expect(fake.state.audit).toHaveLength(1);
  });

  it("persists neither the session nor the event when the transaction fails", async () => {
    // Fails the explicit save; express-session then retries the save when the
    // response ends, and that retry must still carry the audit event.
    fake.state.failNextTransaction = true;

    const response = await post("/auth/login", { email: "elise@firm.test", password: PASSWORD });

    expect(response.status).toBe(500);
    // Whatever was persisted, a session never exists without its audit record.
    expect(fake.state.audit.length).toBe(fake.state.sessions.size);
  });
});

describe("auth.login.failed", () => {
  it("writes no audit row and logs a structured warning instead", async () => {
    const response = await post("/auth/login", { email: "elise@firm.test", password: "wrong" });

    expect(response.status).toBe(401);
    expect(fake.state.audit).toEqual([]);

    const failures = logLines.filter((line) => line["event"] === "auth.login.failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      level: 40,
      event: "auth.login.failed",
      reason: "invalid_credentials",
      account: expect.stringMatching(/^[0-9a-f]{24}$/),
      userAgent: "audit-test/1.0",
    });
  });

  it("logs an unknown account exactly like a real one, without the address", async () => {
    await post("/auth/login", { email: "elise@firm.test", password: "wrong" });
    await post("/auth/login", { email: "nobody@firm.test", password: "wrong" });

    const [known, unknown] = logLines.filter((line) => line["event"] === "auth.login.failed");
    expect(Object.keys(known ?? {}).sort()).toEqual(Object.keys(unknown ?? {}).sort());
    expect(known?.["account"]).not.toBe(unknown?.["account"]);
    expect(JSON.stringify(logLines)).not.toContain("elise@firm.test");
    expect(JSON.stringify(logLines)).not.toContain("nobody@firm.test");
  });

  it("pseudonymizes the same account the same way, whatever the casing", async () => {
    await post("/auth/login", { email: "elise@firm.test", password: "wrong" });
    await post("/auth/login", { email: " ELISE@firm.test", password: "wrong" });

    const [first, second] = logLines.filter((line) => line["event"] === "auth.login.failed");
    expect(first?.["account"]).toBe(second?.["account"]);
  });

  it("never logs the attempted password", async () => {
    await post("/auth/login", { email: "elise@firm.test", password: "Hunter2-secret-guess" });

    expect(JSON.stringify(logLines)).not.toContain("Hunter2-secret-guess");
  });

  it("records why a malformed attempt failed, with no account", async () => {
    await post("/auth/login", { email: "elise@firm.test" });

    expect(logLines.find((line) => line["event"] === "auth.login.failed")).toMatchObject({
      reason: "invalid_request",
      account: null,
    });
  });
});

describe("auth.logout", () => {
  it("records the sign-out in the active organization, together with the session deletion", async () => {
    const cookie = await signIn();
    fake.state.audit.length = 0;
    const transactionsBefore = fake.state.transactions;

    const response = await post("/auth/logout", undefined, cookie);

    expect(response.status).toBe(204);
    expect(fake.state.transactions).toBe(transactionsBefore + 1);
    expect(fake.state.sessions.size).toBe(0);
    expect(fake.state.audit).toEqual([
      expect.objectContaining({ organizationId: "org_a", actorId: "user_elise", eventType: "auth.logout" }),
    ]);
    expectNoSecrets(fake.state.audit, cookie);
  });

  it("records nothing for a visitor who was never signed in", async () => {
    const response = await post("/auth/logout", undefined);

    expect(response.status).toBe(204);
    expect(fake.state.audit).toEqual([]);
  });
});

describe("auth.organization_switched", () => {
  it("records the switch in both organizations, without naming the other", async () => {
    const cookie = await signIn();
    fake.state.audit.length = 0;

    const response = await post("/auth/organization", { organizationId: "org_b" }, cookie);

    expect(response.status).toBe(200);
    expect(fake.state.audit).toEqual([
      expect.objectContaining({
        organizationId: "org_a",
        actorId: "user_elise",
        eventType: "auth.organization_switched",
        metadata: expect.objectContaining({ direction: "left" }),
      }),
      expect.objectContaining({
        organizationId: "org_b",
        actorId: "user_elise",
        eventType: "auth.organization_switched",
        metadata: expect.objectContaining({ direction: "entered" }),
      }),
    ]);
    // Firm A's trail does not reveal Firm B, and the reverse.
    expect(JSON.stringify(fake.state.audit[0]?.metadata)).not.toContain("org_b");
    expect(JSON.stringify(fake.state.audit[1]?.metadata)).not.toContain("org_a");
    expectNoSecrets(fake.state.audit, cookie);
  });

  it("records nothing when switching to the organization already active", async () => {
    const cookie = await signIn();
    fake.state.audit.length = 0;

    const response = await post("/auth/organization", { organizationId: "org_a" }, cookie);

    expect(response.status).toBe(200);
    expect(fake.state.audit).toEqual([]);
  });

  it("records nothing when the switch is refused", async () => {
    const cookie = await signIn();
    fake.state.audit.length = 0;

    const response = await post("/auth/organization", { organizationId: "org_not_mine" }, cookie);

    expect(response.status).toBe(403);
    expect(fake.state.audit).toEqual([]);
  });
});
