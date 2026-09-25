import { Router } from "express";
import { prisma } from "../lib/prisma";
import { verifyMetaSignature } from "../middleware/verifyMetaSignature";
import { buildWhatsAppDeps, buildInstagramDeps } from "../modules/ai/orchestratorFactory";
import { handleUnifiedMessage } from "../modules/ai/receptionistOrchestrator";

export const webhooksRouter = Router();

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
