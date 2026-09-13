import { Prisma } from "@prisma/client";
import type {
  ClientContactInput,
  ClientContactUpdateInput,
  CompanyInput,
  CompanyListStatus,
  CompanySort,
  CompanyUpdateInput,
  PeppolStatus,
} from "@workspace/api-zod";
import { auditEvent } from "./audit-event";
import { isPlausibleEmail, normalizeEmail, normalizeName } from "./auth-service";
import { prisma } from "./prisma";

/**
 * Client management for one organization at a time.
 *
 * Tenant boundary: every read filters on the caller's organizationId, and every
 * write runs in a transaction that first locks the client row with
 * `SELECT … FOR UPDATE WHERE id AND organizationId`. Writes then go through
 * updateMany/deleteMany scoped to the same organization and check the row
 * count, so no statement ever touches a row by id alone. The lock also
 * serializes archiving against edits and keeps "one primary contact" true under
 * concurrent requests.
 *
 * Server-owned fields — readinessScore, peppolStatus, lastCheckedAt, archivedAt
 * and organizationId — are not part of any input type and are never written
 * here from caller data.
 */

export type Actor = { userId: string; organizationId: string };

export class CompanyNotFoundError extends Error {
  constructor() {
    super("Client not found.");
    this.name = "CompanyNotFoundError";
  }
}

export class CompanyArchivedError extends Error {
  constructor() {
    super("This client is archived. Restore it before changing it.");
    this.name = "CompanyArchivedError";
  }
}

export class ContactNotFoundError extends Error {
  constructor() {
    super("Contact not found.");
    this.name = "ContactNotFoundError";
  }
}

export type IdentifierField = "vatNumber" | "registrationNumber";

export class DuplicateIdentifierError extends Error {
  constructor(readonly field: IdentifierField) {
    super(
      field === "vatNumber"
        ? "Another client in this organization already has this VAT number. If that client is archived, restore it instead."
        : "Another client in this organization already has this registration number. If that client is archived, restore it instead.",
    );
    this.name = "DuplicateIdentifierError";
  }
}

export class InvalidCompanyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCompanyInputError";
  }
}

// --- normalization ----------------------------------------------------------

/** Upper case without spaces or dots: the stored form, also enforced by a CHECK constraint. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function normalizeIdentifier(value: string): string {
  return value.replace(/[\s.]/g, "").toUpperCase();
}

/**
 * Maps an optional text input to what is stored: undefined stays undefined
 * (field not sent), and blank or null becomes null (field cleared).
 */
function optionalText(value: string | null | undefined, transform = (text: string) => text) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : transform(trimmed);
}

function optionalIdentifier(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = normalizeIdentifier(value);
  return normalized === "" ? null : normalized;
}

function optionalEmail(value: string | null | undefined, label: string) {
  const email = optionalText(value, normalizeEmail);
  if (email && !isPlausibleEmail(email)) {
    throw new InvalidCompanyInputError(`${label} is not a valid email address.`);
  }
  return email;
}

function requiredName(value: string, label: string) {
  const name = normalizeName(value);
  if (name === "") throw new InvalidCompanyInputError(`${label} is required.`);
  return name;
}

const COMPANY_FIELDS = [
  "name",
  "legalName",
  "email",
  "phone",
  "registrationNumber",
  "vatNumber",
  "industry",
  "accountingPackage",
  "addressLine",
  "postalCode",
  "city",
  "country",
] as const;

type CompanyField = (typeof COMPANY_FIELDS)[number];
type CompanyData = { name?: string } & Partial<Record<Exclude<CompanyField, "name">, string | null>>;

function toCompanyData(input: CompanyUpdateInput): CompanyData {
  const data: CompanyData = {
    legalName: optionalText(input.legalName, normalizeName),
    email: optionalEmail(input.email, "The client email"),
    phone: optionalText(input.phone),
    registrationNumber: optionalIdentifier(input.registrationNumber),
    vatNumber: optionalIdentifier(input.vatNumber),
    industry: optionalText(input.industry, normalizeName),
    accountingPackage: optionalText(input.accountingPackage, normalizeName),
    addressLine: optionalText(input.addressLine, normalizeName),
    postalCode: optionalText(input.postalCode, (text) => text.toUpperCase()),
    city: optionalText(input.city, normalizeName),
    country: optionalText(input.country, (text) => text.toUpperCase()),
  };
  if (input.name !== undefined) data.name = requiredName(input.name, "The client name");

  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  ) as CompanyData;
}

