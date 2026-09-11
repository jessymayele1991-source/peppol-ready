import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * scrypt from node:crypto rather than bcrypt or argon2. Both of those are
 * native modules: the API bundle externalises them, and the workspace excludes
 * non-linux prebuilt binaries, so a native hasher would not run outside the
 * deployment target. scrypt is memory-hard, ships with the runtime, and adds
 * no dependency to a security-critical path.
 */
const ALGORITHM = "scrypt";
const COST = 65536; // N — 2^16
const BLOCK_SIZE = 8; // r
const PARALLELISM = 1; // p
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// 128 * N * r bytes are needed; node's default maxmem sits below that.
const MAX_MEMORY = 128 * COST * BLOCK_SIZE * 2;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });
}

/**
 * Returns `scrypt$N$r$p$salt$hash`, with salt and hash base64-encoded. The
 * parameters travel with the hash so they can be raised later without
 * invalidating existing credentials.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await derive(password, salt);

  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Always compares in constant time, and returns false rather than throwing on
 * a malformed or absent hash, so callers cannot distinguish "no such user"
 * from "wrong password" by timing or by error type.
 */
export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return false;

  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;

  const [, cost, blockSize, parallelism, saltPart, hashPart] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const N = Number(cost);
  const r = Number(blockSize);
  const p = Number(parallelism);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  const salt = Buffer.from(saltPart, "base64");
  const expected = Buffer.from(hashPart, "base64");
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
