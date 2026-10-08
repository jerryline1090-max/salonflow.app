import { Request, Response, NextFunction } from "express";
import { verifyToken, InvalidTokenError } from "../core/auth";
import { prisma } from "../lib/prisma";

/**
 * Section 27 wiring: this is the ONE place a request's identity is
 * established. Every route downstream trusts `req.actor` and nothing else —
 * there is no route that re-derives "who is this" from the request body.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = header.slice("Bearer ".length);
  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      return res.status(401).json({ error: err.message });
    }
    return res.status(401).json({ error: "Authentication failed" });
  }
  // The token identifies its owner, not their current permissions/membership.
  // Keep infrastructure failures outside the invalid-token catch above.
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, businessId: true, role: true, isActive: true },
    });
    if (!user || !user.isActive || user.businessId !== payload.businessId) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    req.actor = { userId: user.id, role: user.role, businessId: user.businessId };
  } catch (error) {
    return next(error);
  }
  next();
}
