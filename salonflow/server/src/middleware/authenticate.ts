import { Request, Response, NextFunction } from "express";
import { verifyToken, InvalidTokenError } from "../core/auth";

/**
 * Section 27 wiring: this is the ONE place a request's identity is
 * established. Every route downstream trusts `req.actor` and nothing else —
 * there is no route that re-derives "who is this" from the request body.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyToken(token);
    req.actor = { userId: payload.sub, role: payload.role, businessId: payload.businessId };
    next();
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      return res.status(401).json({ error: err.message });
    }
    return res.status(401).json({ error: "Authentication failed" });
  }
}
