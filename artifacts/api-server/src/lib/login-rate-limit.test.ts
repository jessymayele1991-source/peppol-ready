import { describe, expect, it } from "vitest";
import { ConcurrencyGate, FixedWindowLimiter } from "./login-rate-limit";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("FixedWindowLimiter", () => {
  it("allows attempts up to the limit and refuses the next", () => {
    const time = clock();
    const limiter = new FixedWindowLimiter({ limit: 3, windowMs: 60_000, now: time.now });

    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a")).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("reports the seconds left in the window, rounded up and never zero", () => {
    const time = clock();
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000, now: time.now });

    limiter.consume("a");
    time.advance(59_500);

    expect(limiter.consume("a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("opens again once the window has passed", () => {
    const time = clock();
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000, now: time.now });

    limiter.consume("a");
    expect(limiter.peek("a").allowed).toBe(false);

    time.advance(60_000);
    expect(limiter.peek("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("peek never counts an attempt", () => {
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000 });

    for (let i = 0; i < 5; i += 1) limiter.peek("a");

    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("keeps keys independent", () => {
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000 });

    limiter.consume("a");

    expect(limiter.consume("a").allowed).toBe(false);
    expect(limiter.consume("b").allowed).toBe(true);
  });

  it("forgets a key on reset", () => {
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000 });

    limiter.consume("a");
    limiter.reset("a");

    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("never tracks more keys than its bound", () => {
    const limiter = new FixedWindowLimiter({ limit: 5, windowMs: 60_000, maxKeys: 100 });

    for (let i = 0; i < 1_000; i += 1) limiter.consume(`key-${i}`);

    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  it("drops expired windows before evicting live ones", () => {
    const time = clock();
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2, now: time.now });

    limiter.consume("old");
    time.advance(60_000);
    limiter.consume("live");
    limiter.consume("live");
    limiter.consume("new");

    expect(limiter.peek("live").allowed).toBe(false);
  });
});

describe("ConcurrencyGate", () => {
  it("refuses once the cap is reached and admits again after a release", () => {
    const gate = new ConcurrencyGate(2);

    const first = gate.tryAcquire();
    const second = gate.tryAcquire();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();

    first?.();
    expect(gate.tryAcquire()).not.toBeNull();
  });

  it("ignores a second release of the same slot", () => {
    const gate = new ConcurrencyGate(1);

    const release = gate.tryAcquire();
    release?.();
    release?.();

    expect(gate.active).toBe(0);
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
  });
});
