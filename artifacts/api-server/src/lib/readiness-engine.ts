export type PeppolReadinessStatus =
  | "READY"
  | "CONFIGURING"
  | "AT_RISK"
  | "NOT_REGISTERED";

export type RiskSeverity = "info" | "warning" | "critical";

export type ReadinessInput = {
  participantRegistered: boolean;
  receivingAddressConfigured: boolean;
  peppolCapableSoftware: boolean;
  certificateValid: boolean;
  successfulTestInvoice: boolean;
};

export type ReadinessFactor = {
  key: keyof ReadinessInput;
  label: string;
  weight: number;
  passed: boolean;
  earnedPoints: number;
  message: string;
};

export type RiskIndicator = {
  code: string;
  label: string;
  severity: RiskSeverity;
  message: string;
  remediation: string;
};

export type ReadinessAssessment = {
  score: number;
  status: PeppolReadinessStatus;
  riskLevel: RiskSeverity;
  factors: ReadinessFactor[];
  risks: RiskIndicator[];
};

const factorDefinitions: Array<{
  key: keyof ReadinessInput;
  label: string;
  weight: number;
  passMessage: string;
  failMessage: string;
  risk: RiskIndicator;
}> = [
  {
    key: "participantRegistered",
    label: "Peppol participant registration",
    weight: 30,
    passMessage: "The company is registered in the Peppol network.",
    failMessage: "No active Peppol participant registration was confirmed.",
    risk: {
      code: "NOT_REGISTERED",
      label: "Not registered",
      severity: "critical",
      message: "The company cannot exchange Peppol documents without registration.",
      remediation: "Register the company with a certified Peppol access point.",
    },
  },
  {
    key: "receivingAddressConfigured",
    label: "Receiving address",
    weight: 20,
    passMessage: "A valid Peppol receiving address is configured.",
    failMessage: "The receiving address is missing or could not be verified.",
    risk: {
      code: "MISSING_RECEIVING_ADDRESS",
      label: "Missing receiving address",
      severity: "critical",
      message: "Inbound Peppol documents cannot be routed to this company.",
      remediation: "Configure and verify the participant receiving endpoint.",
    },
  },
  {
    key: "peppolCapableSoftware",
    label: "Peppol-capable accounting software",
    weight: 20,
    passMessage: "The accounting software supports the required Peppol flow.",
    failMessage: "No Peppol-capable accounting software was confirmed.",
    risk: {
      code: "SOFTWARE_NOT_READY",
      label: "Software not ready",
      severity: "warning",
      message: "The current accounting workflow cannot reliably exchange Peppol documents.",
      remediation: "Enable a supported connector or move the workflow to Peppol-ready software.",
    },
  },
  {
    key: "certificateValid",
    label: "Access point certificate",
    weight: 15,
    passMessage: "The access point certificate is valid.",
    failMessage: "The access point certificate is missing, expired, or invalid.",
    risk: {
      code: "INVALID_CERTIFICATE",
      label: "Certificate invalid",
      severity: "critical",
      message: "Document exchange may be rejected because trust cannot be established.",
      remediation: "Renew and validate the access point certificate.",
    },
  },
  {
    key: "successfulTestInvoice",
    label: "Successful test invoice",
    weight: 15,
    passMessage: "A complete test invoice flow has succeeded.",
    failMessage: "No successful end-to-end test invoice was recorded.",
    risk: {
      code: "TEST_INVOICE_MISSING",
      label: "Validation needs review",
      severity: "warning",
      message: "Readiness is not proven until an end-to-end document exchange succeeds.",
      remediation: "Send and validate a Peppol test invoice.",
    },
  },
];

export function calculateReadiness(input: ReadinessInput): ReadinessAssessment {
  const factors = factorDefinitions.map((definition): ReadinessFactor => {
    const passed = input[definition.key];
    return {
      key: definition.key,
      label: definition.label,
      weight: definition.weight,
      passed,
      earnedPoints: passed ? definition.weight : 0,
      message: passed ? definition.passMessage : definition.failMessage,
    };
  });

  const score = factors.reduce((total, factor) => total + factor.earnedPoints, 0);
  const risks = factorDefinitions
    .filter((definition) => !input[definition.key])
    .map((definition) => definition.risk);

  const hasCriticalRisk = risks.some((risk) => risk.severity === "critical");
  const status: PeppolReadinessStatus = !input.participantRegistered
    ? "NOT_REGISTERED"
    : score === 100
      ? "READY"
      : hasCriticalRisk || score < 60
        ? "AT_RISK"
        : "CONFIGURING";

  return {
    score,
    status,
    riskLevel: hasCriticalRisk
      ? "critical"
      : risks.length > 0
        ? "warning"
        : "info",
    factors,
    risks,
  };
}