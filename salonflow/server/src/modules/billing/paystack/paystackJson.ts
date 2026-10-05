import { LosslessNumber, parse } from "lossless-json";
import { paystackTransactionId } from "./paystackIdentity";

export const PAYSTACK_JSON_LIMIT_BYTES = 100 * 1024;
const MAX_DEPTH = 64;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Never retain the original parser exception: its message may contain payload data. */
export class PaystackJsonError extends Error {
  constructor() { super("Invalid Paystack JSON payload"); this.name = "PaystackJsonError"; }
}
function invalid(): never { throw new PaystackJsonError(); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  return value as Record<string, unknown>;
}
function field(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!own(descriptor, "value")) invalid();
  return descriptor.value;
}

/** Exact parser wrapper contract: neither inherited markers nor instanceof suffice. */
function losslessToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== LosslessNumber.prototype) return undefined;
  const token = Object.getOwnPropertyDescriptor(value, "value");
  const marker = Object.getOwnPropertyDescriptor(value, "isLosslessNumber");
  if (!token || !marker || !own(token, "value") || !own(marker, "value")) return undefined;
  return typeof token.value === "string" && marker.value === true ? token.value : undefined;
}

/** Check the entire untrusted tree before reading any identity, including discarded fields. */
function validateStructure(value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (losslessToken(value) !== undefined) return;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) invalid();
    for (let index = 0; index < value.length; index++) {
      if (!own(value, String(index))) invalid();
      validateStructure(field(value, String(index)), depth + 1);
    }
    return;
  }
  const source = record(value);
  for (const key of Object.keys(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") invalid();
    validateStructure(field(source, key), depth + 1);
  }
}

/** Wrappers are private to this boundary. Non-target numbers keep JSON.parse semantics. */
function plain(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) invalid();
  const token = losslessToken(value);
  if (token !== undefined) return Number(token);
  if (Array.isArray(value)) return value.map(item => plain(item, depth + 1));
  if (value && typeof value === "object") {
    const source = record(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") invalid();
      result[key] = plain(field(source, key), depth + 1);
    }
    return result;
  }
  return value;
}

function pick(source: Record<string, unknown>, names: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of names) if (own(source, key)) result[key] = field(source, key);
  return result;
}
function nested(source: Record<string, unknown>, target: Record<string, unknown>, key: string, names: string[]) {
  const value = field(source, key);
  if (value && typeof value === "object" && !Array.isArray(value)) target[key] = pick(record(value), names);
  else if (own(source, key)) target[key] = value;
}

/** Only charge.success.data.id or verification data.id acquires uint64 semantics. */
export function parsePaystackJson(text: string, kind: "webhook" | "verification"): Record<string, unknown> {
  try {
    if (Buffer.byteLength(text, "utf8") > PAYSTACK_JSON_LIMIT_BYTES) invalid();
    // Conflicting duplicates fail; identical duplicates still undergo structural validation.
    const untrusted = parse(text, undefined, { onDuplicateKey: () => invalid() });
    validateStructure(untrusted);
    const parsed = record(untrusted);
    const isTransaction = kind === "verification" || field(parsed, "event") === "charge.success";
    let transactionId: string | undefined;
    if (isTransaction) {
      const rawData = record(field(parsed, "data"));
      const rawId = field(rawData, "id");
      transactionId = paystackTransactionId(losslessToken(rawId) ?? rawId);
      if (transactionId === undefined) invalid();
      // Replace only this private parser node before ordinary-number projection.
      // The targeted token never goes through Number(), even temporarily.
      rawData.id = transactionId;
    }
    const root = record(plain(parsed));
    const source = record(field(root, "data"));
    const data = pick(source, kind === "verification"
      ? ["reference", "amount", "currency", "status", "paid_at", "domain", "integration"]
      : ["id", "reference", "paid_at", "next_payment_date", "amount", "currency", "subscription_code", "email_token"]);
    if (isTransaction) data.id = transactionId;
    nested(source, data, "customer", kind === "verification" ? ["customer_code"] : ["id", "customer_code"]);
    nested(source, data, "plan", ["id", "plan_code"]);
    if (kind === "verification") nested(source, data, "plan_object", ["id", "plan_code"]);
    else {
      nested(source, data, "subscription", ["subscription_code", "email_token"]);
      nested(source, data, "transaction", ["reference"]);
      nested(source, data, "metadata", ["checkoutReference"]);
    }
    return kind === "verification" ? { status: field(root, "status"), data } : { event: field(root, "event"), data };
  } catch { throw new PaystackJsonError(); }
}
