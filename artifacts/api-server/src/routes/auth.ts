import { Router, type IRouter, type Request } from "express";
import {
  GetSessionResponse,
  LoginBody,
  LoginResponse,
  SwitchOrganizationBody,
  SwitchOrganizationResponse,
} from "@workspace/api-zod";
import {
  canAccessOrganization,
  loadSession,
  verifyCredentials,
} from "../lib/auth-service";
import { badRequest, forbidden, unauthorized } from "../lib/errors";

const router: IRouter = Router();

/** express-session regenerates the id on privilege change, which needs a promise. */
function regenerate(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function save(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

router.post("/auth/login", async (req, res) => {
  const body = LoginBody.safeParse(req.body);
  if (!body.success) {
    throw badRequest("An email address and password are required.");
  }

  const credentials = await verifyCredentials(
    body.data.email,
    body.data.password,
  );
  // Deliberately identical for an unknown account and a wrong password.
  if (!credentials) {
    throw unauthorized("That email address and password do not match.");
  }

  const session = await loadSession(
    credentials.userId,
    credentials.organizationId,
  );
  if (!session) {
    throw unauthorized("That email address and password do not match.");
  }

  // New session id on sign-in, so a pre-login id cannot be replayed.
  await regenerate(req);
  req.session.userId = credentials.userId;
  req.session.organizationId = credentials.organizationId;
  await save(req);

  res.json(LoginResponse.parse(session));
});

router.post("/auth/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }

    res.clearCookie("peppol_ready_sid", { path: "/" });
    res.status(204).end();
  });
});

router.get("/auth/session", async (req, res) => {
  const { userId, organizationId } = req.session ?? {};
  if (!userId || !organizationId) throw unauthorized();

  const session = await loadSession(userId, organizationId);
  if (!session) throw unauthorized("Your session is no longer valid.");

  res.json(GetSessionResponse.parse(session));
});

router.post("/auth/organization", async (req, res) => {
  const { userId } = req.session ?? {};
  if (!userId) throw unauthorized();

  const body = SwitchOrganizationBody.safeParse(req.body);
  if (!body.success) throw badRequest("An organization is required.");

  // Without this check the tenant boundary just moves from the query string
  // to the request body.
  const allowed = await canAccessOrganization(userId, body.data.organizationId);
  if (!allowed) throw forbidden("You are not a member of that workspace.");

  const session = await loadSession(userId, body.data.organizationId);
  if (!session) throw forbidden("You are not a member of that workspace.");

  req.session.organizationId = body.data.organizationId;
  await save(req);

  res.json(SwitchOrganizationResponse.parse(session));
});

export default router;
