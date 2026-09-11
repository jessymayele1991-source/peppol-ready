import type { MembershipRole } from "@prisma/client";

declare module "express-session" {
  interface SessionData {
    /** Set at login. Its presence is what makes a session authenticated. */
    userId?: string;
    /** The organization the session is currently acting in. */
    organizationId?: string;
  }
}

declare global {
  namespace Express {
    /**
     * Tenant context, resolved by requireAuth from the session and the
     * matching membership. Request parameters never contribute to it.
     */
    interface AuthContext {
      userId: string;
      organizationId: string;
      role: MembershipRole;
    }

    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
