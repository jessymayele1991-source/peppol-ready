import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@workspace/password";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Client management through the real app and a real PostgreSQL database: two
 * firms, every role, sessions in the database. Requires a migrated database:
 *
 *   TEST_DATABASE_URL=postgresql://… pnpm --filter @workspace/api-server run test
 *
 * Skipped when TEST_DATABASE_URL is unset. Everything hangs off two
 * organizations with a unique suffix and is removed by cascade afterwards.
 */
const url = process.env["TEST_DATABASE_URL"];

vi.mock("./logger", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
});

describe.skipIf(!url)("client management against PostgreSQL", async () => {
  process.env["DATABASE_URL"] = url;
  const { default: app } = await import("../app");
  const { resetLoginProtection } = await import("./login-rate-limit");

  const db = new PrismaClient({ datasourceUrl: url });
  const run = randomUUID().slice(0, 8);
  const id = (name: string) => `${name}_${run}`;
  const orgA = id("org_a");
  const orgB = id("org_b");
  const PASSWORD = "correct horse battery staple";

  type Who = "ownerA" | "adminA" | "memberA" | "viewerA" | "ownerB";
  const people: Record<Who, { org: string; role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" }> = {
    ownerA: { org: orgA, role: "OWNER" },
    adminA: { org: orgA, role: "ADMIN" },
    memberA: { org: orgA, role: "MEMBER" },
    viewerA: { org: orgA, role: "VIEWER" },
    ownerB: { org: orgB, role: "OWNER" },
  };
  const cookies = {} as Record<Who, string>;

  let server: Server;
  let base: string;

  function call(who: Who | null, method: string, path: string, body?: unknown) {
    return fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(who ? { cookie: cookies[who] } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
    return (await response.json()) as T;
  }

  type CompanyBody = {
    id: string;
    name: string;
    email: string | null;
    vatNumber: string | null;
    registrationNumber: string | null;
    country: string | null;
    archivedAt: string | null;
    readinessScore: number;
    contacts: Array<{ id: string; name: string; isPrimary: boolean }>;
  };
  type Page = { items: CompanyBody[]; page: number; pageSize: number; total: number };

  async function create(who: Who, body: Record<string, unknown>) {
    const response = await call(who, "POST", "/companies", body);
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    return json<CompanyBody>(response);
  }

  const auditFor = (entityId: string) =>
    db.auditEvent.findMany({ where: { entityId }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    await db.organization.createMany({
      data: [
        { id: orgA, name: "Firm A", slug: id("firm-a") },
        { id: orgB, name: "Firm B", slug: id("firm-b") },
      ],
    });
    const passwordHash = await hashPassword(PASSWORD);
    for (const [who, { org, role }] of Object.entries(people)) {
      await db.user.create({
        data: {
          id: id(who),
          name: `${who} person`,
          email: `${who.toLowerCase()}.${run}@clients.test`,
          passwordHash,
          memberships: { create: { organizationId: org, role } },
        },
      });
    }

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

    for (const who of Object.keys(people) as Who[]) {
      const response = await call(null, "POST", "/auth/login", { email: `${who.toLowerCase()}.${run}@clients.test`, password: PASSWORD });
      expect(response.status).toBe(200);
      cookies[who] = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    }
  });

  beforeEach(() => {
    resetLoginProtection();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await db.userSession.deleteMany({ where: { data: { path: ["userId"], string_contains: run } } });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { email: { endsWith: `.${run}@clients.test` } } });
    await db.$disconnect();
  });

  describe("create, read, update", () => {
    it("creates a client with normalized identifiers and records only field names", async () => {
      const company = await create("memberA", {
        name: "  Atelier   Noma ",
        email: " Finance@AtelierNoma.BE ",
        vatNumber: "be 0123.456.789",
        registrationNumber: "0123.456.789",
        country: "be",
        city: "Gent",
      });

      expect(company).toMatchObject({
        name: "Atelier Noma",
        email: "finance@ateliernoma.be",
        vatNumber: "BE0123456789",
        registrationNumber: "0123456789",
        country: "BE",
        archivedAt: null,
        readinessScore: 0,
        contacts: [],
      });

      const [event, ...rest] = await auditFor(company.id);
      expect(rest).toEqual([]);
      expect(event).toMatchObject({
        organizationId: orgA,
        actorId: id("memberA"),
        eventType: "company.created",
        entityType: "company",
      });
      expect((event?.metadata as { fields: string[] }).fields.sort()).toEqual(
        ["city", "country", "email", "name", "registrationNumber", "vatNumber"].sort(),
      );
      expect(JSON.stringify(event?.metadata)).not.toMatch(/Noma|ateliernoma|BE0123456789|Gent/i);
    });

    it("updates only what changed, records only those field names, and records nothing for a no-op", async () => {
      const company = await create("ownerA", { name: "Update Test", city: "Brugge" });

      const updated = await call("memberA", "PATCH", `/companies/${company.id}`, { city: "Antwerpen", name: "Update Test" });
      expect(updated.status).toBe(200);
      expect(await json<CompanyBody>(updated)).toMatchObject({ name: "Update Test" });

      const noop = await call("memberA", "PATCH", `/companies/${company.id}`, { city: "Antwerpen" });
      expect(noop.status).toBe(200);

      const cleared = await call("memberA", "PATCH", `/companies/${company.id}`, { city: null });
      expect((await json<Record<string, unknown>>(cleared))["city"]).toBeNull();

      const events = await auditFor(company.id);
      expect(events.map((event) => [event.eventType, (event.metadata as { fields?: string[] }).fields?.sort()])).toEqual([
        ["company.created", ["city", "name"]],
        ["company.updated", ["city"]],
        ["company.updated", ["city"]],
      ]);
      expect(JSON.stringify(events.map((event) => event.metadata))).not.toMatch(/Antwerpen|Brugge/);
    });

    it("refuses a duplicate VAT or registration number within one firm, however it is formatted", async () => {
      await create("ownerA", { name: "Origineel", vatNumber: "BE0999.888.777", registrationNumber: "0999888777" });

      const vat = await call("memberA", "POST", "/companies", { name: "Kopie", vatNumber: "be 0999 888 777" });
      expect(vat.status).toBe(409);
      expect((await json<{ error: { message: string } }>(vat)).error.message).toMatch(/VAT number/);

      const registration = await call("memberA", "POST", "/companies", { name: "Kopie", registrationNumber: "0999.888.777" });
      expect(registration.status).toBe(409);

      const other = await create("memberA", { name: "Ander", vatNumber: "BE0999888770" });
      const onUpdate = await call("memberA", "PATCH", `/companies/${other.id}`, { vatNumber: "BE0999888777" });
      expect(onUpdate.status).toBe(409);
    });

    it("allows the same VAT number in another firm", async () => {
      await create("ownerA", { name: "Gedeeld A", vatNumber: "BE0555444333" });
      await create("ownerB", { name: "Gedeeld B", vatNumber: "BE0555444333" });
    });

    it("lets a VIEWER read but not write", async () => {
      const company = await create("ownerA", { name: "Alleen Lezen" });
      expect((await call("viewerA", "GET", `/companies/${company.id}`)).status).toBe(200);
      expect((await call("viewerA", "GET", "/companies")).status).toBe(200);
      expect((await call("viewerA", "PATCH", `/companies/${company.id}`, { name: "x" })).status).toBe(403);
    });
  });

  describe("listing", () => {
    const prefix = `Lijst ${run}`;
    let ids: Record<string, string>;

    beforeAll(async () => {
      const make = (name: string, extra: Record<string, unknown>) => create("ownerA", { name: `${prefix} ${name}`, ...extra });
      const alpha = await make("Alpha", { industry: "Bouw", email: "alpha@lijst.test", vatNumber: `BE01${run.replace(/\D/g, "1").slice(0, 4)}01` });
      const bravo = await make("Bravo", { industry: "bouw" });
      const charlie = await make("Charlie", { industry: "Horeca" });
      const delta = await make("Delta", { industry: "Horeca" });
      await db.company.update({ where: { id: bravo.id }, data: { readinessScore: 90, peppolStatus: "READY", lastCheckedAt: new Date(Date.now() - 1000) } });
      await db.company.update({ where: { id: charlie.id }, data: { readinessScore: 40, peppolStatus: "AT_RISK", lastCheckedAt: new Date(Date.now() - 5000) } });
      ids = { alpha: alpha.id, bravo: bravo.id, charlie: charlie.id, delta: delta.id };
      await call("ownerA", "POST", `/companies/${delta.id}/archive`);
    });

    const list = async (query: string) => {
      const response = await call("viewerA", "GET", `/companies?search=${encodeURIComponent(prefix)}&${query}`);
      expect(response.status).toBe(200);
      return json<Page>(response);
    };
    const names = (page: Page) => page.items.map((item) => item.name.replace(`${prefix} `, ""));

    it("excludes archived clients by default and can show them", async () => {
      expect(names(await list(""))).toEqual(["Alpha", "Bravo", "Charlie"]);
      expect(names(await list("status=archived"))).toEqual(["Delta"]);
      expect(names(await list("status=all"))).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    });

    it("filters on Peppol status and on industry regardless of case", async () => {
      expect(names(await list("peppolStatus=READY"))).toEqual(["Bravo"]);
      expect(names(await list("industry=BOUW"))).toEqual(["Alpha", "Bravo"]);
    });

    it("sorts on every allowed key", async () => {
      expect(names(await list("sort=-name"))).toEqual(["Charlie", "Bravo", "Alpha"]);
      expect(names(await list("sort=-readinessScore"))).toEqual(["Bravo", "Charlie", "Alpha"]);
      // Never-checked clients sort last in both directions.
      expect(names(await list("sort=-lastCheckedAt"))).toEqual(["Bravo", "Charlie", "Alpha"]);
      expect(names(await list("sort=lastCheckedAt"))).toEqual(["Charlie", "Bravo", "Alpha"]);
    });

    it("paginates with a stable total and no overlap", async () => {
      const first = await list("pageSize=2&page=1");
      const second = await list("pageSize=2&page=2");
      const beyond = await list("pageSize=2&page=9");

      expect([first.total, second.total]).toEqual([3, 3]);
      expect(names(first)).toEqual(["Alpha", "Bravo"]);
      expect(names(second)).toEqual(["Charlie"]);
      expect(beyond.items).toEqual([]);
    });

    it("searches name, email and identifiers, the latter regardless of formatting", async () => {
      const byEmail = await call("viewerA", "GET", `/companies?search=${encodeURIComponent("alpha@lijst")}`);
      expect(names(await json<Page>(byEmail))).toContain("Alpha");

      const alpha = await db.company.findUniqueOrThrow({ where: { id: ids["alpha"] as string } });
      const formatted = `${alpha.vatNumber?.slice(0, 2).toLowerCase()} ${alpha.vatNumber?.slice(2, 6)}.${alpha.vatNumber?.slice(6)}`;
      const byVat = await call("viewerA", "GET", `/companies?search=${encodeURIComponent(formatted)}`);
      expect((await json<Page>(byVat)).items.map((item) => item.id)).toEqual([ids["alpha"]]);
    });

    it("treats LIKE wildcards in a search as literal characters", async () => {
      for (const wildcard of ["%", "_", "\\"]) {
        const response = await call("viewerA", "GET", `/companies?search=${encodeURIComponent(wildcard)}`);
        expect((await json<Page>(response)).items, `search ${wildcard}`).toEqual([]);
      }
    });
  });

  describe("archive and restore", () => {
    it("archives and restores idempotently, recording each real change once", async () => {
      const company = await create("ownerA", { name: "Archief" });

      const archived = await call("adminA", "POST", `/companies/${company.id}/archive`);
      expect(archived.status).toBe(200);
      expect((await json<CompanyBody>(archived)).archivedAt).not.toBeNull();
      expect((await call("adminA", "POST", `/companies/${company.id}/archive`)).status).toBe(200);

      const restored = await call("ownerA", "POST", `/companies/${company.id}/restore`);
      expect((await json<CompanyBody>(restored)).archivedAt).toBeNull();
      expect((await call("ownerA", "POST", `/companies/${company.id}/restore`)).status).toBe(200);

      expect((await auditFor(company.id)).map((event) => event.eventType)).toEqual([
        "company.created",
        "company.archived",
        "company.restored",
      ]);
    });

    it("refuses a MEMBER, and keeps an archived client read-only until restored", async () => {
      const company = await create("memberA", { name: "Alleen Beheer" });
      expect((await call("memberA", "POST", `/companies/${company.id}/archive`)).status).toBe(403);

      await call("ownerA", "POST", `/companies/${company.id}/archive`);
      expect((await call("memberA", "GET", `/companies/${company.id}`)).status).toBe(200);
      expect((await call("memberA", "PATCH", `/companies/${company.id}`, { name: "x" })).status).toBe(409);
      expect((await call("memberA", "POST", `/companies/${company.id}/contacts`, { name: "x" })).status).toBe(409);
    });

    it("reserves an archived client's numbers: create conflicts, restore works", async () => {
      const company = await create("ownerA", { name: "Gereserveerd", vatNumber: "BE0777666555" });
      await call("ownerA", "POST", `/companies/${company.id}/archive`);

      const duplicate = await call("ownerA", "POST", "/companies", { name: "Nieuw", vatNumber: "BE0777666555" });
      expect(duplicate.status).toBe(409);
      expect((await json<{ error: { message: string } }>(duplicate)).error.message).toMatch(/restore/);
      expect((await call("ownerA", "POST", `/companies/${company.id}/restore`)).status).toBe(200);
    });

    it("drops archived clients from the dashboard and refuses to assess them", async () => {
      const company = await create("ownerA", { name: `Dashboard ${run}` });
      const inDashboard = async () => {
        const dashboard = await json<{ companies: Array<{ id: string }> }>(await call("viewerA", "GET", "/readiness/dashboard"));
        return dashboard.companies.some((entry) => entry.id === company.id);
      };
      expect(await inDashboard()).toBe(true);

      await call("ownerA", "POST", `/companies/${company.id}/archive`);
      expect(await inDashboard()).toBe(false);

      const answers = { participantRegistered: true, receivingAddressConfigured: true, peppolCapableSoftware: true, certificateValid: true, successfulTestInvoice: true };
      const assessed = await call("memberA", "POST", `/companies/${company.id}/readiness/calculate`, answers);
      expect(assessed.status).toBe(409);
      expect(await db.readinessScore.count({ where: { companyId: company.id } })).toBe(0);
    });
  });

  describe("contacts", () => {
    it("adds, updates and deletes contacts, keeping exactly one primary", async () => {
      const company = await create("ownerA", { name: "Contacten" });
      const add = async (body: Record<string, unknown>) => {
        const response = await call("memberA", "POST", `/companies/${company.id}/contacts`, body);
        expect(response.status).toBe(201);
        return json<{ id: string; isPrimary: boolean; email: string | null }>(response);
      };

      const marie = await add({ name: "Marie Dubois", email: "Marie@Klant.BE", isPrimary: true });
      const jan = await add({ name: "Jan Peeters", phone: "+32 470 00 00 00", isPrimary: true });
      expect(marie.email).toBe("marie@klant.be");

      let contacts = await json<Array<{ id: string; isPrimary: boolean }>>(await call("viewerA", "GET", `/companies/${company.id}/contacts`));
      expect(contacts.filter((contact) => contact.isPrimary).map((contact) => contact.id)).toEqual([jan.id]);

      const promoted = await call("memberA", "PATCH", `/companies/${company.id}/contacts/${marie.id}`, { isPrimary: true, role: "CFO" });
      expect(promoted.status).toBe(200);
      contacts = await json(await call("viewerA", "GET", `/companies/${company.id}/contacts`));
      expect(contacts.filter((contact) => contact.isPrimary).map((contact) => contact.id)).toEqual([marie.id]);

      expect((await call("memberA", "DELETE", `/companies/${company.id}/contacts/${jan.id}`)).status).toBe(204);
      expect((await call("memberA", "DELETE", `/companies/${company.id}/contacts/${jan.id}`)).status).toBe(404);

      const events = await db.auditEvent.findMany({
        where: { organizationId: orgA, entityType: "client_contact", entityId: { in: [marie.id, jan.id] } },
        orderBy: { createdAt: "asc" },
      });
      expect(events.map((event) => event.eventType)).toEqual(["contact.created", "contact.created", "contact.updated", "contact.deleted"]);
      for (const event of events) {
        expect((event.metadata as { companyId: string }).companyId).toBe(company.id);
      }
      expect(JSON.stringify(events.map((event) => event.metadata))).not.toMatch(/Marie|Dubois|Jan|Peeters|klant\.be|\+32|CFO/i);
    });
  });

  describe("tenant isolation", () => {
    it("gives another firm nothing: every read and write answers 404 and changes nothing", async () => {
      const company = await create("ownerA", { name: `Geheim ${run}`, vatNumber: "BE0333222111" });
      const contact = await json<{ id: string }>(
        await call("ownerA", "POST", `/companies/${company.id}/contacts`, { name: "Geheim Contact" }),
      );
      const before = await db.company.findUniqueOrThrow({ where: { id: company.id } });
      const auditBefore = await db.auditEvent.count({ where: { organizationId: orgA } });

      const attempts: Array<[string, string, unknown?]> = [
        ["GET", `/companies/${company.id}`],
        ["PATCH", `/companies/${company.id}`, { name: "Overgenomen" }],
        ["POST", `/companies/${company.id}/archive`],
        ["POST", `/companies/${company.id}/restore`],
        ["GET", `/companies/${company.id}/contacts`],
        ["POST", `/companies/${company.id}/contacts`, { name: "Indringer" }],
        ["PATCH", `/companies/${company.id}/contacts/${contact.id}`, { name: "Indringer" }],
        ["DELETE", `/companies/${company.id}/contacts/${contact.id}`],
      ];
      for (const [method, path, body] of attempts) {
        const response = await call("ownerB", method, path, body);
        expect(response.status, `${method} ${path}`).toBe(404);
      }

      // A contact of firm A addressed through a client of firm B.
      const own = await create("ownerB", { name: "Eigen B" });
      expect((await call("ownerB", "PATCH", `/companies/${own.id}/contacts/${contact.id}`, { name: "x" })).status).toBe(404);
      expect((await call("ownerB", "DELETE", `/companies/${own.id}/contacts/${contact.id}`)).status).toBe(404);

      const search = await json<Page>(await call("ownerB", "GET", `/companies?search=${encodeURIComponent(`Geheim ${run}`)}&status=all`));
      expect(search.items).toEqual([]);
      const vat = await json<Page>(await call("ownerB", "GET", "/companies?search=BE0333222111&status=all"));
      expect(vat.items.map((item) => item.id)).not.toContain(company.id);

      expect(await db.company.findUniqueOrThrow({ where: { id: company.id } })).toEqual(before);
      expect(await db.clientContact.findUniqueOrThrow({ where: { id: contact.id } })).toMatchObject({ name: "Geheim Contact" });
      expect(await db.auditEvent.count({ where: { organizationId: orgA } })).toBe(auditBefore);
    });

    it("never lists another firm's clients", async () => {
      await create("ownerB", { name: `Alleen B ${run}` });
      const page = await json<Page>(await call("ownerA", "GET", `/companies?search=${encodeURIComponent(`Alleen B ${run}`)}&status=all`));
      expect(page.total).toBe(0);
    });
  });

  describe("concurrency", () => {
    it("lets exactly one of two simultaneous creates with the same VAT number succeed", async () => {
      const responses = await Promise.all(
        ["Race Een", "Race Twee"].map((name) => call("ownerA", "POST", "/companies", { name, vatNumber: "BE0111222333" })),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(await db.company.count({ where: { organizationId: orgA, vatNumber: "BE0111222333" } })).toBe(1);
    });

    it("keeps one primary contact when two contacts are promoted at the same time", async () => {
      const company = await create("ownerA", { name: "Gelijktijdig" });
      const created = await Promise.all(
        ["Een", "Twee", "Drie"].map(async (name) =>
          json<{ id: string }>(await call("ownerA", "POST", `/companies/${company.id}/contacts`, { name })),
        ),
      );
      await Promise.all(
        created.map((contact) => call("ownerA", "PATCH", `/companies/${company.id}/contacts/${contact.id}`, { isPrimary: true })),
      );
      expect(await db.clientContact.count({ where: { companyId: company.id, isPrimary: true } })).toBe(1);
    });

    it("never records an edit to a client that an archive beat to the lock", async () => {
      const company = await create("ownerA", { name: "Wedloop" });
      const [archive, edit] = await Promise.all([
        call("ownerA", "POST", `/companies/${company.id}/archive`),
        call("memberA", "PATCH", `/companies/${company.id}`, { city: "Leuven" }),
      ]);
      expect(archive.status).toBe(200);

      const stored = await db.company.findUniqueOrThrow({ where: { id: company.id } });
      const updates = (await auditFor(company.id)).filter((event) => event.eventType === "company.updated");
      if (edit.status === 200) {
        expect(stored.city).toBe("Leuven");
        expect(updates).toHaveLength(1);
      } else {
        expect(edit.status).toBe(409);
        expect(stored.city).toBeNull();
        expect(updates).toHaveLength(0);
      }
      expect(stored.archivedAt).not.toBeNull();
    });
  });
});
