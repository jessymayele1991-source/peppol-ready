import { MembershipRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  capabilitiesForRole,
  roleHasCapability,
} from "./permissions";

describe("permission matrix", () => {
  it("grants an owner everything", () => {
    expect(capabilitiesForRole(MembershipRole.OWNER)).toEqual([
      ...CAPABILITIES,
    ]);
  });

  it("withholds only workspace transfer from an admin", () => {
    const owner = capabilitiesForRole(MembershipRole.OWNER);
    const admin = capabilitiesForRole(MembershipRole.ADMIN);

    expect(owner.filter((capability) => !admin.includes(capability))).toEqual([
      "workspace.transfer",
    ]);
  });

  it("limits a member to their own audit activity", () => {
    expect(
      roleHasCapability(MembershipRole.MEMBER, "audit.viewOwn"),
    ).toBe(true);
    expect(
      roleHasCapability(MembershipRole.MEMBER, "audit.viewAll"),
    ).toBe(false);
  });

  it("keeps workspace and member administration away from a member", () => {
    expect(
      roleHasCapability(MembershipRole.MEMBER, "workspace.manage"),
    ).toBe(false);
    expect(
      roleHasCapability(MembershipRole.MEMBER, "members.manage"),
    ).toBe(false);
  });

  it("lets a viewer read reports and nothing else", () => {
    expect(capabilitiesForRole(MembershipRole.VIEWER)).toEqual([
      "reports.view",
    ]);
  });

  it("never lets a viewer write", () => {
    for (const capability of ["clients.write", "scans.write", "tasks.manage", "reports.generate"] as const) {
      expect(roleHasCapability(MembershipRole.VIEWER, capability)).toBe(false);
    }
  });

  it("returns a copy so a caller cannot mutate the matrix", () => {
    const capabilities = capabilitiesForRole(MembershipRole.VIEWER);
    capabilities.push("workspace.transfer");

    expect(capabilitiesForRole(MembershipRole.VIEWER)).toEqual([
      "reports.view",
    ]);
  });

  it("covers every role", () => {
    for (const role of Object.values(MembershipRole)) {
      expect(capabilitiesForRole(role).length).toBeGreaterThan(0);
    }
  });
});
