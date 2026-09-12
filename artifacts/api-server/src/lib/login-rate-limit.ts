/**
 * Sign-in protection held in process memory.
 *
 * Limitation, by design for now: state lives in one Node process. It resets on
 * restart or redeploy, and with several instances behind the load balancer each
 * keeps its own counters, so the effective limit is the per-instance limit
 * multiplied by the instance count. Moving to a shared store later only
 * replaces FixedWindowLimiter; the login route does not change.
 */

type Clock = () => number;

type Bucket = { count: number; resetAt: number };

export type LimitResult = { allowed: boolean; retryAfterSeconds: number };

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: Clock;

  constructor(options: {
    limit: number;
    windowMs: number;
    maxKeys?: number;
    now?: Clock;
  }) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys ?? 50_000;
    this.now = options.now ?? Date.now;
  }

  /** Reports whether the key is currently blocked without counting an attempt. */
  peek(key: string): LimitResult {
    const bucket = this.liveBucket(key);
    if (!bucket || bucket.count < this.limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: this.secondsUntil(bucket.resetAt) };
  }

  /** Counts one attempt and reports whether that attempt is within the limit. */
  consume(key: string): LimitResult {
    const now = this.now();
    let bucket = this.liveBucket(key);

    if (!bucket) {
      this.makeRoom();
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count <= this.limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: this.secondsUntil(bucket.resetAt) };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  prune(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  clear(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }

  private liveBucket(key: string): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= this.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  /**
   * Bounds memory. Expired windows go first; if every tracked key is still
   * live, the oldest is evicted. An attacker able to fill the whole table from
   * many addresses could evict a victim's counter — the per-address limit makes
   * that require tens of thousands of attempts.
   */
  private makeRoom(): void {
    if (this.buckets.size < this.maxKeys) return;
    this.prune();
    if (this.buckets.size < this.maxKeys) return;

    const oldest = this.buckets.keys().next();
    if (!oldest.done) this.buckets.delete(oldest.value);
  }

  private secondsUntil(resetAt: number): number {
    return Math.max(1, Math.ceil((resetAt - this.now()) / 1000));
  }
}

/**
 * Caps password verifications in flight. Each scrypt call holds ~64 MB and a
 * libuv threadpool thread for ~300 ms; without a cap a burst of sign-in
 * requests queues unboundedly and stalls every other threadpool user.
 */
export class ConcurrencyGate {
  private inFlight = 0;

  constructor(private readonly max: number) {}

  tryAcquire(): (() => void) | null {
    if (this.inFlight >= this.max) return null;
    this.inFlight += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight -= 1;
    };
  }

  get active(): number {
    return this.inFlight;
  }
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export const LOGIN_LIMITS = {
  /** Failed or invalid attempts from one client address; successes do not count. */
  perClient: 30,
  /** Failed attempts against one email address, from any address. */
  perAccount: 10,
  windowMs: FIFTEEN_MINUTES,
  /** Concurrent password verifications across the whole process. */
  concurrentVerifications: 16,
} as const;

export const loginProtection = {
  client: new FixedWindowLimiter({
    limit: LOGIN_LIMITS.perClient,
    windowMs: LOGIN_LIMITS.windowMs,
  }),
  account: new FixedWindowLimiter({
    limit: LOGIN_LIMITS.perAccount,
    windowMs: LOGIN_LIMITS.windowMs,
  }),
  verifications: new ConcurrencyGate(LOGIN_LIMITS.concurrentVerifications),
};

/** Test hook: counters are process-global. */
export function resetLoginProtection(): void {
  loginProtection.client.clear();
  loginProtection.account.clear();
}

// Expired windows are dropped lazily on access; this sweep bounds memory for
// keys that are never seen again. unref() so it never keeps the process alive.
setInterval(() => {
  loginProtection.client.prune();
  loginProtection.account.prune();
}, 60_000).unref();
