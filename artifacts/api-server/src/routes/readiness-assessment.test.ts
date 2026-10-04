import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Access control, input validation and rate limiting for recording and reading
 * a readiness assessment, through the real app and without a database. Every
 * refusal here happens before any client data is touched. What actually gets
 * stored is covered in readiness-assessment.db.test.ts.
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
const { ASSESSMENT_LIMITS, resetAssessmentProtection } = await import("../lib/assessment-rate-limit");
const { resetLoginProtection } = await import("../lib/login-rate-limit");

const PASSWORD = "correct horse battery staple";
const ROLES = ["OWNER", "MEMBER", "VIEWER"] as const;
type Role = (typeof ROLES)[number];

const answers = {
  participantRegistered: true,
  receivingAddressConfigured: true,
  peppolCapableSoftware: false,
  certificateValid: true,
  successfulTestInvoice: false,
};

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
  fake.state.companies.set("company_a1", {
    id: "company_a1",
    organizationId: "org_a",
    name: "Atelier Noma",
    email: null,
    accountingPackage: null,
    readinessScore: 0,
    peppolStatus: "NOT_REGISTERED",
    lastCheckedAt: null,
  });
  // A client of another firm: reachable by id, never by this session.
  fake.state.companies.set("company_b1", {
    id: "company_b1",
    organizationId: "org_b",
    name: "Ander kantoor",
    email: null,
    accountingPackage: null,
    readinessScore: 0,
    peppolStatus: "NOT_REGISTERED",
    lastCheckedAt: null,
  });

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

