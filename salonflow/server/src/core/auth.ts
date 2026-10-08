import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { resolveAuthSecrets } from "./authSecrets";

/**
 * Everything in this file is intentionally boring: standard bcrypt hashing,
 * standard signed JWTs. The interesting architecture decision is what goes
 * IN the token (see TokenPayload) and where it's checked (core/permissions.ts,
 * unchanged by this file) — not the crypto itself.
 */

const JWT_SECRET = resolveAuthSecrets().jwtSecret;
const TOKEN_TTL = process.env.JWT_TTL ?? "12h";

export interface TokenPayload {
  sub: string; // userId
  businessId: string;
  role: Role;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL } as jwt.SignOptions);
}

export class InvalidTokenError extends Error {
  constructor(message = "Invalid or expired token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === "string"
      || typeof decoded.sub !== "string" || !decoded.sub.trim()
      || typeof decoded.businessId !== "string" || !decoded.businessId.trim()
      || (decoded.role !== "OWNER" && decoded.role !== "MANAGER" && decoded.role !== "STAFF")) {
      throw new InvalidTokenError();
    }
    return { sub: decoded.sub as string, businessId: decoded.businessId as string, role: decoded.role as Role };
  } catch {
    throw new InvalidTokenError();
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
