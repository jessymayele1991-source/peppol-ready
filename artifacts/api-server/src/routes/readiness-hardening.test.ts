import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { CalculateCompanyReadinessBody } from "@workspace/api-zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
const { calculateAndPersistCompanyReadiness } = await import("../lib/readiness-service");
const { resetLoginProtection } = await import("../lib/login-rate-limit");

const answers = {
  participantRegistered: true,
  receivingAddressConfigured: true,
  peppolCapableSoftware: true,
  certificateValid: true,
  successfulTestInvoice: false,
};

let server: Server;
let base: string;
let cookie: string;

beforeAll(async () => {
  await fake.addUser({
    id: "user_nora",
    name: "Nora Peeters",
    email: "nora@firm.test",
    password: "correct horse battery staple",
    memberships: [{ organizationId: "org_a", organizationName: "Firm A", role: "MEMBER" }],
  });
  fake.state.companies.set("company_a1", {
    id: "company_a1",
    organizationId: "org_a",
    name: "Atelier Noma",
    email: null,
    accountingPackage: null,
    readinessScore: 0,
    lastCheckedAt: null,
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  fake.reset();
  resetLoginProtection();
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nora@firm.test", password: "correct horse battery staple" }),
  });
  cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  fake.state.audit.length = 0;
});

function calculate(body: unknown) {
  return fetch(`${base}/companies/company_a1/readiness/calculate`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("contract", () => {
  it("accepts assessment answers alone", () => {
    expect(CalculateCompanyReadinessBody.safeParse(answers).success).toBe(true);
  });

  it.each([
    ["a future checkedAt", { checkedAt: "2099-01-01T00:00:00Z" }],
    ["a past checkedAt", { checkedAt: "1970-01-01T00:00:00Z" }],
    ["a current checkedAt", { checkedAt: new Date().toISOString() }],
    ["a source", { source: "peppol_directory_sync" }],
    ["any undeclared field", { score: 100 }],
  ])("rejects a body carrying %s", (_label, extra) => {
    expect(CalculateCompanyReadinessBody.safeParse({ ...answers, ...extra }).success).toBe(false);
  });
});

describe("calculateAndPersistCompanyReadiness", () => {
  it("stamps the assessment with the server's clock and source", async () => {
    const before = Date.now();
    await calculateAndPersistCompanyReadiness("company_a1", answers, { userId: "user_nora", organizationId: "org_a" });
    const after = Date.now();

    const [score] = fake.state.readinessScores;
    const checkedAt = (score?.["checkedAt"] as Date).getTime();
    expect(checkedAt).toBeGreaterThanOrEqual(before);
    expect(checkedAt).toBeLessThanOrEqual(after);
    expect(score?.["source"]).toBe("manual_assessment");
  });

  it("ignores timestamps and sources smuggled in past the type system", async () => {
    const smuggled = { ...answers, checkedAt: new Date("2099-01-01T00:00:00Z"), source: "peppol_directory_sync" };
    await calculateAndPersistCompanyReadiness("company_a1", smuggled, { userId: "user_nora", organizationId: "org_a" });

    const [score] = fake.state.readinessScores;
    expect((score?.["checkedAt"] as Date).getFullYear()).not.toBe(2099);
    expect(score?.["source"]).toBe("manual_assessment");
    expect(fake.state.companies.get("company_a1")?.["lastCheckedAt"]).toEqual(score?.["checkedAt"]);
  });
});

describe("POST /companies/:companyId/readiness/calculate", () => {
  it("rejects a request that still sends checkedAt, and records nothing", async () => {
    const response = await calculate({ ...answers, checkedAt: "2099-01-01T00:00:00Z" });

    expect(response.status).toBe(400);
    expect(fake.state.readinessScores).toEqual([]);
    expect(fake.state.audit).toEqual([]);
  });

  it("rejects a request that still sends source, and records nothing", async () => {
    const response = await calculate({ ...answers, source: "peppol_directory_sync" });

    expect(response.status).toBe(400);
    expect(fake.state.readinessScores).toEqual([]);
  });

  it("records a clean request with server-owned time and source, in the audit trail too", async () => {
    const before = Date.now();
    const response = await calculate(answers);
    const after = Date.now();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { calculatedAt: string; score: number };
    expect(body.score).toBe(85);
    expect(new Date(body.calculatedAt).getTime()).toBeGreaterThanOrEqual(before - 1);
    expect(new Date(body.calculatedAt).getTime()).toBeLessThanOrEqual(after);

    expect(fake.state.audit).toEqual([
      expect.objectContaining({
        eventType: "readiness.calculated",
        actorId: "user_nora",
        metadata: expect.objectContaining({ source: "manual_assessment", checkedAt: body.calculatedAt }),
      }),
    ]);
  });

  it("keeps the dashboard working", async () => {
    await calculate(answers);

    const response = await fetch(`${base}/readiness/dashboard`, { headers: { cookie } });

    expect(response.status).toBe(200);
    const dashboard = (await response.json()) as { companies: Array<{ id: string }> };
    expect(dashboard.companies.map((company) => company.id)).toEqual(["company_a1"]);
  });
});
