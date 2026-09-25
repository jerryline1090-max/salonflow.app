jest.mock("../../lib/prisma");
jest.mock("../../modules/staff/staffProfile");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { staffRouter } from "../staff.routes";
import { signToken } from "../../core/auth";
import { createStaffProfile, setStaffSchedule } from "../../modules/staff/staffProfile";
import { buildStaff } from "../../test-utils/factories";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/staff", staffRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
const managerToken = signToken({ sub: "mgr_1", businessId: "biz_1", role: "MANAGER" });

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("POST /api/staff", () => {
  it("MANAGER cannot create a new staff profile by default (only OWNER can)", async () => {
    const res = await request(buildApp()).post("/api/staff").set("Authorization", `Bearer ${managerToken}`).send({ name: "Ada" });
    expect(res.status).toBe(403);
    expect(createStaffProfile).not.toHaveBeenCalled();
  });

  it("OWNER can create a staff profile, scoped to their own business", async () => {
    (createStaffProfile as jest.Mock).mockResolvedValue(buildStaff());

    const res = await request(buildApp())
      .post("/api/staff")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Ada", skills: ["braiding"] });

    expect(res.status).toBe(201);
    expect(createStaffProfile).toHaveBeenCalledWith(expect.objectContaining({ businessId: "biz_1", name: "Ada" }));
  });
});

describe("PUT /api/staff/:id/schedule", () => {
  it("MANAGER can update an existing staff member's schedule (edit is in their default set)", async () => {
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildStaff({ businessId: "biz_1" }));
    (setStaffSchedule as jest.Mock).mockResolvedValue([]);

    const res = await request(buildApp())
      .put("/api/staff/staff_1/schedule")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ schedule: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }] });

    expect(res.status).toBe(200);
  });

  it("403s when the staff member belongs to a different business", async () => {
    const otherBusinessOwner = signToken({ sub: "owner_2", businessId: "biz_2", role: "OWNER" });
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildStaff({ businessId: "biz_1" }));

    const res = await request(buildApp())
      .put("/api/staff/staff_1/schedule")
      .set("Authorization", `Bearer ${otherBusinessOwner}`)
      .send({ schedule: [] });

    expect(res.status).toBe(403);
    expect(setStaffSchedule).not.toHaveBeenCalled();
  });
});
