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
  normalizeEmail,
  verifyCredentials,
} from "../lib/auth-service";
import {
  badRequest,
  forbidden,
  tooManyRequests,
  unauthorized,
} from "../lib/errors";
import { loginProtection } from "../lib/login-rate-limit";

const router: IRouter = Router();

const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Try again later.";

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
  // Only failed and invalid attempts count against a client address. Spraying
  // consists entirely of failures, while an office signing in behind one NAT
  // address at the start of the day consists of successes and must not be
  // locked out.
  const clientKey = req.ip ?? "unknown";
  const client = loginProtection.client.peek(clientKey);
  if (!client.allowed) {
    throw tooManyRequests(client.retryAfterSeconds, TOO_MANY_ATTEMPTS);
  }

  const body = LoginBody.safeParse(req.body);
  if (!body.success) {
    loginProtection.client.consume(clientKey);
    throw badRequest("An email address and password are required.");
  }

  // Keyed on every submitted email, existing or not, so a 429 cannot be used
  // to learn which addresses have accounts.
  const account = normalizeEmail(body.data.email);
  const accountState = loginProtection.account.peek(account);
  if (!accountState.allowed) {
    throw tooManyRequests(accountState.retryAfterSeconds, TOO_MANY_ATTEMPTS);
  }

  const release = loginProtection.verifications.tryAcquire();
  if (!release) {
    throw tooManyRequests(1, "Too many sign-in attempts are being processed. Try again shortly.");
  }

  let credentials: Awaited<ReturnType<typeof verifyCredentials>>;
  try {
    credentials = await verifyCredentials(body.data.email, body.data.password);
  } finally {
    release();
  }

  // Deliberately identical for an unknown account and a wrong password.
  if (!credentials) {
    loginProtection.client.consume(clientKey);
    loginProtection.account.consume(account);
    throw unauthorized("That email address and password do not match.");
  }
  loginProtection.account.reset(account);

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
