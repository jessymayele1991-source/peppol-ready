import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateReadiness, type ReadinessInput } from "./readiness-engine";

/**
 * The interface translates a readiness assessment by key and by risk code, so a
 * factor or a risk the locale files do not know shows the raw key to the user.
 * These compare what the engine can produce against what the four locales
 * actually carry. The engine is the source; the locales must follow it.
 */
const localesDir = join(import.meta.dirname, "../../../peppol-flow/src/locales");

type Messages = Record<string, unknown>;

const locales = readdirSync(localesDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => ({
    code: file.replace(/\.json$/, ""),
    messages: JSON.parse(readFileSync(join(localesDir, file), "utf8")) as Messages,
  }));

function message(messages: Messages, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (current, segment) =>
        typeof current === "object" && current !== null
          ? (current as Record<string, unknown>)[segment]
          : undefined,
      messages,
    );
}

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    keysOf(nested, prefix ? `${prefix}.${key}` : key),
  );
}

const allFailing: ReadinessInput = {
  participantRegistered: false,
  receivingAddressConfigured: false,
  peppolCapableSoftware: false,
  certificateValid: false,
  successfulTestInvoice: false,
};

/** Every risk the engine can raise, plus the three the service adds at read time. */
const RISK_CODES = [
  ...calculateReadiness(allFailing).risks.map((risk) => risk.code),
  "ASSESSMENT_MISSING",
  "ASSESSMENT_STALE",
  "OPEN_CRITICAL_INCIDENT",
];

describe("readiness translations", () => {
  it("ships four locales", () => {
    expect(locales.map((locale) => locale.code).sort()).toEqual(["de", "en", "fr", "nl"]);
  });

  it.each(locales.map((locale) => [locale.code, locale] as const))(
    "%s asks every assessment question",
    (_code, locale) => {
      for (const key of Object.keys(allFailing)) {
        expect(message(locale.messages, `clients.readiness.questions.${key}.label`)).toBeTypeOf("string");
        expect(message(locale.messages, `clients.readiness.questions.${key}.hint`)).toBeTypeOf("string");
      }
    },
  );

  it.each(locales.map((locale) => [locale.code, locale] as const))(
    "%s names and remediates every risk the engine can raise",
    (_code, locale) => {
      for (const code of RISK_CODES) {
        expect(message(locale.messages, `risk.${code}`), `risk.${code}`).toBeTypeOf("string");
        expect(message(locale.messages, `riskRemediation.${code}`), `riskRemediation.${code}`).toBeTypeOf("string");
      }
    },
  );

  it("carries the same keys in every locale", () => {
    const [reference, ...others] = locales;
    const expected = keysOf(reference?.messages).sort();
    for (const locale of others) {
      expect(keysOf(locale.messages).sort(), locale.code).toEqual(expected);
    }
  });

  it("leaves no translation empty", () => {
    for (const locale of locales) {
      const blank = keysOf(locale.messages).filter(
        (key) => String(message(locale.messages, key)).trim() === "",
      );
      expect(blank, locale.code).toEqual([]);
    }
  });
});
