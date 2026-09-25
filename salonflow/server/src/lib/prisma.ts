import { PrismaClient } from "@prisma/client";

// Single Prisma instance — the one connection every module in the system
// reads and writes through. This IS the "single source of truth" enforced
// at the code level: no module should ever open its own connection or
// maintain a parallel in-memory copy of appointments/clients/etc.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
