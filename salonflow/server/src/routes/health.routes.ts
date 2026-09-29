import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/asyncHandler";

export const healthRouter = Router();

// Liveness deliberately has no database dependency: it answers whether this
// Node process can receive requests.
healthRouter.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness is intentionally the smallest possible database round trip.
healthRouter.get(
  "/ready",
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ready" });
  })
);