const CONTACT_FIELDS = ["name", "email", "phone", "role", "isPrimary"] as const;
type ContactField = (typeof CONTACT_FIELDS)[number];
type ContactData = Partial<{ name: string; email: string | null; phone: string | null; role: string | null; isPrimary: boolean }>;

function toContactData(input: ClientContactUpdateInput): ContactData {
  const data: ContactData = {
    email: optionalEmail(input.email, "The contact email"),
    phone: optionalText(input.phone),
    role: optionalText(input.role, normalizeName),
    isPrimary: input.isPrimary,
  };
  if (input.name !== undefined) data.name = requiredName(input.name, "The contact name");

  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  ) as ContactData;
}

// --- shared -----------------------------------------------------------------

const companySelect = {
  id: true,
  name: true,
  legalName: true,
  email: true,
  phone: true,
  registrationNumber: true,
  vatNumber: true,
  industry: true,
  accountingPackage: true,
  addressLine: true,
  postalCode: true,
  city: true,
  country: true,
  peppolStatus: true,
  readinessScore: true,
  lastCheckedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CompanySelect;

const contactSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isPrimary: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ClientContactSelect;

const contactOrder = [
  { isPrimary: "desc" },
  { name: "asc" },
  { id: "asc" },
] as const satisfies Prisma.ClientContactOrderByWithRelationInput[];

type Tx = Prisma.TransactionClient;

/** Locks the client row for this transaction, within the caller's organization only. */
async function lockCompany(tx: Tx, actor: Actor, companyId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; archivedAt: Date | null }>>`
    SELECT "id", "archivedAt" FROM "public"."companies"
    WHERE "id" = ${companyId} AND "organizationId" = ${actor.organizationId}
    FOR UPDATE`;
  return rows[0] ?? null;
}

async function lockActiveCompany(tx: Tx, actor: Actor, companyId: string) {
  const company = await lockCompany(tx, actor, companyId);
  if (!company) throw new CompanyNotFoundError();
  if (company.archivedAt) throw new CompanyArchivedError();
  return company;
}

function rethrowDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = error.meta?.["target"];
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
    if (fields.some((field) => field.includes("vatNumber"))) throw new DuplicateIdentifierError("vatNumber");
    if (fields.some((field) => field.includes("registrationNumber"))) {
      throw new DuplicateIdentifierError("registrationNumber");
    }
  }
  throw error;
}

function changedFields<K extends string>(
  current: Record<K, unknown>,
  next: Partial<Record<K, unknown>>,
): K[] {
  return (Object.keys(next) as K[]).filter((field) => current[field] !== next[field]);
}

function pick<T extends object, K extends keyof T>(source: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K>;
}

// --- companies --------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 25;

export type ListCompaniesQuery = {
  search?: string;
  status?: CompanyListStatus;
  peppolStatus?: PeppolStatus;
  industry?: string;
  sort?: CompanySort;
  page?: number;
  pageSize?: number;
};

