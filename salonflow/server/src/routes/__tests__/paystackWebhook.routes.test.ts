jest.mock("../../modules/billing/paystack/paystackProviderFactory", () => ({ createPaystackProvider: jest.fn() }));
jest.mock("../../modules/billing/billingService", () => ({ processVerifiedPaystackEvent: jest.fn() }));

import express from "express";
import request from "supertest";
import { createPaystackProvider } from "../../modules/billing/paystack/paystackProviderFactory";
import { processVerifiedPaystackEvent } from "../../modules/billing/billingService";
import { webhooksRouter } from "../webhooks.routes";

function app() { const instance = express(); instance.use("/api/webhooks", express.json({ verify: (req: any, _res, body: Buffer) => { req.rawBody = body; } }), webhooksRouter); return instance; }

describe("POST /api/webhooks/paystack", () => {
  beforeEach(() => jest.clearAllMocks());
  it("rejects invalid signatures before any billing mutation", async () => {
    (createPaystackProvider as jest.Mock).mockReturnValue({ verifyWebhookSignature: jest.fn(() => false) });
    const response = await request(app()).post("/api/webhooks/paystack").set("x-paystack-signature", "bad").send({ event: "charge.success" });
    expect(response.status).toBe(401);
    expect(processVerifiedPaystackEvent).not.toHaveBeenCalled();
  });

  it("uses the raw body for a verified supported event", async () => {
    const provider = { verifyWebhookSignature: jest.fn(() => true), normalizeWebhookEvent: jest.fn(() => ({ provider: "PAYSTACK", providerEventId: "charge.success:42", eventType: "charge.success", providerReference: "sf_1" })) };
    (createPaystackProvider as jest.Mock).mockReturnValue(provider);
    (processVerifiedPaystackEvent as jest.Mock).mockResolvedValue({ handled: true, duplicate: false });
    const response = await request(app()).post("/api/webhooks/paystack").set("x-paystack-signature", "valid").send({ event: "charge.success", data: { id: 42, reference: "sf_1" } });
    expect(response.status).toBe(200);
    expect((provider.verifyWebhookSignature as jest.Mock).mock.calls[0]?.[0]).toBeInstanceOf(Buffer);
    expect(processVerifiedPaystackEvent).toHaveBeenCalledTimes(1);
  });

  it("returns 503 only when verified event processing is retriable", async () => {
    const provider = { verifyWebhookSignature: jest.fn(() => true), normalizeWebhookEvent: jest.fn(() => ({ provider: "PAYSTACK", providerEventId: "charge.success:retry", eventType: "charge.success", providerReference: "sf_1" })) };
    (createPaystackProvider as jest.Mock).mockReturnValue(provider);
    (processVerifiedPaystackEvent as jest.Mock).mockResolvedValue({ handled: false, retryable: true, reason: "processing" });
    const response = await request(app()).post("/api/webhooks/paystack").set("x-paystack-signature", "valid").send({ event: "charge.success", data: { id: 42, reference: "sf_1" } });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Webhook processing is temporarily unavailable" });
  });

  it("acknowledges a terminal rejected event without asking the provider to retry", async () => {
    const provider = { verifyWebhookSignature: jest.fn(() => true), normalizeWebhookEvent: jest.fn(() => ({ provider: "PAYSTACK", providerEventId: "charge.success:rejected", eventType: "charge.success", providerReference: "sf_1" })) };
    (createPaystackProvider as jest.Mock).mockReturnValue(provider);
    (processVerifiedPaystackEvent as jest.Mock).mockResolvedValue({ handled: false, retryable: false, reason: "provider_identity_conflict" });
    const response = await request(app()).post("/api/webhooks/paystack").set("x-paystack-signature", "valid").send({ event: "charge.success", data: { id: 42, reference: "sf_1" } });
    expect(response.status).toBe(200);
  });
});
