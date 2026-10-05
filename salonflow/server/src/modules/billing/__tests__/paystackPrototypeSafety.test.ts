import { LosslessNumber, parse } from "lossless-json";
import { PaystackAdapter } from "../paystack/paystackAdapter";
import { parsePaystackJson, PaystackJsonError } from "../paystack/paystackJson";

const own = (value: unknown, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const adapter = new PaystackAdapter({ secretKey: "fake-prototype-test-only", timeoutMs: 100,
  planCodes: { STARTER: "PLN_fake", GROWTH: "PLN_fake", PRO: "PLN_fake" } }, { post: jest.fn() });
const wrap = (data: string, root = "") => `{"event":"charge.success","status":true,"data":${data}${root ? "," + root : ""}}`;
const idObject = (id: string) => wrap(`{"id":${id},"amount":1000000,"currency":"NGN"}`);
const originalExploit = idObject('{"__proto__":9007199254740993}');
const evidence = '{"polluted":true,"id":"9007199254740993","transactionId":"9007199254740993",' +
  '"providerEventId":"charge.success:9007199254740993","amount":1000000,"currency":"NGN","status":"success",' +
  '"customer_code":"CUS_fake","plan_code":"PLN_fake","subscription_code":"SUB_fake"}';

beforeEach(() => { expect(({} as { polluted?: unknown }).polluted).toBeUndefined(); });
afterEach(() => {
  expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  jest.restoreAllMocks();
});

describe.each(["webhook", "verification"] as const)("Paystack %s prototype boundary", kind => {
  function rejects(text: string) {
    const normalize = jest.fn((payload: unknown) => adapter.normalizeWebhookEvent(payload));
    let projected: unknown;
    expect(() => {
      projected = parsePaystackJson(text, kind);
      normalize(projected);
    }).toThrow(new PaystackJsonError());
    expect(projected).toBeUndefined();
    expect(normalize).not.toHaveBeenCalled(); // No provider identity or other evidence reaches normalization.
  }

  it("rejects the original numeric __proto__ transaction-ID exploit", () => rejects(originalExploit));

  it.each([
    ["both wrapper fields inherited", '{"__proto__":{"value":"9007199254740993","isLosslessNumber":true}}'],
    ["value inherited", '{"isLosslessNumber":true,"__proto__":{"value":"9007199254740993"}}'],
    ["marker inherited", '{"value":"9007199254740993","__proto__":{"isLosslessNumber":true}}'],
    ["ordinary wrapper lookalike", '{"isLosslessNumber":true,"value":"9007199254740993"}'],
    ["own fields on an inherited real wrapper", '{"__proto__":1,"isLosslessNumber":true,"value":"9007199254740993"}'],
  ])("rejects %s as transaction identity", (_name, value) => rejects(idObject(value)));

  it("requires data.id itself to be an own property", () => rejects(wrap(`{"__proto__":${evidence}}`)));

  const locations: [string, (properties: string) => string][] = [
    ["root", properties => wrap('{"id":1}', properties)],
    ["data", properties => wrap(`{"id":1,${properties}}`)],
    ["data.id", properties => idObject(`{${properties}}`)],
    ["data.customer", properties => wrap(`{"id":1,"customer":{${properties}}}`)],
    ["data.plan", properties => wrap(`{"id":1,"plan":{${properties}}}`)],
    ["discarded array entry", properties => wrap(`{"id":1,"unused":[null,[{${properties}}]]}`)],
  ];
  describe.each(locations)("under %s", (_name, locate) => {
    it.each(["__proto__", "constructor", "prototype"])("rejects own/prototype-shaped %s evidence", key => {
      const value = key === "constructor" ? `{"prototype":${evidence}}` : evidence;
      rejects(locate(`"${key}":${value}`));
    });
    it.each(["__proto__", "constructor", "prototype"])("rejects identical duplicate %s constructions", key => {
      const value = key === "constructor" ? `{"prototype":${evidence}}` : evidence;
      rejects(locate(`"${key}":${value},"${key}":${value}`));
    });
    it("rejects an inherited genuine numeric wrapper before projection", () => rejects(locate('"__proto__":9007199254740993')));
    it("rejects identical duplicate numeric prototype assignments", () => rejects(locate('"__proto__":9007199254740993,"__proto__":9007199254740993')));
  });

  it.each(["amount", "currency", "status", "customer", "plan", "subscription"])("does not derive %s from an inherited numeric wrapper", key => {
    rejects(wrap(`{"id":1,"${key}":{"__proto__":1000000}}`));
  });

  it.each(["9007199254740992", "9007199254740993", "18446744073709551614", "18446744073709551615"])("still accepts genuine raw uint64 %s", id => {
    const projected = parsePaystackJson(idObject(id), kind);
    expect((projected.data as Record<string, unknown>).id).toBe(id);
    if (kind === "webhook") expect(adapter.normalizeWebhookEvent(projected)?.providerEventId).toBe(`charge.success:${id}`);
  });

  it.each(["1", "9007199254740993", "18446744073709551615"])("identical duplicate ID %s has the same canonical evidence", id => {
    const ordinary = parsePaystackJson(wrap(`{"id":${id},"amount":1000000}`), kind);
    const duplicate = parsePaystackJson(wrap(`{"id":${id},"id":${id},"amount":1000000}`), kind);
    expect(duplicate).toEqual(ordinary);
    if (kind === "webhook") expect(adapter.normalizeWebhookEvent(duplicate)).toEqual(adapter.normalizeWebhookEvent(ordinary));
  });

  it.each([
    wrap('{"id":1}', '"unrelated":1,"unrelated":2'),
    wrap('{"id":1,"id":2}'),
    wrap('{"id":"9007199254740992","id":"9007199254740993"}'),
    wrap('{"id":1,"a":{"x":1,"x":2}}'),
  ])("keeps conflicting duplicates rejected", text => rejects(text));

  it("returns only allowlisted plain objects with no wrappers, BigInt or unexpected prototypes", () => {
    const projected = parsePaystackJson(wrap('{"id":9007199254740993,"amount":1000000,"currency":"NGN",' +
      '"status":"success","customer":{"id":42,"customer_code":"CUS_fake","email":"private@example.invalid"},' +
      '"plan":{"id":7,"plan_code":"PLN_fake"},"unused":[null,true,"text",1,{"safe":false}],"authorization":{"secret":"fake-private"}}'), kind);
    const inspect = (value: unknown): void => {
      expect(typeof value).not.toBe("bigint");
      expect(value).not.toBeInstanceOf(LosslessNumber);
      if (value && typeof value === "object") {
        expect(Object.getPrototypeOf(value)).toBe(Array.isArray(value) ? Array.prototype : Object.prototype);
        for (const key of Object.keys(value)) {
          expect(["__proto__", "constructor", "prototype", "polluted", "unused", "authorization", "email"]).not.toContain(key);
          inspect(Object.getOwnPropertyDescriptor(value, key)!.value);
        }
      }
    };
    inspect(projected);
    expect((projected.data as Record<string, unknown>).amount).toBe(1000000);
    expect(JSON.stringify(projected)).not.toMatch(/fake-private|private@example/);
  });

  it("does not expose structural-error contents or log attacker evidence", () => {
    const logs = ["log", "warn", "error"].map(method => jest.spyOn(console, method as "log").mockImplementation(() => {}));
    let failure: unknown;
    try { parsePaystackJson(originalExploit, kind); } catch (error) { failure = error; }
    expect(failure).toEqual(new PaystackJsonError());
    expect(String(failure)).toBe("PaystackJsonError: Invalid Paystack JSON payload");
    expect(JSON.stringify(failure)).not.toMatch(/9007199254740993|__proto__|value|amount/);
    logs.forEach(log => expect(log).not.toHaveBeenCalled());
  });
});

it("distinguishes genuine parser wrappers from inherited wrappers and plain lookalikes", () => {
  const real = parse("9007199254740993");
  expect(Object.getPrototypeOf(real)).toBe(LosslessNumber.prototype);
  expect(own(real, "value")).toBe(true);
  expect(own(real, "isLosslessNumber")).toBe(true);
  expect(Object.getOwnPropertyDescriptor(real, "value")?.value).toBe("9007199254740993");
  expect(Object.getOwnPropertyDescriptor(real, "isLosslessNumber")?.value).toBe(true);

  // The library's ordinary __proto__ assignment makes instanceof insufficient.
  const malicious = (parse(originalExploit) as { data: { id: unknown } }).data.id;
  expect(malicious).toBeInstanceOf(LosslessNumber);
  expect(Object.getPrototypeOf(malicious)).not.toBe(LosslessNumber.prototype);
  expect(own(malicious, "value")).toBe(false);
  expect(own(malicious, "isLosslessNumber")).toBe(false);
  const lookalike = parse('{"value":"9007199254740993","isLosslessNumber":true}');
  expect(own(lookalike, "value")).toBe(true);
  expect(own(lookalike, "isLosslessNumber")).toBe(true);
  expect(Object.getPrototypeOf(lookalike)).toBe(Object.prototype);
});
