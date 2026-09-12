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
import {
  AUTH_EVENTS,
  authEvent,
  logFailedLogin,
  queueAuditOnDestroy,
  queueAuditOnSave,
  requestContext,
} from "../lib/auth-audit";
import { loginProtection } from "../lib/login-rate-limit";
import { SESSION_COOKIE_NAME } from "../lib/session";

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
    logFailedLogin(req, "rate_limited_client");
    throw tooManyRequests(client.retryAfterSeconds, TOO_MANY_ATTEMPTS);
  }

  const body = LoginBody.safeParse(req.body);
  if (!body.success) {
    loginProtection.client.consume(clientKey);
    logFailedLogin(req, "invalid_request");
    throw badRequest("An email address and password are required.");
  }

  // Keyed on every submitted email, existing or not, so a 429 cannot be used
  // to learn which addresses have accounts.
  const account = normalizeEmail(body.data.email);
  const accountState = loginProtection.account.peek(account);
  if (!accountState.allowed) {
    logFailedLogin(req, "rate_limited_account", account);
    throw tooManyRequests(accountState.retryAfterSeconds, TOO_MANY_ATTEMPTS);
  }

  const release = loginProtection.verifications.tryAcquire();
  if (!release) {
    logFailedLogin(req, "verification_capacity", account);
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
    logFailedLogin(req, "invalid_credentials", account);
    throw unauthorized("That email address and password do not match.");
  }
  loginProtection.account.reset(account);

  const session = await loadSession(
    credentials.userId,
    credentials.organizationId,
  );
  if (!session) {
    logFailedLogin(req, "invalid_credentials", account);
    throw unauthorized("That email address and password do not match.");
  }

  // New session id on sign-in, so a pre-login id cannot be replayed.
  await regenerate(req);
  req.session.userId = credentials.userId;
  req.session.organizationId = credentials.organizationId;
  // Committed by the session store in the same transaction as the new session.
  queueAuditOnSave(
    req.session,
    authEvent({
      eventType: AUTH_EVENTS.loginSucceeded,
      organizationId: credentials.organizationId,
      userId: credentials.userId,
      metadata: { method: "password", ...requestContext(req) },
    }),
  );
  await save(req);

  res.json(LoginResponse.parse(session));
});

router.post("/auth/logout", (req, res, next) => {
  const { userId, organizationId } = req.session ?? {};
  // An anonymous request has nothing to sign out of, so nothing to record.
  if (userId && organizationId) {
    queueAuditOnDestroy(
      req.sessionID,
      authEvent({
        eventType: AUTH_EVENTS.logout,
        organizationId,
        userId,
        metadata: requestContext(req),
      }),
    );
  }

  req.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }

    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
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

  const previousOrganizationId = req.session.organizationId;
  req.session.organizationId = body.data.organizationId;

  if (previousOrganizationId && previousOrganizationId !== body.data.organizationId) {
    // One event in each organization's trail. Neither names the other
    // organization: that would tell one firm's administrators which other firms
    // their colleague also belongs to.
    const context = requestContext(req);
    queueAuditOnSave(
      req.session,
      authEvent({
        eventType: AUTH_EVENTS.organizationSwitched,
        organizationId: previousOrganizationId,
        userId,
        metadata: { direction: "left", ...context },
      }),
      authEvent({
        eventType: AUTH_EVENTS.organizationSwitched,
        organizationId: body.data.organizationId,
        userId,
        metadata: { direction: "entered", ...context },
      }),
    );
  }
  await save(req);

  res.json(SwitchOrganizationResponse.parse(session));
});

export default router;
