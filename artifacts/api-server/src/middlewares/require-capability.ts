import type { RequestHandler } from "express";
import { forbidden, unauthorized } from "../lib/errors";
import { roleHasCapability, type Capability } from "../lib/permissions";

/**
 * Gates a route on a capability rather than on a role, so routes never restate
 * the permission matrix. Mount after requireAuth.
 */
export function requireCapability(capability: Capability): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }

    if (!roleHasCapability(req.auth.role, capability)) {
      next(forbidden());
      return;
    }

    next();
  };
}
