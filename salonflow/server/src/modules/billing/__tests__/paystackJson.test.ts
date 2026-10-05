import { LosslessNumber } from "lossless-json";
import { parsePaystackJson, PaystackJsonError, PAYSTACK_JSON_LIMIT_BYTES } from "../paystack/paystackJson";
import { paystackTransactionId, paystackResourceId } from "../paystack/paystackIdentity";
import { PaystackAdapter } from "../paystack/paystackAdapter";

const adapter = new PaystackAdapter({ secretKey: "fake-signature-test-only", timeoutMs: 100, planCodes: { STARTER: "PLN_fake", GROWTH: "PLN_fake", PRO: "PLN_fake" } }, { post: jest.fn() });
const ids = ["0", "1", "9007199254740991", "9007199254740992", "9007199254740993", "18446744073709551614", "18446744073709551615"];
const raw = (token: string) => `{"event":"charge.success","data":{"id":${token},"amount":1000000,"currency":"NGN"}}`;
const data = (value: Record<string, unknown>) => value.data as Record<string, unknown>;

describe("Paystack transaction-only uint64 boundary", () => {
  describe.each(["webhook", "verification"] as const)("%s", kind => {
    it.each(ids)("keeps raw numeric token %s exact", id => {
      const parsed = parsePaystackJson(raw(id), kind);
      expect(data(parsed).id).toBe(id);
      if (kind === "webhook") expect(adapter.normalizeWebhookEvent(parsed)?.providerEventId).toBe(`charge.success:${id}`);
    });
    it.each(ids)("keeps decimal string %s exact", id => {
      expect(data(parsePaystackJson(raw(`"${id}"`), kind)).id).toBe(id);
    });
    it.each(["18446744073709551616", '"18446744073709551616"', "-1", "-0", "0.1", "1000.0", "1e3", "1.0e3", "001", '"-0"', '"+1"', '"1e3"', '"1.0"', '" 1"', '"1 "', '""', '"abc"', "null", "{}", "[]"])("rejects invalid token %s", token => {
      expect(() => parsePaystackJson(raw(token), kind)).toThrow(PaystackJsonError);
    });
    it("rejects missing IDs and excessive numeric/string tokens", () => {
      expect(() => parsePaystackJson('{"event":"charge.success","data":{}}', kind)).toThrow(PaystackJsonError);
      expect(() => parsePaystackJson(raw("9".repeat(10000)), kind)).toThrow(PaystackJsonError);
      expect(() => parsePaystackJson(raw(`"${"0".repeat(129)}"`), kind)).toThrow(PaystackJsonError);
    });
  });

  it.each([["000123", "123"], ["0000", "0"], ["123", "123"]])("canonicalizes %s without introducing a second identity", (input, expected) => {
    const parsed = parsePaystackJson(raw(`"${input}"`), "webhook");
    expect(data(parsed).id).toBe(expected);
    expect(adapter.normalizeWebhookEvent(parsed)?.providerEventId).toBe(`charge.success:${expected}`);
  });
  it("keeps adjacent oversized identities distinct", () => {
    const events = ["9007199254740992", "9007199254740993"].map(id => adapter.normalizeWebhookEvent(parsePaystackJson(raw(id), "webhook"))!);
    expect(new Set(events.map(e => e.providerEventId)).size).toBe(2);
  });
  it.each([0, 1, 42, Number.MAX_SAFE_INTEGER])("preserves existing safe direct callers: %s", id => {
    expect(paystackTransactionId(id)).toBe(String(id));
    expect(adapter.normalizeWebhookEvent({ event: "charge.success", data: { id } })?.providerEventId).toBe(`charge.success:${id}`);
  });
  it.each([9007199254740992, -1, -0, 0.5, NaN, Infinity, -Infinity, null, undefined, {}, [], 1n, true])("rejects unsafe/non-ID direct values: %s", id => {
    expect(paystackTransactionId(id)).toBeUndefined();
  });
  it.each(["1\n", "1\r", "1\r\n", "1\u2028", "1\u2029", "1\t", "\t1", "1 ", " 1"])("rejects every trailing/leading whitespace form %j", id => {
    expect(paystackTransactionId(id)).toBeUndefined();
    expect(() => parsePaystackJson(raw(JSON.stringify(id)), "webhook")).toThrow(PaystackJsonError);
  });
  it("does not change the shared resource helper", () => {
    expect(paystackResourceId("000123")).toBeUndefined();
    expect(paystackResourceId(42)).toBe("42");
  });
  it("projects only needed fields and keeps non-transaction numeric behavior", () => {
    const parsed = parsePaystackJson('{"event":"charge.success","data":{"id":9007199254740993,"amount":1000000,"customer":{"id":9007199254740993,"customer_code":"CUS_fake","email":"private"},"plan":{"id":12,"plan_code":"PLN_fake"},"authorization":{"secret":"private"},"metadata":{"checkoutReference":"sf_fake","private":"secret"}}}', "webhook");
    expect(data(parsed)).toEqual({ id: "9007199254740993", amount: 1000000, customer: { id: 9007199254740992, customer_code: "CUS_fake" }, plan: { id: 12, plan_code: "PLN_fake" }, metadata: { checkoutReference: "sf_fake" } });
    expect(JSON.stringify(parsed)).not.toMatch(/private|authorization|LosslessNumber/);
    const inspect = (value: unknown) => {
      expect(typeof value).not.toBe("bigint");
      expect(value).not.toBeInstanceOf(LosslessNumber);
      if (value && typeof value === "object") Object.values(value).forEach(inspect);
    };
    inspect(parsed);
    expect(() => JSON.stringify(adapter.normalizeWebhookEvent(parsed))).not.toThrow();
  });
  it("does not give invoice IDs or nested transaction IDs uint64 semantics", () => {
    const parsed = parsePaystackJson('{"event":"invoice.payment_failed","data":{"id":42,"transaction":{"id":9007199254740993,"reference":"sf_fake"},"amount":1500000}}', "webhook");
    expect(data(parsed)).toEqual({ id: 42, amount: 1500000, transaction: { reference: "sf_fake" } });
    expect(adapter.normalizeWebhookEvent(parsed)?.providerEventId).toBe("invoice.payment_failed:42");
    expect(adapter.normalizeWebhookEvent(parsePaystackJson('{"event":"invoice.payment_failed","data":{"id":9007199254740993}}', "webhook"))).toBeNull();
  });
  it.each([
    '{"event":"charge.success","event":"subscription.create","data":{"id":1}}',
    '{"event":"charge.success","data":{"id":9007199254740992,"id":9007199254740993}}',
    '{"event":"charge.success","data":{"id":1,"\\u0069d":2}}',
    '{"event":"charge.success","data":{"id":1,"customer":{"customer_code":"CUS_a","customer_code":"CUS_b"}}}',
  ])("rejects ambiguous duplicate evidence", text => { expect(() => parsePaystackJson(text, "webhook")).toThrow(PaystackJsonError); });
  it.each(["__proto__", "constructor", "prototype"])("rejects %s-shaped objects without polluting prototypes", key => {
    const before = Object.getPrototypeOf({});
    expect(() => parsePaystackJson(`{"event":"charge.success","data":{"id":1,"${key}":{"polluted":true}}}`, "webhook")).toThrow(PaystackJsonError);
    expect(Object.getPrototypeOf({})).toBe(before);
    expect(({} as any).polluted).toBeUndefined();
  });
  it("never uses inherited provider evidence", () => {
    expect(() => parsePaystackJson('{"__proto__":{"event":"charge.success","data":{"id":1}}}', "webhook")).toThrow(PaystackJsonError);
  });
  it("bounds size/depth and replaces parser errors with a fixed message", () => {
    const values = ["[".repeat(80) + "0" + "]".repeat(80), raw('"' + "0".repeat(PAYSTACK_JSON_LIMIT_BYTES) + '"'), '{"private-token":'];
    for (const value of values) {
      expect(() => parsePaystackJson(value, "webhook")).toThrow("Invalid Paystack JSON payload");
    }
  });
});
