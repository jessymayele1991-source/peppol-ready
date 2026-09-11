import { Store, type SessionData } from "express-session";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

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

  override set(
    sid: string,
    session: SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    const data = session as unknown as Prisma.InputJsonValue;
    const expiresAt = resolveExpiry(session);

    void prisma.userSession
      .upsert({
        where: { sid },
        update: { data, expiresAt },
        create: { sid, data, expiresAt },
      })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  override destroy(sid: string, callback?: (error?: unknown) => void): void {
    void prisma.userSession
      .deleteMany({ where: { sid } })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
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
