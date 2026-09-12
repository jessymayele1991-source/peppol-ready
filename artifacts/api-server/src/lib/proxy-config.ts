/**
 * How many reverse proxies sit between the client and this server.
 *
 * Express reads it to pick the client address out of X-Forwarded-For. It must
 * match reality exactly: one too many and a client can forge its address to
 * escape the per-address sign-in limit; one too few and every client shares a
 * proxy's address, turning that limit into a single counter for all users.
 *
 * Defaults to 1. Set TRUST_PROXY_HOPS once the real chain on the deployment
 * platform has been measured (enable LOG_PROXY_CHAIN to see it).
 */
export const DEFAULT_TRUST_PROXY_HOPS = 1;
const MAX_TRUST_PROXY_HOPS = 5;

export function resolveTrustProxyHops(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_TRUST_PROXY_HOPS;

  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 0 || hops > MAX_TRUST_PROXY_HOPS) {
    throw new Error(
      `TRUST_PROXY_HOPS must be a whole number from 0 to ${MAX_TRUST_PROXY_HOPS}; got "${value}".`,
    );
  }
  return hops;
}

export const TRUST_PROXY_HOPS = resolveTrustProxyHops(process.env["TRUST_PROXY_HOPS"]);

/**
 * Off by default. When "true", every request log line also carries the raw
 * X-Forwarded-For header and what Express derived from it, so the proxy chain
 * can be measured on a real deployment without a code change. Client addresses
 * are personal data: switch it off again after measuring.
 */
export const LOG_PROXY_CHAIN = process.env["LOG_PROXY_CHAIN"] === "true";
