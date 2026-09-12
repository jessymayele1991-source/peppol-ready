const isProduction = process.env["NODE_ENV"] === "production";

const DEVELOPMENT_SECRET = "peppol-ready-development-secret";

/**
 * Production standard for SESSION_SECRET: at least 32 characters, drawn from at
 * least 10 distinct characters, and never the development fallback.
 *
 * The recommended value is 48 random bytes, base64-encoded (64 characters):
 *   openssl rand -base64 48
 *
 * Length alone does not make a secret random, so the distinct-character floor
 * rejects the obvious non-secrets ("aaaa…", "0000…", a repeated short word)
 * without pretending to measure true entropy, which a single value cannot
 * reveal. A hex secret from `openssl rand -hex 32` passes as well.
 */
export const SESSION_SECRET_POLICY = {
  minLength: 32,
  minDistinctCharacters: 10,
} as const;

const HOW_TO_FIX =
  "Generate one with `openssl rand -base64 48` and set it as the SESSION_SECRET secret.";

/**
 * Returns the secret to use, or throws with a message that says what is wrong
 * and how to fix it. Outside production an absent secret falls back to a fixed
 * development value so local sessions survive restarts; a secret that is set is
 * used as given.
 */
export function resolveSessionSecret(
  value: string | undefined,
  production: boolean,
): string {
  if (!production) return value || DEVELOPMENT_SECRET;

  if (!value) {
    throw new Error(
      `SESSION_SECRET environment variable is required in production. ${HOW_TO_FIX}`,
    );
  }

  if (value === DEVELOPMENT_SECRET) {
    throw new Error(
      `SESSION_SECRET is set to the public development value, which must never be used in production. ${HOW_TO_FIX}`,
    );
  }

  if (value.length < SESSION_SECRET_POLICY.minLength) {
    throw new Error(
      `SESSION_SECRET must be at least ${SESSION_SECRET_POLICY.minLength} characters; it is ${value.length}. ${HOW_TO_FIX}`,
    );
  }

  if (new Set(value).size < SESSION_SECRET_POLICY.minDistinctCharacters) {
    throw new Error(
      `SESSION_SECRET uses fewer than ${SESSION_SECRET_POLICY.minDistinctCharacters} distinct characters, so it is not random. ${HOW_TO_FIX}`,
    );
  }

  return value;
}

/**
 * The server's one signing secret. It signs session cookies and keys the
 * pseudonymous account hashes in security logs, so neither can be forged or
 * reversed without it. Rotating it signs every user out and changes those
 * pseudonyms.
 */
export const SESSION_SECRET = resolveSessionSecret(
  process.env["SESSION_SECRET"],
  isProduction,
);
