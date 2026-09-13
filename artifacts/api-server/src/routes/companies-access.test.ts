import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Access control and input validation for the client routes, through the real
 * app, without a database. Every refusal here happens before any client data is
 * touched, so these run in every environment. Behaviour against PostgreSQL is
 * covered in companies.db.test.ts.
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

const PASSWORD = "correct horse battery staple";
const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
type Role = (typeof ROLES)[number];

let server: Server;
let base: string;
const cookies = {} as Record<Role, string>;

beforeAll(async () => {
  for (const role of ROLES) {
    await fake.addUser({
      id: `user_${role.toLowerCase()}`,
      name: `${role} User`,
      email: `${role.toLowerCase()}@firm.test`,
      password: PASSWORD,
      memberships: [{ organizationId: "org_a", organizationName: "Firm A", role }],
    });
  }
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  for (const role of ROLES) {
    const response = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${role.toLowerCase()}@firm.test`, password: PASSWORD }),
    });
    expect(response.status).toBe(200);
    cookies[role] = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(method: string, path: string, options: { role?: Role; body?: unknown } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(options.role ? { cookie: cookies[options.role] } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

const validCompany = { name: "Atelier Noma" };
const validContact = { name: "Marie Dubois" };

const WRITE_ROUTES: Array<[string, string, unknown]> = [
  ["POST", "/companies", validCompany],
  ["PATCH", "/companies/company_x", { name: "Nieuw" }],
  ["POST", "/companies/company_x/contacts", validContact],
  ["PATCH", "/companies/company_x/contacts/contact_x", { name: "Nieuw" }],
  ["DELETE", "/companies/company_x/contacts/contact_x", undefined],
];
const ARCHIVE_ROUTES: Array<[string, string]> = [
  ["POST", "/companies/company_x/archive"],
  ["POST", "/companies/company_x/restore"],
];
const READ_ROUTES: Array<[string, string]> = [
  ["GET", "/companies"],
  ["GET", "/companies/company_x"],
  ["GET", "/companies/company_x/contacts"],
];

describe("without a session", () => {
  it.each([...READ_ROUTES, ...ARCHIVE_ROUTES, ...WRITE_ROUTES.map(([method, path]) => [method, path] as [string, string])])(
    "%s %s answers 401",
    async (method, path) => {
      const response = await call(method, path, { body: method === "GET" || method === "DELETE" ? undefined : {} });
      expect(response.status).toBe(401);
    },
  );
});

describe("capability enforcement", () => {
  it.each(WRITE_ROUTES)("a VIEWER is refused %s %s with 403 (clients.write)", async (method, path, body) => {
    const response = await call(method, path, { role: "VIEWER", body });
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("forbidden");
  });

  it.each(ARCHIVE_ROUTES)("a MEMBER is refused %s %s with 403 (clients.archive)", async (method, path) => {
    const response = await call(method, path, { role: "MEMBER" });
    expect(response.status).toBe(403);
  });

  it.each(ARCHIVE_ROUTES)("a VIEWER is refused %s %s with 403 (clients.archive)", async (method, path) => {
    const response = await call(method, path, { role: "VIEWER" });
    expect(response.status).toBe(403);
  });

  it("lets a VIEWER read the dashboard (D6: clients.view)", async () => {
    const response = await call("GET", "/readiness/dashboard", { role: "VIEWER" });
    expect(response.status).toBe(200);
  });

  it("ships the matrix in the session, so the interface can hide what the API refuses", async () => {
    const capabilities = async (role: Role) =>
      ((await (await call("GET", "/auth/session", { role })).json()) as { capabilities: string[] }).capabilities;

    expect(await capabilities("VIEWER")).toEqual(["clients.view", "reports.view"]);
    expect(await capabilities("MEMBER")).toEqual(expect.arrayContaining(["clients.view", "clients.write"]));
    expect(await capabilities("MEMBER")).not.toContain("clients.archive");
    expect(await capabilities("ADMIN")).toEqual(expect.arrayContaining(["clients.view", "clients.write", "clients.archive"]));
  });
});

describe("mass assignment", () => {
  const serverOwned: Array<[string, unknown]> = [
    ["readinessScore", 100],
    ["peppolStatus", "READY"],
    ["lastCheckedAt", "2026-09-01T00:00:00Z"],
    ["organizationId", "org_b"],
    ["archivedAt", null],
    ["id", "company_chosen_by_client"],
    ["createdAt", "2020-01-01T00:00:00Z"],
  ];

  it.each(serverOwned)("refuses %s on create with 400", async (field, value) => {
    const response = await call("POST", "/companies", { role: "OWNER", body: { ...validCompany, [field]: value } });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("bad_request");
  });

  it.each(serverOwned)("refuses %s on update with 400", async (field, value) => {
    const response = await call("PATCH", "/companies/company_x", { role: "OWNER", body: { name: "Nieuw", [field]: value } });
    expect(response.status).toBe(400);
  });

  it.each([["companyId", "company_other"], ["id", "contact_chosen"], ["createdAt", "2020-01-01T00:00:00Z"]])(
    "refuses %s on a contact with 400",
    async (field, value) => {
      const response = await call("POST", "/companies/company_x/contacts", { role: "OWNER", body: { ...validContact, [field]: value } });
      expect(response.status).toBe(400);
    },
  );
});

describe("input validation", () => {
  it.each([
    ["a missing name", {}],
    ["a name of only spaces", { name: "   " }],
    ["a name over 200 characters", { name: "x".repeat(201) }],
    ["a country that is not two letters", { name: "Atelier", country: "BEL" }],
    ["an invalid email", { name: "Atelier", email: "not-an-email" }],
    ["a VAT number over 32 characters", { name: "Atelier", vatNumber: "B".repeat(33) }],
  ])("refuses %s on create with 400", async (_label, body) => {
    const response = await call("POST", "/companies", { role: "MEMBER", body });
    expect(response.status).toBe(400);
  });

  it("refuses an update that changes nothing", async () => {
    const response = await call("PATCH", "/companies/company_x", { role: "MEMBER", body: {} });
    expect(response.status).toBe(400);
  });

  it.each([
    ["pageSize over 100", "?pageSize=101"],
    ["page 0", "?page=0"],
    ["a fractional page", "?page=1.5"],
    ["an unknown sort key", "?sort=passwordHash"],
    ["an unknown status", "?status=deleted"],
    ["an unknown Peppol status", "?peppolStatus=EVERYTHING"],
    ["a search over 100 characters", `?search=${"x".repeat(101)}`],
  ])("refuses a list query with %s", async (_label, query) => {
    const response = await call("GET", `/companies${query}`, { role: "VIEWER" });
    expect(response.status).toBe(400);
  });
});
