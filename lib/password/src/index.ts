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

type ParsedHash = {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  expected: Buffer;
};

function parseHash(storedHash: string | null | undefined): ParsedHash | null {
  if (!storedHash) return null;

  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return null;

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
    return null;
  }

  const salt = Buffer.from(saltPart, "base64");
  const expected = Buffer.from(hashPart, "base64");
  if (salt.length === 0 || expected.length === 0) return null;

  return { N, r, p, salt, expected };
}

/**
 * Stand-in used whenever there is no usable stored hash: an unknown account,
 * an account without a password, or a malformed value. It carries the current
 * cost parameters and key length, so verifying against it performs exactly
 * the work a real verification does. Its expected bytes are random and never
 * derived from any password, so it cannot match.
 */
const DUMMY_HASH: ParsedHash = {
  N: COST,
  r: BLOCK_SIZE,
  p: PARALLELISM,
  salt: randomBytes(SALT_LENGTH),
  expected: randomBytes(KEY_LENGTH),
};

/**
 * Runs the full scrypt derivation on every call, including when the stored
 * hash is absent or malformed, so the response time does not reveal whether
 * an account exists. Returns false rather than throwing for unusable hashes.
 */
export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  const parsed = parseHash(storedHash);
  const target = parsed ?? DUMMY_HASH;

  const actual = await scryptAsync(
    password.normalize("NFKC"),
    target.salt,
    target.expected.length,
    { N: target.N, r: target.r, p: target.p, maxmem: 128 * target.N * target.r * 2 },
  );

  const matches =
    actual.length === target.expected.length &&
    timingSafeEqual(actual, target.expected);

  // The dummy never authenticates, even in the astronomically unlikely case
  // its random bytes collide with a derived key.
  return parsed !== null && matches;
}
