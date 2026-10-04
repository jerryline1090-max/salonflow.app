/** JSON numbers outside the safe range may already be rounded. Never use them
 * as billing evidence. Exact decimal strings support Paystack's uint64 IDs. */
export function paystackResourceId(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  }
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || value.length > 20) return undefined;
  return BigInt(value) <= 18446744073709551615n ? value : undefined;
}
