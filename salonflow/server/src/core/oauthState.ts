import jwt from "jsonwebtoken";
import { IntegrationProvider } from "@prisma/client";
import { resolveAuthSecrets } from "./authSecrets";

/**
 * Meta's OAuth redirect back to our callback URL is an unauthenticated
 * browser navigation — it doesn't carry our JWT. The `state` parameter is
 * the standard OAuth mechanism for (a) proving the callback really
 * continues a flow we initiated (CSRF protection) and (b) carrying enough
 * context to know which business and which owner started it.
 *
 * Deliberately a separate secret from JWT_SECRET (core/auth.ts) — an OAuth
 * state token and a login session token should never be interchangeable,
 * even if someone found a way to feed one into the other's verifier.
 */
const STATE_SECRET = resolveAuthSecrets().oauthStateSecret;
const STATE_TTL = "10m"; // the whole connect flow (redirect to Meta, user approves, redirect back) should take well under this

export interface OAuthStatePayload {
  businessId: string;
  provider: IntegrationProvider;
  actorUserId: string;
}

export function signOAuthState(payload: OAuthStatePayload): string {
  return jwt.sign(payload, STATE_SECRET, { expiresIn: STATE_TTL } as jwt.SignOptions);
}

export class InvalidOAuthStateError extends Error {
  constructor() {
    super("Invalid or expired connection request — please start reconnecting again");
    this.name = "InvalidOAuthStateError";
  }
}

export function verifyOAuthState(state: string): OAuthStatePayload {
  try {
    const decoded = jwt.verify(state, STATE_SECRET);
    if (typeof decoded === "string" || !decoded.businessId || !decoded.provider || !decoded.actorUserId) {
      throw new InvalidOAuthStateError();
    }
    return { businessId: decoded.businessId as string, provider: decoded.provider as IntegrationProvider, actorUserId: decoded.actorUserId as string };
  } catch {
    throw new InvalidOAuthStateError();
  }
}
