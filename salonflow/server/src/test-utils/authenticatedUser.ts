import { TokenPayload, signToken } from "../core/auth";
import { prisma } from "../lib/prisma";

// Existing route tests issue a token for a matching active fixture user.
// This is test-only DB setup, not an authentication bypass. Authority tests
// use explicit current-user mocks independently from token claims instead.
const users = new Map<string, { id: string; businessId: string; role: TokenPayload["role"]; isActive: boolean }>();
beforeEach(() => {
  (prisma.user.findUnique as jest.Mock).mockImplementation(async ({ where }) => users.get(where.id) ?? null);
});

export function signTokenForCurrentUser(payload: TokenPayload) {
  users.set(payload.sub, { id: payload.sub, businessId: payload.businessId, role: payload.role, isActive: true });
  return signToken(payload);
}
