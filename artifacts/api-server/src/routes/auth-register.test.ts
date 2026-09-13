import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { verifyPassword } from "@workspace/password";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Registration through the real Express app — parsers, rate limits, session
 * middleware, routes and error handler as mounted in app.ts — with an in-memory
 * database. Atomicity against PostgreSQL is proven in registration.db.test.ts.
 */

vi.mock("../lib/logger", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
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
const { REGISTRATION_LIMITS, resetLoginProtection } = await import("../lib/login-rate-limit");

const PASSWORD = "a long enough password";

let server: Server;
let base: string;
let emailCounter = 0;
/** Registered accounts persist in the fake database, so every test uses its own address. */
const freshEmail = () => `new.owner.${(emailCounter += 1)}@firm.test`;

beforeAll(async () => {
  await fake.addUser({
    id: "user_existing",
    name: "Existing User",
    email: "existing@firm.test",
    password: PASSWORD,
    memberships: [{ organizationId: "org_existing", organizationName: "Existing Firm", role: "OWNER" }],
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
});

function post(path: string, body: unknown, cookie?: string) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "register-test/1.0", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

type SessionBody = {
  user: { id: string; name: string; email: string; avatarInitials: string };
  organization: { id: string; name: string; plan: string };
  role: string;
  capabilities: string[];
  memberships: Array<{ organizationId: string; organizationName: string; role: string }>;
};

describe("POST /auth/register", () => {
  it("creates the user, an organization and an OWNER membership, and signs in", async () => {
    const email = freshEmail();
    const response = await post("/auth/register", { name: "  Nieuwe   Eigenaar ", email, password: PASSWORD });

    expect(response.status).toBe(201);
    const session = (await response.json()) as SessionBody;
    expect(session.user).toMatchObject({ name: "Nieuwe Eigenaar", email, avatarInitials: "NE" });
    expect(session.role).toBe("OWNER");
    // An owner holds every capability in the matrix.
    const { CAPABILITIES } = await import("../lib/permissions");
    expect([...session.capabilities].sort()).toEqual([...CAPABILITIES].sort());
    expect(session.organization.name).toBe("Nieuwe Eigenaar");
    expect(session.memberships).toEqual([
      { organizationId: session.organization.id, organizationName: "Nieuwe Eigenaar", role: "OWNER" },
    ]);

    const organization = fake.state.organizations.get(session.organization.id);
    expect(organization?.["slug"]).toMatch(/^nieuwe-eigenaar-[0-9a-f]{8}$/);
  });

  it("starts a real session: the cookie is valid for the session endpoint", async () => {
    const response = await post("/auth/register", { name: "Sessie Test", email: freshEmail(), password: PASSWORD });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/peppol_ready_sid=.*HttpOnly/i);

    const session = await fetch(`${base}/auth/session`, { headers: { cookie: setCookie.split(";")[0] as string } });
    expect(session.status).toBe(200);
  });

  it("stores the email normalized and the password only as a hash that verifies", async () => {
    const response = await post("/auth/register", { name: "Hash Test", email: "  Mixed.Case@Firm.TEST ", password: PASSWORD });
    const { user } = (await response.json()) as SessionBody;

    const stored = fake.state.users.get(user.id);
    expect(stored?.["email"]).toBe("mixed.case@firm.test");
    expect(stored?.["passwordHash"]).toMatch(/^scrypt\$/);
    expect(stored?.["passwordHash"]).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored?.["passwordHash"] as string)).toBe(true);
  });

  it("lets the new account sign in afterwards with the same credentials", async () => {
    const email = freshEmail();
    await post("/auth/register", { name: "Later Aanmelden", email, password: PASSWORD });

    const login = await post("/auth/login", { email, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("records the registration and the sign-in, without the email or password", async () => {
    const email = freshEmail();
    const response = await post("/auth/register", { name: "Audit Test", email, password: PASSWORD });
    const session = (await response.json()) as SessionBody;

    const types = fake.state.audit.map((event) => event.eventType);
    expect(types).toEqual(["auth.registered", "auth.login.success"]);
    for (const event of fake.state.audit) {
      expect(event).toMatchObject({ organizationId: session.organization.id, actorId: session.user.id });
    }
    expect(fake.state.audit[1]?.metadata).toMatchObject({ method: "registration", userAgent: "register-test/1.0" });

    const recorded = JSON.stringify(fake.state.audit);
    expect(recorded).not.toContain(PASSWORD);
    expect(recorded).not.toContain(email);
  });

  it("refuses an email address that already has an account, whatever its casing", async () => {
    for (const email of ["existing@firm.test", " EXISTING@firm.test "]) {
      const response = await post("/auth/register", { name: "Duplicate", email, password: PASSWORD });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "conflict", message: "An account with this email address already exists." },
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(fake.state.audit).toEqual([]);
  });

  it.each([
    ["a password under 12 characters", { name: "Kort", email: "short.pw@firm.test", password: "elevenchars" }],
    ["a name of only spaces", { name: "   ", email: "blank.name@firm.test", password: PASSWORD }],
    ["an email without a domain", { name: "Geen Domein", email: "not-an-email", password: PASSWORD }],
    ["a missing name", { email: "no.name@firm.test", password: PASSWORD }],
    ["the password confirmation, which never leaves the browser", { name: "Extra", email: "extra@firm.test", password: PASSWORD, confirmPassword: PASSWORD }],
    ["a password over 256 characters", { name: "Lang", email: "long.pw@firm.test", password: "x".repeat(257) }],
  ])("refuses %s with 400 and creates nothing", async (_label, body) => {
    const usersBefore = fake.state.users.size;
    const response = await post("/auth/register", body);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("bad_request");
    expect(fake.state.users.size).toBe(usersBefore);
  });

  it("refuses a urlencoded form, like sign-in does", async () => {
    const response = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `name=Form&email=form%40firm.test&password=${encodeURIComponent(PASSWORD)}`,
    });

    expect(response.status).toBe(400);
  });

  it("limits attempts per client address, counting failures and successes alike", async () => {
    for (let i = 0; i < REGISTRATION_LIMITS.perClient; i += 1) {
      const response = await post("/auth/register", { name: "Limiet", email: `limit.${i}@firm.test`, password: i % 2 ? PASSWORD : "short" });
      expect([201, 400]).toContain(response.status);
    }

    const blocked = await post("/auth/register", { name: "Limiet", email: "limit.blocked@firm.test", password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("keeps registration and sign-in counters apart", async () => {
    for (let i = 0; i < REGISTRATION_LIMITS.perClient; i += 1) {
      await post("/auth/register", { name: "Limiet", email: "", password: "" });
    }
    expect((await post("/auth/register", { name: "Limiet", email: freshEmail(), password: PASSWORD })).status).toBe(429);

    const login = await post("/auth/login", { email: "existing@firm.test", password: PASSWORD });
    expect(login.status).toBe(200);
  });
});
