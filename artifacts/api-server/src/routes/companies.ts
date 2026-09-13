import { Router, type IRouter, type Request } from "express";
import {
  ArchiveCompanyResponse,
  CreateCompanyBody,
  CreateCompanyContactBody,
  CreateCompanyContactResponse,
  CreateCompanyResponse,
  DeleteCompanyContactParams,
  GetCompanyParams,
  GetCompanyResponse,
  ListCompaniesQueryParams,
  ListCompaniesResponse,
  ListCompanyContactsResponse,
  RestoreCompanyResponse,
  UpdateCompanyBody,
  UpdateCompanyContactBody,
  UpdateCompanyContactResponse,
  UpdateCompanyResponse,
} from "@workspace/api-zod";
import {
  CompanyArchivedError,
  CompanyNotFoundError,
  ContactNotFoundError,
  DuplicateIdentifierError,
  InvalidCompanyInputError,
  archiveCompany,
  createCompany,
  createContact,
  deleteContact,
  getCompany,
  listCompanies,
  listContacts,
  restoreCompany,
  updateCompany,
  updateContact,
  type Actor,
} from "../lib/company-service";
import { AppError, badRequest, conflict, notFound, unauthorized } from "../lib/errors";
import { requireAuth } from "../middlewares/require-auth";
import { requireCapability } from "../middlewares/require-capability";

const router: IRouter = Router();

/** The tenant comes from the session only; request data never contributes to it. */
function actorOf(req: Request): Actor {
  if (!req.auth) throw unauthorized();
  return { userId: req.auth.userId, organizationId: req.auth.organizationId };
}

/** Domain errors to the API envelope. A client of another firm is simply "not found". */
function toApiError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (error instanceof CompanyNotFoundError || error instanceof ContactNotFoundError) {
    return notFound(error.message);
  }
  if (error instanceof CompanyArchivedError || error instanceof DuplicateIdentifierError) {
    return conflict(error.message);
  }
  if (error instanceof InvalidCompanyInputError) return badRequest(error.message);
  return error;
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toApiError(error);
  }
}

function companyIdOf(req: Request): string {
  const params = GetCompanyParams.safeParse(req.params);
  if (!params.success) throw notFound("Client not found.");
  return params.data.companyId;
}

router.get("/companies", requireAuth, requireCapability("clients.view"), async (req, res) => {
  const actor = actorOf(req);
  const query = ListCompaniesQueryParams.safeParse(req.query);
  if (!query.success) throw badRequest("The client list query is invalid.");

  const page = await run(() => listCompanies(actor, query.data));
  res.json(ListCompaniesResponse.parse(page));
});

router.post("/companies", requireAuth, requireCapability("clients.write"), async (req, res) => {
  const actor = actorOf(req);
  const body = CreateCompanyBody.safeParse(req.body);
  if (!body.success) throw badRequest("The client details are invalid.");

  const company = await run(() => createCompany(actor, body.data));
  res.status(201).json(CreateCompanyResponse.parse(company));
});

router.get("/companies/:companyId", requireAuth, requireCapability("clients.view"), async (req, res) => {
  const actor = actorOf(req);
  const company = await run(() => getCompany(actor, companyIdOf(req)));
  res.json(GetCompanyResponse.parse(company));
});

router.patch("/companies/:companyId", requireAuth, requireCapability("clients.write"), async (req, res) => {
  const actor = actorOf(req);
  const companyId = companyIdOf(req);
  const body = UpdateCompanyBody.safeParse(req.body);
  if (!body.success) throw badRequest("The client details are invalid.");

  const company = await run(() => updateCompany(actor, companyId, body.data));
  res.json(UpdateCompanyResponse.parse(company));
});

router.post("/companies/:companyId/archive", requireAuth, requireCapability("clients.archive"), async (req, res) => {
  const actor = actorOf(req);
  const company = await run(() => archiveCompany(actor, companyIdOf(req)));
  res.json(ArchiveCompanyResponse.parse(company));
});

router.post("/companies/:companyId/restore", requireAuth, requireCapability("clients.archive"), async (req, res) => {
  const actor = actorOf(req);
  const company = await run(() => restoreCompany(actor, companyIdOf(req)));
  res.json(RestoreCompanyResponse.parse(company));
});

router.get("/companies/:companyId/contacts", requireAuth, requireCapability("clients.view"), async (req, res) => {
  const actor = actorOf(req);
  const contacts = await run(() => listContacts(actor, companyIdOf(req)));
  res.json(ListCompanyContactsResponse.parse(contacts));
});

router.post("/companies/:companyId/contacts", requireAuth, requireCapability("clients.write"), async (req, res) => {
  const actor = actorOf(req);
  const companyId = companyIdOf(req);
  const body = CreateCompanyContactBody.safeParse(req.body);
  if (!body.success) throw badRequest("The contact details are invalid.");

  const contact = await run(() => createContact(actor, companyId, body.data));
  res.status(201).json(CreateCompanyContactResponse.parse(contact));
});

router.patch(
  "/companies/:companyId/contacts/:contactId",
  requireAuth,
  requireCapability("clients.write"),
  async (req, res) => {
    const actor = actorOf(req);
    const params = DeleteCompanyContactParams.safeParse(req.params);
    if (!params.success) throw notFound("Contact not found.");
    const body = UpdateCompanyContactBody.safeParse(req.body);
    if (!body.success) throw badRequest("The contact details are invalid.");

    const contact = await run(() =>
      updateContact(actor, params.data.companyId, params.data.contactId, body.data),
    );
    res.json(UpdateCompanyContactResponse.parse(contact));
  },
);

router.delete(
  "/companies/:companyId/contacts/:contactId",
  requireAuth,
  requireCapability("clients.write"),
  async (req, res) => {
    const actor = actorOf(req);
    const params = DeleteCompanyContactParams.safeParse(req.params);
    if (!params.success) throw notFound("Contact not found.");

    await run(() => deleteContact(actor, params.data.companyId, params.data.contactId));
    res.status(204).end();
  },
);

export default router;
