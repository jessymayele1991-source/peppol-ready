import { Router, type IRouter, type Request } from "express";
import {
  GetSessionResponse,
  LoginBody,
  LoginResponse,
  RegisterBody,
  RegisterResponse,
  SwitchOrganizationBody,
  SwitchOrganizationResponse,
} from "@workspace/api-zod";
import {
  EmailInUseError,
  canAccessOrganization,
  isPlausibleEmail,
  loadSession,
  normalizeEmail,
  normalizeName,
  registerAccount,
  verifyCredentials,
} from "../lib/auth-service";
import {
  badRequest,
  conflict,
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

/**
 * The one way a session begins, for sign-in and for registration alike: a new
 * session id, so a pre-login id cannot be replayed, and an `auth.login.success`
 * event committed by the session store in the same transaction as the session.
 */
async function startSession(
  req: Request,
  credentials: { userId: string; organizationId: string },
  method: "password" | "registration",
): Promise<void> {
  await regenerate(req);
  req.session.userId = credentials.userId;
  req.session.organizationId = credentials.organizationId;
  queueAuditOnSave(
    req.session,
    authEvent({
      eventType: AUTH_EVENTS.loginSucceeded,
      organizationId: credentials.organizationId,
      userId: credentials.userId,
      metadata: { method, ...requestContext(req) },
    }),
  );
  await save(req);
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

  await startSession(req, credentials, "password");

  res.json(LoginResponse.parse(session));
});

router.post("/auth/register", async (req, res) => {
  // Every attempt counts, successful or not: registering is rare, and each
  // attempt that reaches the database reveals whether an address is taken.
  const client = loginProtection.registration.consume(req.ip ?? "unknown");
  if (!client.allowed) {
    throw tooManyRequests(
      client.retryAfterSeconds,
      "Too many registration attempts. Try again later.",
    );
  }

  const body = RegisterBody.safeParse(req.body);
  if (
    !body.success ||
    normalizeName(body.data.name) === "" ||
    !isPlausibleEmail(normalizeEmail(body.data.email))
  ) {
    throw badRequest(
      "A name, a valid email address and a password of at least 12 characters are required.",
    );
  }

  // Hashing a new password costs the same scrypt work as verifying one.
  const release = loginProtection.verifications.tryAcquire();
  if (!release) {
    throw tooManyRequests(1, "Too many requests are being processed. Try again shortly.");
  }

  let credentials: Awaited<ReturnType<typeof registerAccount>>;
  try {
    credentials = await registerAccount(body.data, requestContext(req));
  } catch (error) {
    if (error instanceof EmailInUseError) throw conflict(error.message);
    throw error;
  } finally {
    release();
  }

  const session = await loadSession(credentials.userId, credentials.organizationId);
  // The account was committed a moment ago in one transaction; if it cannot be
  // read back, that is a server fault, not something the visitor can fix.
  if (!session) throw new Error("A newly registered account could not be loaded.");

  await startSession(req, credentials, "registration");

  res.status(201).json(RegisterResponse.parse(session));
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
