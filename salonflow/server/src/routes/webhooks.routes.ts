import express, { Router } from "express";
import { prisma } from "../lib/prisma";
import { verifyMetaSignature } from "../middleware/verifyMetaSignature";
import { buildWhatsAppDeps, buildInstagramDeps } from "../modules/ai/orchestratorFactory";
import { handleUnifiedMessage } from "../modules/ai/receptionistOrchestrator";
import { createPaystackProvider } from "../modules/billing/paystack/paystackProviderFactory";
import { processVerifiedPaystackEvent } from "../modules/billing/billingService";
import { paystackWebhookBody } from "../middleware/paystackWebhookBody";
import { parsePaystackJson, PaystackJsonError } from "../modules/billing/paystack/paystackJson";
import { TextDecoder } from "util";

export const webhooksRouter = Router();

// Paystack is intentionally public: its HMAC over the exact raw request body
// is the authentication boundary. This handler never logs bodies/signatures.
webhooksRouter.post("/paystack", paystackWebhookBody, async (req, res) => {
  try {
    const provider = createPaystackProvider();
    const signature = req.header("x-paystack-signature");
    if (!Buffer.isBuffer((req as any).rawBody) || !provider.verifyWebhookSignature((req as any).rawBody, signature)) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }
    let payload: Record<string, unknown>;
    try {
      // Decode only after authentication; invalid UTF-8 is not silently replaced.
      payload = parsePaystackJson(new TextDecoder("utf-8", { fatal: true }).decode((req as any).rawBody), "webhook");
    } catch (error) {
      if (error instanceof PaystackJsonError || error instanceof TypeError) return res.sendStatus(200);
      throw error;
    }
    const event = provider.normalizeWebhookEvent(payload);
    if (!event) return res.sendStatus(200); // unsupported/malformed events are safely acknowledged
    const result = await processVerifiedPaystackEvent(event);
    // A transient processing failure must be non-2xx so Paystack can retry.
    // Permanent validation/correlation outcomes are acknowledged intentionally.
    if (result.retryable) return res.status(503).json({ error: "Webhook processing is temporarily unavailable" });
    return res.status(200).json({ received: true, duplicate: "duplicate" in result && result.duplicate === true });
  } catch {
    // Do not expose provider or billing details to an unauthenticated caller.
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

// Paystack has already finished its raw-body route above. Meta keeps its
// existing JSON + raw capture behavior; no reliance on body-parser skip flags.
webhooksRouter.use(express.json({ verify: (req: any, _res, body: Buffer) => { req.rawBody = body; } }));

/**
 * Section 21: WhatsApp/Instagram → Channel Adapter → Unified Conversation
 * Engine. This file's only job is: verify it's really Meta, find which
 * SalonFlow business this webhook belongs to, normalize, and hand off to
 * the orchestrator. No booking/AI logic lives here.
 */

// ── WhatsApp ────────────────────────────────────────────────────────────

// One-time verification handshake Meta performs when the webhook URL is registered.
webhooksRouter.get("/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

webhooksRouter.post("/whatsapp", verifyMetaSignature("META_APP_SECRET"), async (req, res) => {
  // Acknowledge fast — Meta retries aggressively on non-2xx/timeout, which
  // would otherwise spam retries into a slow salon. All actual failures are
  // still recorded/notified inside the orchestrator, not swallowed here.
  try {
    const phoneNumberId = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    const integration = phoneNumberId
      ? await prisma.integration.findFirst({
          where: { provider: "WHATSAPP_BUSINESS", externalId: phoneNumberId, status: "CONNECTED" },
        })
      : null;

    if (!integration) {
      return res.sendStatus(200); // no connected business for this number — nothing to do
    }

    const deps = buildWhatsAppDeps(phoneNumberId, integration.secretRef ?? "");
    const messages = await deps.channelAdapter.normalizeInbound(req.body, integration.businessId);
    for (const msg of messages) {
      await handleUnifiedMessage(msg, deps);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("WhatsApp webhook processing error:", err);
    res.sendStatus(200);
  }
});

// ── Instagram ───────────────────────────────────────────────────────────

webhooksRouter.get("/instagram", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

webhooksRouter.post("/instagram", verifyMetaSignature("META_APP_SECRET"), async (req, res) => {
  try {
    const igAccountId = req.body?.entry?.[0]?.id;
    const integration = igAccountId
      ? await prisma.integration.findFirst({
          where: { provider: "INSTAGRAM", externalId: igAccountId, status: "CONNECTED" },
        })
      : null;

    if (!integration) {
      return res.sendStatus(200);
    }

    const deps = buildInstagramDeps(igAccountId, integration.secretRef ?? "");
    const messages = await deps.channelAdapter.normalizeInbound(req.body, integration.businessId);
    for (const msg of messages) {
      await handleUnifiedMessage(msg, deps);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("Instagram webhook processing error:", err);
    res.sendStatus(200);
  }
});
