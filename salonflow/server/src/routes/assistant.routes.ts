import { Router } from "express";
import { askAssistant } from "../modules/ai/assistantOrchestrator";
import { resolveAssistantModelClient } from "../modules/ai/orchestratorFactory";
import { checkAiRateLimit } from "../modules/ai/rateLimit";

export const assistantRouter = Router();

/**
 * Section 29: available throughout the app via a floating icon. There is
 * deliberately no `requirePermission()` gate on this route itself beyond
 * `authenticate` (mounted globally) — ANY authenticated user can talk to
 * the Assistant, because the Assistant's answers are already bounded by
 * their own permissions at the tool level (assistantTools.ts). Gating the
 * endpoint itself would be redundant with, not a replacement for, that.
 */
assistantRouter.post("/ask", async (req, res) => {
  try {
    const { message, currentPage } = req.body;
    if (!message || typeof message !== "string" || message.trim().length > 4_000) {
      return res.status(400).json({ error: "message must be between 1 and 4000 characters" });
    }
    if (currentPage !== undefined && (typeof currentPage !== "string" || currentPage.length > 200)) return res.status(400).json({ error: "Invalid page context" });
    const rate = checkAiRateLimit(`assistant:${req.actor!.businessId}:${req.actor!.userId}`);
    if (!rate.allowed) return res.status(429).set("Retry-After", String(rate.retryAfterSeconds)).json({ error: "Too many AI requests. Please try again shortly." });

    const modelClient = resolveAssistantModelClient(req.actor!, currentPage);
    const result = await askAssistant({ actor: req.actor!, message, currentPage }, modelClient);

    res.json(result);
  } catch (err: any) {
    console.error("AI assistant request failed", { businessId: req.actor?.businessId, userId: req.actor?.userId, error: err.message });
    res.status(503).json({ error: "SalonFlow AI is temporarily unavailable. Please try again." });
  }
});
