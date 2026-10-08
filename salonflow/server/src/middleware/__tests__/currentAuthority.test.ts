jest.mock("../../lib/prisma");

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { signToken } from "../../core/auth";
import { resolveAuthSecrets } from "../../core/authSecrets";
import { authenticate } from "../authenticate";
import { requirePermission } from "../authorize";
import { errorHandler } from "../errorHandler";
import { authRouter } from "../../routes/auth.routes";

const current = { id: "user_A", businessId: "business_A", role: "OWNER" as Role, isActive: true };
const claims = { sub: current.id, businessId: current.businessId, role: "OWNER" as Role };
let user: typeof current | null;
let executed: jest.Mock;
function app() {
  const app = express().use(express.json());
  app.use("/auth", authRouter);
  app.get("/protected", authenticate, executed);
  app.get("/owner", authenticate, requirePermission("settings", "edit"), executed);
  app.get("/manager", authenticate, requirePermission("reports", "view"), executed);
  app.use(errorHandler);
  return app;
}
beforeEach(() => {
  user = { ...current };
  executed = jest.fn((req, res) => res.json(req.actor));
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.user.findUnique as jest.Mock).mockImplementation(async ({ select }) => select.isActive ? user : {
    name: "Fixture", email: "fixture@example.test", business: { onboardingStatus: "COMPLETED", onboardingStep: null, subscription: null },
  });
});

it("uses one minimal current-user query and exposes no private fields", async () => {
  const res = await request(app()).get("/protected").set("Authorization", `Bearer ${signToken(claims)}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ userId: current.id, businessId: current.businessId, role: "OWNER" });
  expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: current.id }, select: { id: true, businessId: true, role: true, isActive: true } });
});

it.each([ ["OWNER", "MANAGER", "/owner"], ["OWNER", "STAFF", "/owner"], ["MANAGER", "STAFF", "/manager"] ] as const)("demotion %s to %s immediately denies %s through real authorization", async (oldRole, newRole, path) => {
  user!.role = newRole;
  const res = await request(app()).get(path).set("Authorization", `Bearer ${signToken({ ...claims, role: oldRole })}`);
  expect(res.status).toBe(403);
  expect(executed).not.toHaveBeenCalled();
});

it("uses a promotion immediately without requiring a new JWT", async () => {
  const res = await request(app()).get("/owner").set("Authorization", `Bearer ${signToken({ ...claims, role: "STAFF" })}`);
  expect(res.status).toBe(200);
  expect(res.body.role).toBe("OWNER");
});

it("preserves stored permission overrides with the current role", async () => {
  user!.role = "STAFF";
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue({ canView: true });
  const res = await request(app()).get("/manager").set("Authorization", `Bearer ${signToken(claims)}`);
  expect(res.status).toBe(200);
  expect(res.body.role).toBe("STAFF");
});

it.each(["inactive", "deleted", "moved"])("%s user gets the same generic 401 on protected and /auth/me routes", async (reason) => {
  if (reason === "deleted") user = null;
  else if (reason === "inactive") user!.isActive = false;
  else user!.businessId = "business_B";
  for (const path of ["/protected", "/auth/me"]) {
    const res = await request(app()).get(path).set("Authorization", `Bearer ${signToken(claims)}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired token" });
  }
  expect(executed).not.toHaveBeenCalled();
});

it.each([ { sub: undefined }, { sub: 123 }, { sub: " " }, { businessId: undefined }, { businessId: {} }, { businessId: "" }, { role: undefined }, { role: 1 }, { role: "ADMIN" } ])("rejects signed malformed claims %j before DB lookup", async (invalid) => {
  const token = jwt.sign({ ...claims, ...invalid }, resolveAuthSecrets().jwtSecret);
  const res = await request(app()).get("/protected").set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ error: "Invalid or expired token" });
  expect(prisma.user.findUnique).not.toHaveBeenCalled();
  expect(executed).not.toHaveBeenCalled();
});

it.each(["OWNER", "MANAGER", "STAFF"] as const)("/auth/me returns current %s authority and safe display data", async (role) => {
  user!.role = role;
  const res = await request(app()).get("/auth/me").set("Authorization", `Bearer ${signToken(claims)}`);
  expect(res.status).toBe(200);
  expect(res.body.role).toBe(role);
  expect(res.body.businessId).toBe("business_A");
  expect(res.body.passwordHash).toBeUndefined();
  const queries = (prisma.user.findUnique as jest.Mock).mock.calls;
  expect(queries).toHaveLength(2);
  expect(queries[1][0].select).not.toHaveProperty("role");
  expect(queries[1][0].select).not.toHaveProperty("passwordHash");
});

it.each(["P1001", "P1008", "P2024", "generic"])("DB error %s reaches the safe non-401 handler", async (code) => {
  const error = code === "generic" ? new Error("private database details") : new Prisma.PrismaClientKnownRequestError("private database details", { code, clientVersion: "5.22.0" });
  (prisma.user.findUnique as jest.Mock).mockRejectedValue(error);
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    for (const path of ["/protected", "/auth/me"]) {
      const res = await request(app()).get(path).set("Authorization", `Bearer ${signToken(claims)}`);
      expect([500, 503]).toContain(res.status);
      expect(res.status).not.toBe(401);
      expect(JSON.stringify(res.body)).not.toMatch(/private|Invalid or expired|stack/);
    }
    expect(executed).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  } finally { log.mockRestore(); }
});
