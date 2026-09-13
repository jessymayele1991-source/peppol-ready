import { describe, expect, it } from "vitest";
import { escapeLike, normalizeIdentifier } from "./company-service";

describe("escapeLike", () => {
  it.each([
    ["%", "\\%"],
    ["a_b", "a\\_b"],
    ["back\\slash", "back\\\\slash"],
    ["gewoon", "gewoon"],
  ])("escapes %j as %j", (input, escaped) => {
    expect(escapeLike(input)).toBe(escaped);
  });
});

describe("normalizeIdentifier (D3)", () => {
  it.each([
    ["BE 0123.456.789", "BE0123456789"],
    ["be0123456789", "BE0123456789"],
    ["  nl 1234.56.789 b01 ", "NL123456789B01"],
    ["12345678", "12345678"],
    ["BE\t0123\n456", "BE0123456"],
  ])("stores %j as %j", (input, stored) => {
    expect(normalizeIdentifier(input)).toBe(stored);
  });

  it("treats spacing and dots as the same number, so duplicates cannot hide behind formatting", () => {
    expect(normalizeIdentifier("BE 0123.456.789")).toBe(normalizeIdentifier("be0123456789"));
  });

  it("keeps characters other than whitespace and dots, as specified", () => {
    expect(normalizeIdentifier("BE-0123/456")).toBe("BE-0123/456");
  });

  it("reduces an input of only spacing and dots to empty, which the service stores as null", () => {
    expect(normalizeIdentifier(" . . ")).toBe("");
  });
});
