import { createHmac } from "node:crypto";
import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import type { SessionData } from "express-session";
import { SESSION_SECRET } from "./session-secret";

/**
 * Authentication audit trail.
 *
 * Events that accompany a session change are not written by the route. They
 * are queued against the session and committed by PrismaSessionStore in the
 * same transaction as the session row itself, so a sign-in, organization switch
 * or sign-out is either persisted together with its audit event or not at all.
 *
 * Never recorded: passwords, session ids or cookies, and plaintext email
 * addresses of failed attempts.
 */

export const AUTH_EVENTS = {
  registered: "auth.registered",
  loginSucceeded: "auth.login.success",
  loginFailed: "auth.login.failed",
  logout: "auth.logout",
  organizationSwitched: "auth.organization_switched",
} as const;

export type AuthAuditEvent = Prisma.AuditEventUncheckedCreateInput;

const USER_AGENT_LIMIT = 200;

/** Request context worth keeping for security review; nothing that grants access. */
export function requestContext(req: Request) {
  const userAgent = req.get("user-agent");
  return {
    ip: req.ip ?? null,
    userAgent: userAgent ? userAgent.slice(0, USER_AGENT_LIMIT) : null,
  };
}

export function authEvent(input: {
  eventType: string;
  organizationId: string;
  userId: string;
  metadata: Prisma.InputJsonObject;
}): AuthAuditEvent {
  return {
    organizationId: input.organizationId,
    actorId: input.userId,
    eventType: input.eventType,
    entityType: "user",
    entityId: input.userId,
    metadata: input.metadata,
  };
}

// Keyed on the Session object that express-session hands to store.set, so the
// event travels with exactly the session write it describes. A WeakMap keeps it
// out of the serialized session data and lets it be collected with the request.
const pendingForSave = new WeakMap<object, AuthAuditEvent[]>();
// store.destroy only receives the session id.
const pendingForDestroy = new Map<string, AuthAuditEvent[]>();

export function queueAuditOnSave(session: SessionData, ...events: AuthAuditEvent[]) {
  pendingForSave.set(session, [...(pendingForSave.get(session) ?? []), ...events]);
}

export function queueAuditOnDestroy(sessionId: string, ...events: AuthAuditEvent[]) {
  pendingForDestroy.set(sessionId, [...(pendingForDestroy.get(sessionId) ?? []), ...events]);
}

/**
 * Read without removing. The store clears the queue only after its transaction
 * commits: if the write fails, express-session saves the session again when the
 * response ends, and that retry must carry the same events — otherwise it would
 * persist a signed-in session with no audit record.
 */
export function pendingAuditOnSave(session: SessionData): AuthAuditEvent[] {
  return pendingForSave.get(session) ?? [];
}

export function clearAuditOnSave(session: SessionData) {
  pendingForSave.delete(session);
}

export function takeAuditOnDestroy(sessionId: string): AuthAuditEvent[] {
  const events = pendingForDestroy.get(sessionId) ?? [];
  pendingForDestroy.delete(sessionId);
  return events;
}

export type LoginFailureReason =
  | "invalid_request"
  | "invalid_credentials"
  | "rate_limited_client"
  | "rate_limited_account"
  | "verification_capacity";

/**
 * A stable pseudonym for an email address: failed attempts against one account
 * can be correlated in the logs without storing the address, and without the
 * server secret the hash cannot be reversed or recomputed for a guessed address.
 */
export function accountPseudonym(normalizedEmail: string): string {
  return createHmac("sha256", SESSION_SECRET)
    .update(normalizedEmail)
    .digest("hex")
    .slice(0, 24);
}

/**
 * Failed sign-ins go to structured logs, never to audit_events. An unknown
 * account has no organization to file the event under, and writing a database
 * row only when the account exists would make failures against real accounts
 * measurably slower — reopening the account enumeration that constant-time
 * verification closed.
 */
export function logFailedLogin(
  req: Request,
  reason: LoginFailureReason,
  normalizedEmail?: string,
) {
  req.log.warn(
    {
      event: AUTH_EVENTS.loginFailed,
      reason,
      account: normalizedEmail ? accountPseudonym(normalizedEmail) : null,
      ...requestContext(req),
    },
    "Sign-in failed",
  );
}
