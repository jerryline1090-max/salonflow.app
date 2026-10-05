jest.mock("../../modules/billing/paystack/paystackProviderFactory", () => ({ createPaystackProvider: jest.fn() }));
jest.mock("../../modules/billing/billingService", () => ({ processVerifiedPaystackEvent: jest.fn() }));
jest.mock("../../lib/prisma");

import express from "express";
import request from "supertest";
import { createHmac } from "crypto";
import { gzipSync } from "zlib";
import { createPaystackProvider } from "../../modules/billing/paystack/paystackProviderFactory";
import { processVerifiedPaystackEvent } from "../../modules/billing/billingService";
import { webhooksRouter } from "../webhooks.routes";
import { PaystackAdapter } from "../../modules/billing/paystack/paystackAdapter";
import * as paystackJson from "../../modules/billing/paystack/paystackJson";
import { prisma } from "../../lib/prisma";

function app() {
  const instance = express();
  // Same explicit ordering as index.ts; no JSON parser before the webhook router.
  instance.use("/api/webhooks", webhooksRouter);
  instance.use(express.json());
  instance.post("/ordinary", (req, res) => res.json(req.body));
  return instance;
}
describe("actual signed Paystack raw-byte HTTP ingress", () => {
  const secret = "fake-hmac-credential-test-only";
  const signature = (body: string | Buffer) => createHmac("sha512", secret).update(body).digest("hex");
  const raw = '{ "event": "charge.success", "data": {"id":9007199254740993,"reference":"sf_fake"} }';
  const post = (body: string, signedBody = body) => request(app()).post("/api/webhooks/paystack").set("Content-Type", "application/json").set("x-paystack-signature", signature(signedBody)).send(body);
  beforeEach(() => {
    jest.clearAllMocks();
    (createPaystackProvider as jest.Mock).mockReturnValue(new PaystackAdapter({ secretKey: secret, timeoutMs: 100, planCodes: { STARTER: "PLN_fake", GROWTH: "PLN_fake", PRO: "PLN_fake" } }, { post: jest.fn() }));
    (processVerifiedPaystackEvent as jest.Mock).mockResolvedValue({ handled: true });
  });
  afterEach(() => jest.restoreAllMocks());
  it.each(["9007199254740992", "9007199254740993", "18446744073709551615"])("authenticates exact bytes and processes oversized ID %s", async id => {
    const payload = raw.replace("9007199254740993", id);
    expect((await post(payload)).status).toBe(200);
    expect(processVerifiedPaystackEvent).toHaveBeenCalledWith(expect.objectContaining({ providerEventId: `charge.success:${id}`, providerReference: "sf_fake" }));
  });
  it.each([raw.replace("{ ", "{"), raw.replace("sf_fake", "sf_\\u0066ake")])("changed whitespace/escaping requires a new signature", async changed => {
    expect(signature(changed)).not.toBe(signature(raw));
    expect((await post(changed, raw)).status).toBe(401);
    expect(processVerifiedPaystackEvent).not.toHaveBeenCalled();
    expect((await post(changed)).status).toBe(200);
    expect(processVerifiedPaystackEvent).toHaveBeenCalledTimes(1);
  });
  it.each([raw, '{"broken":', '{"event":"charge.success","data":{"id":{"__proto__":9007199254740993}}}', '{"event":"charge.success","data":{"id":1,"id":2}}'])("never invokes JSON parser for an invalid signature", async body => {
    const parser = jest.spyOn(paystackJson, "parsePaystackJson");
    expect((await post(body, "different bytes")).status).toBe(401);
    expect(parser).not.toHaveBeenCalled();
    expect(processVerifiedPaystackEvent).not.toHaveBeenCalled();
  });
  it.each(['{"broken":', '{"event":"charge.success","data":{"id":18446744073709551616}}', '{"event":"charge.success","data":{"id":1e3}}', '{"event":"charge.success","data":{}}', '{"event":"charge.success","data":{"id":1,"id":2}}'])("permanently acknowledges signed invalid payload without creating an event", async body => {
    expect((await post(body)).status).toBe(200);
    expect(processVerifiedPaystackEvent).not.toHaveBeenCalled();
  });
  it.each([
    '{"__proto__":9007199254740993}',
    '{"__proto__":{"value":"9007199254740993","isLosslessNumber":true}}',
    '{"isLosslessNumber":true,"value":"9007199254740993"}',
  ])("rejects signed prototype/fake-wrapper IDs before normalization or persistence", async id => {
    const normalize = jest.spyOn(PaystackAdapter.prototype, "normalizeWebhookEvent");
    expect(({} as any).polluted).toBeUndefined();
    expect((await post(`{"event":"charge.success","data":{"id":${id},"amount":1000000,"currency":"NGN"}}`)).status).toBe(200);
    expect(normalize).not.toHaveBeenCalled();
    expect(processVerifiedPaystackEvent).not.toHaveBeenCalled();
    expect(prisma.billingEvent.create).not.toHaveBeenCalled();
    expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
    expect(({} as any).polluted).toBeUndefined();
  });
  it("rejects compressed bodies without parsing or billing work", async () => {
    const parser = jest.spyOn(paystackJson, "parsePaystackJson");
    const compressed = gzipSync(raw);
    const response = await request(app()).post("/api/webhooks/paystack").set("Content-Type", "application/json").set("Content-Encoding", "gzip").set("x-paystack-signature", signature(compressed)).send(compressed);
    expect(response.status).toBe(415);
    expect(parser).not.toHaveBeenCalled(); expect(processVerifiedPaystackEvent).not.toHaveBeenCalled();
  });
  it("rejects bodies over the original 100 KiB limit", async () => {
    expect((await post(" ".repeat(paystackJson.PAYSTACK_JSON_LIMIT_BYTES + 1))).status).toBe(413);
    expect(processVerifiedPaystackEvent).not.toHaveBeenCalled();
  });
  it("does not log raw parser errors or expose payload secrets", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const response = await post('{"Authorization":"Bearer fake-private","providerEmailToken":"fake-token","customer":"private@example.invalid",');
    expect(response.status).toBe(200);
    expect(JSON.stringify([response.body, response.text, log.mock.calls, error.mock.calls, warn.mock.calls])).not.toMatch(/fake-private|fake-token|private@example|Authorization|providerEmailToken/);
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
  });
  it.each(["whatsapp", "instagram"])("preserves %s JSON/raw capture and actual Meta HMAC", async channel => {
    const prior = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = "fake-meta-test-only";
    (prisma.integration.findFirst as jest.Mock).mockResolvedValue(null);
    const body = channel === "whatsapp"
      ? '{ "entry": [{"changes":[{"value":{"metadata":{"phone_number_id":"PHONE_fake"}}}]}] }'
      : '{ "entry": [{"id":"IG_fake"}] }';
    try {
      const sign = "sha256=" + createHmac("sha256", process.env.META_APP_SECRET).update(body).digest("hex");
      expect((await request(app()).post(`/api/webhooks/${channel}`).set("Content-Type", "application/json").set("x-hub-signature-256", sign).send(body)).status).toBe(200);
      expect(prisma.integration.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ externalId: channel === "whatsapp" ? "PHONE_fake" : "IG_fake" }) }));
      expect((await request(app()).post(`/api/webhooks/${channel}`).set("Content-Type", "application/json").set("x-hub-signature-256", "bad").send(body)).status).toBe(401);
      expect(createPaystackProvider).not.toHaveBeenCalled();
    } finally { if (prior === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = prior; }
  });
  it("leaves ordinary API JSON parsing unchanged", async () => {
    const response = await request(app()).post("/ordinary").send({ id: 42, value: 1.5 });
    expect(response.body).toEqual({ id: 42, value: 1.5 });
    expect(createPaystackProvider).not.toHaveBeenCalled();
  });
});
