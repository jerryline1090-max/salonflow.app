import { Request, Response, NextFunction } from "express";

/**
 * A handful of endpoints (the attention scanner, future webhook health
 * checks) are triggered by a cron job or scheduler, not a logged-in human,
 * so they can't go through authenticate()/requirePermission(). They're
 * gated by a shared secret instead — never left open on the public API.
 */
export function requireInternalKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["x-internal-key"];
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    return res.status(500).json({ error: "INTERNAL_API_KEY is not configured" });
  }
  if (key !== expected) {
    return res.status(401).json({ error: "Invalid internal key" });
  }
  next();
}
