import { MembershipRole } from "@prisma/client";

/**
 * The capability set from docs/peppol-ready-architecture.md, with every
 * "Beperkt" cell split into two boolean rights. "Beperkt" is not a third
 * state: it is shorthand for holding one of a pair of rights but not the
 * other. Admin may configure the workspace but not transfer or delete it; a
 * member sees their own audit activity but not the whole firm's.
 *
 * This module is the single source: `requireCapability` enforces it on the
 * server and `capabilitiesForRole` ships the same derivation to the client in
 * the session, so what the interface hides is exactly what the API refuses.
 */
export const CAPABILITIES = [
  "workspace.manage",
  "workspace.transfer",
  "members.manage",
  // Reading clients, including the readiness dashboard built from them.
  "clients.view",
  "clients.write",
  // Archiving stops monitoring a client for the whole firm, so it is kept to
  // the roles that manage the workspace.
  "clients.archive",
  "scans.write",
  "tasks.manage",
  "reports.generate",
  "reports.view",
  "audit.viewAll",
  "audit.viewOwn",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<MembershipRole, readonly Capability[]> = {
  [MembershipRole.OWNER]: CAPABILITIES,
  [MembershipRole.ADMIN]: [
    "workspace.manage",
    "members.manage",
    "clients.view",
    "clients.write",
    "clients.archive",
    "scans.write",
    "tasks.manage",
    "reports.generate",
    "reports.view",
    "audit.viewAll",
    "audit.viewOwn",
  ],
  [MembershipRole.MEMBER]: [
    "clients.view",
    "clients.write",
    "scans.write",
    "tasks.manage",
    "reports.generate",
    "reports.view",
    "audit.viewOwn",
  ],
  [MembershipRole.VIEWER]: ["clients.view", "reports.view"],
};

export function capabilitiesForRole(role: MembershipRole): Capability[] {
  return [...ROLE_CAPABILITIES[role]];
}

export function roleHasCapability(
  role: MembershipRole,
  capability: Capability,
): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
