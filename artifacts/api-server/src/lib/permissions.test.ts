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

  it("lets a viewer read clients and reports and nothing else", () => {
    expect(capabilitiesForRole(MembershipRole.VIEWER)).toEqual([
      "clients.view",
      "reports.view",
    ]);
  });

  it("lets every role read clients (D1)", () => {
    for (const role of Object.values(MembershipRole)) {
      expect(roleHasCapability(role, "clients.view")).toBe(true);
    }
  });

  it("keeps archiving to owners and admins (D2)", () => {
    expect(roleHasCapability(MembershipRole.OWNER, "clients.archive")).toBe(true);
    expect(roleHasCapability(MembershipRole.ADMIN, "clients.archive")).toBe(true);
    expect(roleHasCapability(MembershipRole.MEMBER, "clients.archive")).toBe(false);
    expect(roleHasCapability(MembershipRole.VIEWER, "clients.archive")).toBe(false);
  });

  it("lets a member create and edit clients without archiving them", () => {
    expect(roleHasCapability(MembershipRole.MEMBER, "clients.write")).toBe(true);
    expect(roleHasCapability(MembershipRole.MEMBER, "clients.archive")).toBe(false);
  });

  it("never lets a viewer write", () => {
    for (const capability of ["clients.write", "clients.archive", "scans.write", "tasks.manage", "reports.generate"] as const) {
      expect(roleHasCapability(MembershipRole.VIEWER, capability)).toBe(false);
    }
  });

  it("returns a copy so a caller cannot mutate the matrix", () => {
    const capabilities = capabilitiesForRole(MembershipRole.VIEWER);
    capabilities.push("workspace.transfer");

    expect(capabilitiesForRole(MembershipRole.VIEWER)).toEqual([
      "clients.view",
      "reports.view",
    ]);
  });

  it("covers every role", () => {
    for (const role of Object.values(MembershipRole)) {
      expect(capabilitiesForRole(role).length).toBeGreaterThan(0);
    }
  });
});
