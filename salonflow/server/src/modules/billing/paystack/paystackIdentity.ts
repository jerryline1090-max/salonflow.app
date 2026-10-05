/** JSON numbers outside the safe range may already be rounded. Never use them
 * as billing evidence. Exact decimal strings support Paystack's uint64 IDs. */
export function paystackResourceId(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  }
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || value.length > 20) return undefined;
  return BigInt(value) <= 18446744073709551615n ? value : undefined;
}

// Permit limited padding for string compatibility, without feeding unbounded
// attacker-controlled digits to BigInt. Other provider resource IDs are unchanged.
export const MAX_TRANSACTION_ID_TOKEN_LENGTH = 128;
export function paystackTransactionId(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) ? String(value) : undefined;
  }
  if (typeof value !== "string" || !value.length || value.length > MAX_TRANSACTION_ID_TOKEN_LENGTH || /[^0-9]/.test(value)) return undefined;
  const canonical = value.replace(/^0+/, "") || "0";
  if (canonical.length > 20) return undefined;
  return BigInt(canonical) <= 18446744073709551615n ? canonical : undefined;
}
