import { RequestHandler } from "express";

// Pilot safety switch, not launch approval. Account ownership validation,
// entitlements and abuse protections are required before staging/production enablement.
export const MESSAGING_UNAVAILABLE = "Messaging is currently unavailable.";
export function publicMessagingEnabled(value: string | undefined): boolean {
  return value === "true";
}

export const requirePublicMessaging: RequestHandler = (_req, res, next) => {
  if (!publicMessagingEnabled(process.env.PUBLIC_MESSAGING_ENABLED)) return res.status(503).json({ error: MESSAGING_UNAVAILABLE });
  next();
};

export const requireMetaMessaging: RequestHandler = (req, res, next) => {
  if (req.params.provider === "whatsapp" || req.params.provider === "instagram") {
    return requirePublicMessaging(req, res, next);
  }
  next();
};