beforeEach(() => {
  resetLoginProtection();
  resetAssessmentProtection();
  fake.state.readinessScores.length = 0;
  fake.state.readinessChecks.length = 0;
  fake.state.audit.length = 0;
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

const CALCULATE = "/companies/company_a1/readiness/calculate";
const LATEST = "/companies/company_a1/readiness/latest";

describe("without a session", () => {
  it.each([
    ["POST", CALCULATE],
    ["GET", LATEST],
  ])("%s %s answers 401", async (method, path) => {
    const response = await call(method, path, { body: method === "POST" ? answers : undefined });
    expect(response.status).toBe(401);
  });
});

describe("capability enforcement", () => {
  it("refuses a VIEWER recording an assessment (scans.write)", async () => {
    const response = await call("POST", CALCULATE, { role: "VIEWER", body: answers });

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("forbidden");
    expect(fake.state.readinessScores).toEqual([]);
    expect(fake.state.readinessChecks).toEqual([]);
  });

  it("lets a VIEWER read the assessment (clients.view)", async () => {
    const response = await call("GET", LATEST, { role: "VIEWER" });
    expect(response.status).toBe(204);
  });

  it("lets a MEMBER record one", async () => {
    const response = await call("POST", CALCULATE, { role: "MEMBER", body: answers });
    expect(response.status).toBe(200);
  });
});

describe("tenant isolation", () => {
  it.each([
    ["POST", "/companies/company_b1/readiness/calculate"],
    ["GET", "/companies/company_b1/readiness/latest"],
    ["POST", "/companies/does_not_exist/readiness/calculate"],
    ["GET", "/companies/does_not_exist/readiness/latest"],
  ])("answers 404 for %s %s", async (method, path) => {
    const response = await call(method, path, { role: "OWNER", body: method === "POST" ? answers : undefined });

    expect(response.status).toBe(404);
    expect(fake.state.readinessScores).toEqual([]);
    expect(fake.state.audit).toEqual([]);
  });
});

describe("evidence validation", () => {
  it("accepts answers without evidence", async () => {
    const response = await call("POST", CALCULATE, { role: "OWNER", body: answers });
    expect(response.status).toBe(200);
  });

  it("accepts a note per question", async () => {
    const response = await call("POST", CALCULATE, {
      role: "OWNER",
      body: { ...answers, evidence: { participantRegistered: "Peppol directory, 4 October" } },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { checks: Array<{ key: string; evidence: string | null }> };
    expect(body.checks.find((check) => check.key === "participantRegistered")?.evidence).toBe(
      "Peppol directory, 4 October",
    );
  });

  it.each([
    ["a note over 500 characters", { evidence: { participantRegistered: "x".repeat(501) } }],
    ["an undeclared question key", { evidence: { smuggledQuestion: "x" } }],
    ["evidence as null", { evidence: null }],
    ["evidence as a string", { evidence: "a single note" }],
    ["a note that is not a string", { evidence: { participantRegistered: 42 } }],
  ])("refuses %s with 400 and records nothing", async (_label, extra) => {
    const response = await call("POST", CALCULATE, { role: "OWNER", body: { ...answers, ...extra } });

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("bad_request");
    expect(fake.state.readinessScores).toEqual([]);
    expect(fake.state.readinessChecks).toEqual([]);
  });

  it("accepts a note of exactly 500 characters", async () => {
    const response = await call("POST", CALCULATE, {
      role: "OWNER",
      body: { ...answers, evidence: { certificateValid: "y".repeat(500) } },
    });
    expect(response.status).toBe(200);
  });
});

describe("server-owned fields", () => {
  it.each([
    ["completedById", { completedById: "user_viewer" }],
    ["assessmentId", { assessmentId: "score_chosen_by_client" }],
    ["engineVersion", { engineVersion: 99 }],
    ["checks", { checks: [{ key: "participantRegistered", passed: true, evidence: null }] }],
    ["score", { score: 100 }],
    ["checkedAt", { checkedAt: new Date().toISOString() }],
    ["source", { source: "peppol_directory_sync" }],
  ])("refuses %s in the body with 400", async (_label, extra) => {
    const response = await call("POST", CALCULATE, { role: "OWNER", body: { ...answers, ...extra } });

    expect(response.status).toBe(400);
    expect(fake.state.readinessScores).toEqual([]);
  });

  it("records the acting user, not a user from the body", async () => {
    const response = await call("POST", CALCULATE, { role: "MEMBER", body: answers });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { completedById: string }).completedById).toBe("user_member");
    expect(fake.state.readinessScores[0]?.["completedById"]).toBe("user_member");
  });
});

describe("audit trail", () => {
  it("records identifiers and the outcome, never the evidence", async () => {
    const note = "Checked in the access point portal";
    const response = await call("POST", CALCULATE, {
      role: "OWNER",
      body: { ...answers, evidence: { receivingAddressConfigured: note } },
    });
    const body = (await response.json()) as { assessmentId: string; engineVersion: number; score: number };

    expect(fake.state.audit).toHaveLength(1);
    expect(fake.state.audit[0]).toMatchObject({
      eventType: "readiness.calculated",
      actorId: "user_owner",
      entityType: "company",
      entityId: "company_a1",
    });
    expect(fake.state.audit[0]?.metadata).toMatchObject({
      assessmentId: body.assessmentId,
      engineVersion: body.engineVersion,
      score: body.score,
      status: "CONFIGURING",
    });
    expect(JSON.stringify(fake.state.audit)).not.toContain(note);
  });
});

describe("rate limiting", () => {
  it("stops one client from being assessed endlessly, with a retry hint", async () => {
    for (let i = 0; i < ASSESSMENT_LIMITS.perCompany; i += 1) {
      const response = await call("POST", CALCULATE, { role: "OWNER", body: answers });
      expect(response.status).toBe(200);
    }

    const blocked = await call("POST", CALCULATE, { role: "OWNER", body: answers });

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(fake.state.readinessScores).toHaveLength(ASSESSMENT_LIMITS.perCompany);
  });

  it("keeps reading unlimited while recording is blocked", async () => {
    for (let i = 0; i < ASSESSMENT_LIMITS.perCompany + 1; i += 1) {
      await call("POST", CALCULATE, { role: "OWNER", body: answers });
    }

    const read = await call("GET", LATEST, { role: "OWNER" });
    expect(read.status).toBe(200);
  });
});

describe("reading the latest assessment", () => {
  it("answers 204 for a client that was never assessed", async () => {
    const response = await call("GET", LATEST, { role: "OWNER" });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("returns the assessment that was just recorded, in the same shape", async () => {
    const recorded = (await (await call("POST", CALCULATE, { role: "OWNER", body: answers })).json()) as Record<string, unknown>;

    const response = await call("GET", LATEST, { role: "OWNER" });
    expect(response.status).toBe(200);
    const read = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(read).sort()).toEqual(Object.keys(recorded).sort());
    expect(read["assessmentId"]).toBe(recorded["assessmentId"]);
    expect(read["score"]).toBe(recorded["score"]);
    expect(read["status"]).toBe(recorded["status"]);
  });
});
