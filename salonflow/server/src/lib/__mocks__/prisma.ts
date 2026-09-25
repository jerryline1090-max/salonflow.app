import { mockDeep, mockReset, DeepMockProxy } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * Deep-mocked Prisma client used by every unit test in this project.
 * Business logic modules import `{ prisma }` from "../../lib/prisma" —
 * calling `jest.mock("../../lib/prisma")` at the top of a test file swaps
 * in this mock automatically (Jest's manual-mock convention), so tests
 * exercise real business logic against fully controllable fake data
 * instead of hitting a real database.
 */
export const prisma = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prisma);
});
