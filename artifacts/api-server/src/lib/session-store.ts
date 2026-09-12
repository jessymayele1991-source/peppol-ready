import { Store, type SessionData } from "express-session";
import { Prisma } from "@prisma/client";
import {
  clearAuditOnSave,
  pendingAuditOnSave,
  takeAuditOnDestroy,
} from "./auth-audit";
import { logger } from "./logger";
import { prisma } from "./prisma";

function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  );
}

/**
 * Session storage on Prisma rather than connect-pg-simple. Keeping the table
 * in the Prisma schema means `prisma migrate dev` never reads it as drift and
 * offers to reset the database, and it keeps the workspace on a single ORM.
 */
export class PrismaSessionStore extends Store {
  override get(
    sid: string,
    callback: (error: unknown, session?: SessionData | null) => void,
  ): void {
    void prisma.userSession
      .findUnique({ where: { sid } })
      .then((record) => {
        if (!record) {
          callback(null, null);
          return;
        }

        // Treat an expired row as absent; the sweep below removes it later.
        if (record.expiresAt.getTime() <= Date.now()) {
          callback(null, null);
          return;
        }

        callback(null, record.data as unknown as SessionData);
      })
      .catch((error: unknown) => callback(error));
  }

  /**
   * Writes the session together with any audit events queued against it, in one
   * transaction. The queue is cleared only after the commit, so a failed write
   * that express-session retries at the end of the response still carries them.
   */
  override set(
    sid: string,
    session: SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    const data = session as unknown as Prisma.InputJsonValue;
    const expiresAt = resolveExpiry(session);
    const events = pendingAuditOnSave(session);

    const write = prisma.userSession.upsert({
      where: { sid },
      update: { data, expiresAt },
      create: { sid, data, expiresAt },
    });

    const committed =
      events.length === 0
        ? write
        : prisma.$transaction([
            write,
            ...events.map((event) => prisma.auditEvent.create({ data: event })),
          ]);

    void committed
      .then(() => {
        clearAuditOnSave(session);
        callback?.();
      })
      .catch((error: unknown) => callback?.(error));
  }

  /**
   * Deletes the session together with its queued sign-out event. Sign-out must
   * never be refused: if the event cannot be written because its organization no
   * longer exists, the session is still deleted and the gap is logged.
   */
  override destroy(sid: string, callback?: (error?: unknown) => void): void {
    const events = takeAuditOnDestroy(sid);
    const remove = prisma.userSession.deleteMany({ where: { sid } });

    if (events.length === 0) {
      void remove
        .then(() => callback?.())
        .catch((error: unknown) => callback?.(error));
      return;
    }

    void prisma
      .$transaction([
        remove,
        ...events.map((event) => prisma.auditEvent.create({ data: event })),
      ])
      .then(() => callback?.())
      .catch((error: unknown) => {
        if (!isForeignKeyViolation(error)) {
          callback?.(error);
          return;
        }

        logger.error(
          { event: events[0]?.eventType, organizationId: events[0]?.organizationId },
          "Sign-out audit event could not be written; its organization no longer exists",
        );
        void prisma.userSession
          .deleteMany({ where: { sid } })
          .then(() => callback?.())
          .catch((retryError: unknown) => callback?.(retryError));
      });
  }

  override touch(
    sid: string,
    session: SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    void prisma.userSession
      .updateMany({
        where: { sid },
        data: { expiresAt: resolveExpiry(session) },
      })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  /** Removes expired rows. Called on an interval from the app entrypoint. */
  async sweep(): Promise<number> {
    const { count } = await prisma.userSession.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    return count;
  }
}

function resolveExpiry(session: SessionData): Date {
  const expires = session.cookie?.expires;
  if (expires) return new Date(expires);

  const maxAge = session.cookie?.maxAge;
  return new Date(Date.now() + (maxAge ?? SESSION_TTL_MS));
}

export const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