/** Fixed sort keys only, each with a stable tiebreaker so pages never overlap. */
const SORT_ORDER: Record<CompanySort, Prisma.CompanyOrderByWithRelationInput[]> = {
  name: [{ name: "asc" }, { id: "asc" }],
  "-name": [{ name: "desc" }, { id: "asc" }],
  readinessScore: [{ readinessScore: "asc" }, { name: "asc" }, { id: "asc" }],
  "-readinessScore": [{ readinessScore: "desc" }, { name: "asc" }, { id: "asc" }],
  lastCheckedAt: [{ lastCheckedAt: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
  "-lastCheckedAt": [{ lastCheckedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
  createdAt: [{ createdAt: "asc" }, { id: "asc" }],
  "-createdAt": [{ createdAt: "desc" }, { id: "asc" }],
};

export async function listCompanies(actor: Actor, query: ListCompaniesQuery) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(page) || !Number.isInteger(pageSize)) {
    throw new InvalidCompanyInputError("page and pageSize must be whole numbers.");
  }

  const status = query.status ?? "active";
  const where: Prisma.CompanyWhereInput = {
    organizationId: actor.organizationId,
    ...(status === "active" ? { archivedAt: null } : {}),
    ...(status === "archived" ? { archivedAt: { not: null } } : {}),
    ...(query.peppolStatus ? { peppolStatus: query.peppolStatus } : {}),
  };

  const industry = query.industry?.trim();
  if (industry) where.industry = { equals: industry, mode: "insensitive" };

  // Prisma passes `contains` to LIKE unescaped, so %, _ and \ would act as
  // wildcards: a search for "%" would match every client.
  const search = query.search ? escapeLike(normalizeName(query.search)) : "";
  if (search) {
    const identifier = normalizeIdentifier(search);
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { legalName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      ...(identifier
        ? [{ vatNumber: { contains: identifier } }, { registrationNumber: { contains: identifier } }]
        : []),
    ];
  }

  const [total, items] = await prisma.$transaction([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      select: companySelect,
      orderBy: SORT_ORDER[query.sort ?? "name"],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { items, page, pageSize, total };
}

export async function getCompany(actor: Actor, companyId: string) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: actor.organizationId },
    select: { ...companySelect, contacts: { select: contactSelect, orderBy: contactOrder } },
  });
  if (!company) throw new CompanyNotFoundError();
  return company;
}

export async function createCompany(actor: Actor, input: CompanyInput) {
  const data = toCompanyData(input) as CompanyData & { name: string };

  let companyId: string;
  try {
    companyId = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { ...data, organizationId: actor.organizationId },
        select: { id: true },
      });
      await tx.auditEvent.create({
        data: auditEvent({
          eventType: "company.created",
          organizationId: actor.organizationId,
          actorId: actor.userId,
          entityType: "company",
          entityId: company.id,
          metadata: { fields: Object.keys(data).filter((field) => data[field as CompanyField] !== null) },
        }),
      });
      return company.id;
    });
  } catch (error) {
    rethrowDuplicate(error);
  }

  return getCompany(actor, companyId);
}

export async function updateCompany(actor: Actor, companyId: string, input: CompanyUpdateInput) {
  const data = toCompanyData(input);
  if (Object.keys(data).length === 0) {
    throw new InvalidCompanyInputError("Provide at least one field to change.");
  }

  try {
    await prisma.$transaction(async (tx) => {
      await lockActiveCompany(tx, actor, companyId);

      const current = await tx.company.findFirst({
        where: { id: companyId, organizationId: actor.organizationId },
        select: Object.fromEntries(COMPANY_FIELDS.map((field) => [field, true])) as Record<CompanyField, true>,
      });
      if (!current) throw new CompanyNotFoundError();

      const fields = changedFields<CompanyField>(current, data) as Array<keyof CompanyData>;
      if (fields.length === 0) return;

      const { count } = await tx.company.updateMany({
        where: { id: companyId, organizationId: actor.organizationId, archivedAt: null },
        data: pick(data, fields),
      });
      if (count !== 1) throw new CompanyNotFoundError();

      await tx.auditEvent.create({
        data: auditEvent({
          eventType: "company.updated",
          organizationId: actor.organizationId,
          actorId: actor.userId,
          entityType: "company",
          entityId: companyId,
          metadata: { fields },
        }),
      });
    });
  } catch (error) {
    rethrowDuplicate(error);
  }

  return getCompany(actor, companyId);
}

async function setArchived(actor: Actor, companyId: string, archive: boolean) {
  await prisma.$transaction(async (tx) => {
    const company = await lockCompany(tx, actor, companyId);
    if (!company) throw new CompanyNotFoundError();
    // Idempotent: already in the requested state, so nothing changes and
    // nothing is recorded.
    if (Boolean(company.archivedAt) === archive) return;

    const { count } = await tx.company.updateMany({
      where: {
        id: companyId,
        organizationId: actor.organizationId,
        archivedAt: archive ? null : { not: null },
      },
      data: { archivedAt: archive ? new Date() : null },
    });
    if (count !== 1) throw new CompanyNotFoundError();

    await tx.auditEvent.create({
      data: auditEvent({
        eventType: archive ? "company.archived" : "company.restored",
        organizationId: actor.organizationId,
        actorId: actor.userId,
        entityType: "company",
        entityId: companyId,
      }),
    });
  });

  return getCompany(actor, companyId);
}

