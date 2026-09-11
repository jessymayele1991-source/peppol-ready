import { describe, expect, it } from "vitest";
import { calculateReadiness, type ReadinessInput } from "./readiness-engine";

const allFailing: ReadinessInput = {
  participantRegistered: false,
  receivingAddressConfigured: false,
  peppolCapableSoftware: false,
  certificateValid: false,
  successfulTestInvoice: false,
};

const allPassing: ReadinessInput = {
  participantRegistered: true,
  receivingAddressConfigured: true,
  peppolCapableSoftware: true,
  certificateValid: true,
  successfulTestInvoice: true,
};

describe("calculateReadiness", () => {
  it("awards nothing when no factor passes", () => {
    const assessment = calculateReadiness(allFailing);

    expect(assessment.score).toBe(0);
    expect(assessment.status).toBe("NOT_REGISTERED");
    expect(assessment.riskLevel).toBe("critical");
    expect(assessment.risks).toHaveLength(5);
  });

  it("awards a full score with no risks when every factor passes", () => {
    const assessment = calculateReadiness(allPassing);

    expect(assessment.score).toBe(100);
    expect(assessment.status).toBe("READY");
    expect(assessment.riskLevel).toBe("info");
    expect(assessment.risks).toEqual([]);
  });

  it("sums the factor weights to exactly 100", () => {
    const total = calculateReadiness(allPassing).factors.reduce(
      (sum, factor) => sum + factor.weight,
      0,
    );

    expect(total).toBe(100);
  });

  it("reports NOT_REGISTERED regardless of the other factors", () => {
    const assessment = calculateReadiness({
      ...allPassing,
      participantRegistered: false,
    });

    expect(assessment.score).toBe(70);
    expect(assessment.status).toBe("NOT_REGISTERED");
  });

  it("reports CONFIGURING when only non-critical factors are missing", () => {
    const assessment = calculateReadiness({
      ...allPassing,
      successfulTestInvoice: false,
    });

    expect(assessment.score).toBe(85);
    expect(assessment.status).toBe("CONFIGURING");
    expect(assessment.riskLevel).toBe("warning");
  });

  it("reports AT_RISK when a critical factor is missing", () => {
    const assessment = calculateReadiness({
      ...allPassing,
      certificateValid: false,
    });

    expect(assessment.score).toBe(85);
    expect(assessment.status).toBe("AT_RISK");
    expect(assessment.riskLevel).toBe("critical");
  });

  it("pairs every failed factor with an explainable remediation", () => {
    for (const risk of calculateReadiness(allFailing).risks) {
      expect(risk.remediation.length).toBeGreaterThan(0);
      expect(risk.message.length).toBeGreaterThan(0);
    }
  });
});
