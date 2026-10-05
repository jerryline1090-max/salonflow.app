import { ReadableStream } from "stream/web";
import { FetchPaystackHttpClient } from "../paystack/paystackProviderFactory";
import { PaystackAdapter } from "../paystack/paystackAdapter";
import { parsePaystackJson, PAYSTACK_JSON_LIMIT_BYTES } from "../paystack/paystackJson";

const config = { secretKey: "sk_test_fake_mock_only", timeoutMs: 1000, planCodes: { STARTER: "PLN_fake", GROWTH: "PLN_fake", PRO: "PLN_fake" } };
const input = { reference: "sf_fake", amount: 1000000, currency: "NGN", providerCustomerId: "CUS_fake", providerPlanCode: "PLN_fake" };
const text = (id: string) => `{"status":true,"data":{"id":${id},"reference":"sf_fake","amount":1000000,"currency":"NGN","customer":{"customer_code":"CUS_fake"},"status":"success","paid_at":"2026-10-01T00:00:00Z","domain":"test","plan":null,"plan_object":{}}}`;
const originalFetch = global.fetch;
let json: jest.Mock;
let adapter: PaystackAdapter;
function response(raw: string) {
  const value = new Response(raw);
  json = jest.spyOn(value, "json") as jest.Mock;
  global.fetch = jest.fn().mockResolvedValue(value);
}
beforeEach(() => { adapter = new PaystackAdapter(config, new FetchPaystackHttpClient()); });
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

describe("raw transaction verification response boundary", () => {
  it.each(["0", "1", "9007199254740991", "9007199254740992", "9007199254740993", "18446744073709551614", "18446744073709551615"])("preserves literal %s through HTTP, verification and webhook parity", async id => {
    response(text(id));
    const verified = await adapter.verifyInitialPayment(input);
    const webhook = adapter.normalizeWebhookEvent(parsePaystackJson(`{"event":"charge.success","data":{"id":${id}}}`, "webhook"));
    expect(verified.transactionId).toBe(id);
    expect(webhook?.providerEventId).toBe(`charge.success:${verified.transactionId}`);
    expect(json).not.toHaveBeenCalled();
    expect(() => JSON.stringify(verified)).not.toThrow();
  });
  it.each(['"000123"', '"18446744073709551615"'])("canonicalizes decimal strings %s", async id => {
    response(text(id));
    expect((await adapter.verifyInitialPayment(input)).transactionId).toBe(id === '"000123"' ? "123" : "18446744073709551615");
  });
  it.each(["18446744073709551616", "1e3", "1.0e3", "1000.0", "-0", "null", "{}", "[]", '" "', "01"])("maps invalid token %s to sanitized MALFORMED_RESPONSE", async id => {
    response(text(id));
    await expect(adapter.verifyInitialPayment(input)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE", message: "Provider discovery evidence is malformed" });
  });
  it.each([
    '{"__proto__":9007199254740993}',
    '{"__proto__":{"value":"9007199254740993","isLosslessNumber":true}}',
    '{"isLosslessNumber":true,"value":"9007199254740993"}',
    '{"value":"9007199254740993","__proto__":{"isLosslessNumber":true}}',
    '{"isLosslessNumber":true,"__proto__":{"value":"9007199254740993"}}',
  ])("rejects inherited/fake numeric evidence from provider HTTP", async id => {
    expect(({} as any).polluted).toBeUndefined();
    response(text(id));
    await expect(adapter.verifyInitialPayment(input)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE", message: "Provider discovery evidence is malformed" });
    expect(json).not.toHaveBeenCalled();
    expect(({} as any).polluted).toBeUndefined();
  });
  it.each(["amount", "status", "customer", "plan_object"])("rejects inherited %s evidence from provider HTTP", async key => {
    expect(({} as any).polluted).toBeUndefined();
    response(`{"status":true,"data":{"id":1,"${key}":{"__proto__":{"polluted":true,"value":"forged"}}}}`);
    await expect(adapter.verifyInitialPayment(input)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
    expect(({} as any).polluted).toBeUndefined();
  });
  it.each(["1", "9007199254740993", "18446744073709551615"])("accepts identical duplicate %s without changing verified identity", async id => {
    response(text(id));
    const normal = await adapter.verifyInitialPayment(input);
    response(text(id).replace(`"id":${id}`, `"id":${id},"id":${id}`));
    expect(await adapter.verifyInitialPayment(input)).toEqual(normal);
  });
  it("rejects conflicting duplicate IDs in HTTP verification", async () => {
    response(text("9007199254740992").replace('"id":9007199254740992', '"id":9007199254740992,"id":9007199254740993'));
    await expect(adapter.verifyInitialPayment(input)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it("rejects streamed responses exceeding the cap without reading an unbounded body", async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(PAYSTACK_JSON_LIMIT_BYTES + 1)); }, cancel });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body });
    await expect(adapter.verifyInitialPayment(input)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid UTF-8 rather than silently replacing bytes", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(new Uint8Array([0xff])));
    await expect(adapter.verifyInitialPayment(input)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it("leaves unrelated GET and POST JSON parsing unchanged", async () => {
    response('{"status":true,"data":{"subscription_code":"SUB_fake"}}');
    const client = new FetchPaystackHttpClient();
    const options = { authorization: "Bearer fake-only", timeoutMs: 1000 };
    await client.get("/subscription/SUB_fake", options);
    expect(json).toHaveBeenCalledTimes(1);
    response('{"status":true}');
    await client.post("/subscription/disable", {}, options);
    expect(json).toHaveBeenCalledTimes(1);
  });
  it("does not expose malformed provider text, headers, or credentials in errors/logs", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    response('{"Authorization":"Bearer fake-private","providerEmailToken":"fake-token","customer":"private@example.invalid",');
    let caught: unknown;
    try { await adapter.verifyInitialPayment(input); } catch (e) { caught = e; }
    expect(caught).toMatchObject({ kind: "MALFORMED_RESPONSE" });
    expect(JSON.stringify([caught, log.mock.calls, error.mock.calls, warn.mock.calls])).not.toMatch(/fake-private|fake-token|private@example|sk_test|Authorization|providerEmailToken/);
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
  });
  it("does not expose or log rejected prototype payload contents", async () => {
    const spies = [jest.spyOn(console, "log"), jest.spyOn(console, "warn"), jest.spyOn(console, "error")];
    spies.forEach(spy => spy.mockImplementation(() => {}));
    response(text('{"__proto__":9007199254740993}'));
    let caught: unknown;
    try { await adapter.verifyInitialPayment(input); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ kind: "MALFORMED_RESPONSE", message: "Provider discovery evidence is malformed" });
    expect(String(caught)).not.toMatch(/9007199254740993|__proto__|sf_fake|CUS_fake|PLN_fake/);
    expect(JSON.stringify(caught)).not.toMatch(/9007199254740993|__proto__|sf_fake|CUS_fake|PLN_fake/);
    spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
  });
});