export function archiveCompany(actor: Actor, companyId: string) {
  return setArchived(actor, companyId, true);
}

export function restoreCompany(actor: Actor, companyId: string) {
  return setArchived(actor, companyId, false);
}

// --- contacts ---------------------------------------------------------------

export async function listContacts(actor: Actor, companyId: string) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: actor.organizationId },
    select: { id: true },
  });
  if (!company) throw new CompanyNotFoundError();

  return prisma.clientContact.findMany({
    where: { companyId, company: { organizationId: actor.organizationId } },
    select: contactSelect,
    orderBy: contactOrder,
  });
}

/** Within the locked client, so two requests cannot both leave a primary contact. */
async function clearOtherPrimaryContacts(tx: Tx, actor: Actor, companyId: string, keepContactId?: string) {
  await tx.clientContact.updateMany({
    where: {
      companyId,
      company: { organizationId: actor.organizationId },
      isPrimary: true,
      ...(keepContactId ? { id: { not: keepContactId } } : {}),
    },
    data: { isPrimary: false },
  });
}

export async function createContact(actor: Actor, companyId: string, input: ClientContactInput) {
  const data = toContactData(input) as ContactData & { name: string };

  return prisma.$transaction(async (tx) => {
    await lockActiveCompany(tx, actor, companyId);
    if (data.isPrimary) await clearOtherPrimaryContacts(tx, actor, companyId);

    // companyId was verified inside this transaction against the caller's
    // organization, and that row is locked until commit.
    const contact = await tx.clientContact.create({
      data: { ...data, companyId },
      select: contactSelect,
    });

    await tx.auditEvent.create({
      data: auditEvent({
        eventType: "contact.created",
        organizationId: actor.organizationId,
        actorId: actor.userId,
        entityType: "client_contact",
        entityId: contact.id,
        metadata: {
          companyId,
          fields: Object.keys(data).filter((field) => {
            const value = data[field as ContactField];
            return value !== null && value !== false;
          }),
        },
      }),
    });

    return contact;
  });
}

export async function updateContact(
  actor: Actor,
  companyId: string,
  contactId: string,
  input: ClientContactUpdateInput,
) {
  const data = toContactData(input);
  if (Object.keys(data).length === 0) {
    throw new InvalidCompanyInputError("Provide at least one field to change.");
  }

  const scope = { id: contactId, companyId, company: { organizationId: actor.organizationId } };

  return prisma.$transaction(async (tx) => {
    await lockActiveCompany(tx, actor, companyId);

    const current = await tx.clientContact.findFirst({ where: scope, select: contactSelect });
    if (!current) throw new ContactNotFoundError();

    const fields = changedFields<ContactField>(current, data) as Array<keyof ContactData>;
    if (fields.length === 0) return current;

    if (data.isPrimary === true && fields.includes("isPrimary")) {
      await clearOtherPrimaryContacts(tx, actor, companyId, contactId);
    }

    const { count } = await tx.clientContact.updateMany({ where: scope, data: pick(data, fields) });
    if (count !== 1) throw new ContactNotFoundError();

    await tx.auditEvent.create({
      data: auditEvent({
        eventType: "contact.updated",
        organizationId: actor.organizationId,
        actorId: actor.userId,
        entityType: "client_contact",
        entityId: contactId,
        metadata: { companyId, fields },
      }),
    });

    const updated = await tx.clientContact.findFirst({ where: scope, select: contactSelect });
    if (!updated) throw new ContactNotFoundError();
    return updated;
  });
}

export async function deleteContact(actor: Actor, companyId: string, contactId: string) {
  await prisma.$transaction(async (tx) => {
    await lockActiveCompany(tx, actor, companyId);

    const { count } = await tx.clientContact.deleteMany({
      where: { id: contactId, companyId, company: { organizationId: actor.organizationId } },
    });
    if (count !== 1) throw new ContactNotFoundError();

    await tx.auditEvent.create({
      data: auditEvent({
        eventType: "contact.deleted",
        organizationId: actor.organizationId,
        actorId: actor.userId,
        entityType: "client_contact",
        entityId: contactId,
        metadata: { companyId },
      }),
    });
  });
}
