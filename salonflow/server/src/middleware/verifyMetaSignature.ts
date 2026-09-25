import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * Meta signs every webhook POST with `X-Hub-Signature-256: sha256=<hmac>`
 * computed over the exact raw request bytes using the app secret. This is
 * the only thing standing between "/api/webhooks/whatsapp" and anyone on
 * the internet who wants to inject fake messages/bookings — it must run
 * before the body is trusted for anything.
 *
 * Requires the raw body to have been captured — see index.ts, which mounts
 * a dedicated `express.json({ verify })` for the webhook routes specifically
 * so `req.rawBody` is available here (the default JSON parser discards it).
 */
export function verifyMetaSignature(appSecretEnvVar: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const appSecret = process.env[appSecretEnvVar];

    if (!appSecret) {
      return res.status(500).json({ error: `${appSecretEnvVar} is not configured` });
    }
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!signature || !rawBody) {
      return res.status(401).json({ error: "Missing signature or request body" });
    }

    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

    if (!timingSafeEqual(signature, expected)) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    next();
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
