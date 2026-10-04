import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Access control, paging and tenant scoping for a client's assessment history,
 * through the real app and without a database. The history is read-only, so
 * what matters here is who may read it, what a page looks like, and what a
 * client of another firm answers. The stored content and the score comparison
 * are covered in readiness-history.db.test.ts.
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
const { resetAssessmentProtection } = await import("../lib/assessment-rate-limit");
const { resetLoginProtection } = await import("../lib/login-rate-limit");

const PASSWORD = "correct horse battery staple";
const ROLES = ["OWNER", "VIEWER"] as const;
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

const HISTORY = "/companies/company_a1/readiness/assessments";

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
  for (const [id, organizationId] of [
    ["company_a1", "org_a"],
    ["company_a2", "org_a"],
    ["company_b1", "org_b"],
  ] as const) {
    fake.state.companies.set(id, {
      id,
      organizationId,
      name: id,
      email: null,
      accountingPackage: null,
      readinessScore: 0,
      peppolStatus: "NOT_REGISTERED",
      lastCheckedAt: null,
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

type Summary = {
  assessmentId: string;
  score: number;
  status: string;
  engineVersion: number;
  completedById: string | null;
  completedByName: string | null;
  riskCount: number;
  previousScore: number | null;
  scoreDelta: number | null;
};
type Page = { items: Summary[]; page: number; pageSize: number; total: number };

/** Records an assessment on client A1 and returns its id. */
async function assess(company = "company_a1", input = answers) {
  const response = await call("POST", `/companies/${company}/readiness/calculate`, { role: "OWNER", body: input });
  expect(response.status).toBe(200);
  return ((await response.json()) as { assessmentId: string }).assessmentId;
}

const page = async (query = "", role: Role = "OWNER") => {
  const response = await call("GET", `${HISTORY}${query}`, { role });
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
};

describe("without a session", () => {
  it.each([
    ["GET", HISTORY],
    ["GET", `${HISTORY}/score_x`],
  ])("%s %s answers 401", async (method, path) => {
    expect((await call(method, path)).status).toBe(401);
  });
});

describe("capability enforcement", () => {
  it("lets a VIEWER read the history and one assessment (clients.view)", async () => {
    const assessmentId = await assess();

    expect((await call("GET", HISTORY, { role: "VIEWER" })).status).toBe(200);
    expect((await call("GET", `${HISTORY}/${assessmentId}`, { role: "VIEWER" })).status).toBe(200);
  });
});

describe("tenant isolation", () => {
  it("answers 404 for a client of another firm", async () => {
    expect((await call("GET", "/companies/company_b1/readiness/assessments", { role: "OWNER" })).status).toBe(404);
    expect((await call("GET", "/companies/company_b1/readiness/assessments/score_x", { role: "OWNER" })).status).toBe(404);
  });

  it("answers 404 for a client that does not exist", async () => {
    expect((await call("GET", "/companies/nope/readiness/assessments", { role: "OWNER" })).status).toBe(404);
  });

  it("answers 404 for an assessment of another client in the same firm", async () => {
    const assessmentId = await assess("company_a1");

    const response = await call("GET", `/companies/company_a2/readiness/assessments/${assessmentId}`, { role: "OWNER" });
    expect(response.status).toBe(404);
  });

  it("answers 404 for an unknown assessment id", async () => {
    await assess();
    expect((await call("GET", `${HISTORY}/score_does_not_exist`, { role: "OWNER" })).status).toBe(404);
  });
});

describe("paging", () => {
  it("is empty, not absent, for a client that was never assessed", async () => {
    expect(await page()).toEqual({ items: [], page: 1, pageSize: 10, total: 0 });
  });

  it("answers newest first", async () => {
    const first = await assess();
    const second = await assess();

    const { items, total } = await page();
    expect(total).toBe(2);
    expect(items.map((item) => item.assessmentId)).toEqual([second, first]);
  });

  it("splits into pages without repeating or skipping a row", async () => {
    const ids = [await assess(), await assess(), await assess()];

    const firstPage = await page("?pageSize=2");
    const secondPage = await page("?pageSize=2&page=2");

    expect(firstPage).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(secondPage).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect([...firstPage.items, ...secondPage.items].map((item) => item.assessmentId)).toEqual(
      [...ids].reverse(),
    );
  });

  it.each([
    ["a page size over 100", "?pageSize=101"],
    ["page 0", "?page=0"],
    ["a fractional page", "?page=1.5"],
    ["a fractional page size", "?pageSize=2.5"],
    ["a page size of zero", "?pageSize=0"],
  ])("refuses %s with 400", async (_label, query) => {
    const response = await call("GET", `${HISTORY}${query}`, { role: "OWNER" });
    expect(response.status).toBe(400);
  });
});

describe("what a row carries", () => {
  it("names the assessor and the rules, and counts the risks", async () => {
    await assess();

    const [row] = (await page()).items;
    expect(row).toMatchObject({
      score: 65,
      status: "CONFIGURING",
      engineVersion: 1,
      completedById: "user_owner",
      completedByName: "OWNER User",
      riskCount: 2,
      previousScore: null,
      scoreDelta: null,
    });
  });

  it("states the change against the previous assessment", async () => {
    await assess("company_a1", answers);
    await assess("company_a1", { ...answers, successfulTestInvoice: true });

    const { items } = await page();
    expect(items[0]).toMatchObject({ score: 80, previousScore: 65, scoreDelta: 15 });
    expect(items[1]).toMatchObject({ score: 65, previousScore: null, scoreDelta: null });
  });

  it("never carries an evidence note", async () => {
    await call("POST", "/companies/company_a1/readiness/calculate", {
      role: "OWNER",
      body: { ...answers, evidence: { participantRegistered: "Seen in the directory" } },
    });

    const body = await page();
    expect(JSON.stringify(body)).not.toContain("Seen in the directory");
    expect(body.items[0]).not.toHaveProperty("checks");
    expect(body.items[0]).not.toHaveProperty("risks");
  });
});

describe("one assessment", () => {
  it("carries the control points with their evidence", async () => {
    const note = "Seen in the access point portal";
    const recorded = await call("POST", "/companies/company_a1/readiness/calculate", {
      role: "OWNER",
      body: { ...answers, evidence: { receivingAddressConfigured: note } },
    });
    const { assessmentId } = (await recorded.json()) as { assessmentId: string };

    const response = await call("GET", `${HISTORY}/${assessmentId}`, { role: "OWNER" });
    expect(response.status).toBe(200);
    const assessment = (await response.json()) as {
      checks: Array<{ key: string; evidence: string | null }>;
      completedByName: string | null;
      risks: unknown[];
    };

    expect(assessment.checks).toHaveLength(5);
    expect(assessment.checks.find((check) => check.key === "receivingAddressConfigured")?.evidence).toBe(note);
    expect(assessment.completedByName).toBe("OWNER User");
    expect(assessment.risks).toHaveLength(2);
  });

  it("answers the same assessment as the latest endpoint, in the same shape", async () => {
    const assessmentId = await assess();

    const viaLatest = await (await call("GET", "/companies/company_a1/readiness/latest", { role: "OWNER" })).json();
    const viaHistory = await (await call("GET", `${HISTORY}/${assessmentId}`, { role: "OWNER" })).json();

    expect(viaHistory).toEqual(viaLatest);
  });
});
