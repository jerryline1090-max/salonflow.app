type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Per-business + actor fixed-window guard. This intentionally protects one
 * tenant from exhausting shared AI capacity; replace the in-memory store with
 * Redis in multi-instance production deployments. */
export function checkAiRateLimit(scope: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const current = buckets.get(scope);
  if (!current || current.resetAt <= now) {
    buckets.set(scope, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
