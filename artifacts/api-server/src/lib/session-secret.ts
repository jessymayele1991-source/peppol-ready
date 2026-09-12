const isProduction = process.env["NODE_ENV"] === "production";

function resolveSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (secret) return secret;

  if (isProduction) {
    throw new Error(
      "SESSION_SECRET environment variable is required in production.",
    );
  }

  // Development only: a fixed value keeps sessions alive across restarts.
  return "peppol-ready-development-secret";
}

/**
 * The server's one signing secret. It signs session cookies and keys the
 * pseudonymous account hashes in security logs, so neither can be forged or
 * reversed without it.
 */
export const SESSION_SECRET = resolveSecret();
