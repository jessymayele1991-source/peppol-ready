import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma";
import { unauthorized } from "../lib/errors";

/**
 * The only place tenant context is established. It reads the session, confirms
 * the membership still exists, and populates req.auth. Request parameters are
 * never consulted, so no downstream handler can widen its own scope.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const { userId, organizationId } = req.session ?? {};

  if (!userId || !organizationId) {
    next(unauthorized());
    return;
  }

  void prisma.membership
    .findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    })
    .then((membership) => {
      // Revoked while the session was still alive.
      if (!membership) {
        next(unauthorized("Your access to this workspace has ended."));
        return;
      }

      req.auth = { userId, organizationId, role: membership.role };
      next();
    })
    .catch(next);
};
