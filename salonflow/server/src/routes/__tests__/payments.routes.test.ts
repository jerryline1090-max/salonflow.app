jest.mock("../../lib/prisma");
jest.mock("../../modules/payments/paymentService");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { paymentsRouter } from "../payments.routes";
import { signToken } from "../../core/auth";
import { recordPayment } from "../../modules/payments/paymentService";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/payments", paymentsRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
const staffToken = signToken({ sub: "staff_1", businessId: "biz_1", role: "STAFF" });

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("GET /api/payments", () => {
  it("STAFF cannot view payments by default", async () => {
    const res = await request(buildApp()).get("/api/payments").set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("returns payments scoped to the actor's own business, including client and service context", async () => {
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([]);

    await request(buildApp()).get("/api/payments").set("Authorization", `Bearer ${ownerToken}`);

    const callArgs = (prisma.payment.findMany as jest.Mock).mock.calls[0][0];
    expect(callArgs.where).toEqual({ businessId: "biz_1" });
    expect(callArgs.include).toEqual(expect.objectContaining({ client: true }));
  });
});

describe("POST /api/payments", () => {
  it("403s when the linked appointment belongs to a different business", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "appt_1", businessId: "other_biz" });

    const res = await request(buildApp())
      .post("/api/payments")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ appointmentId: "appt_1", clientId: "client_1", amount: 100000, method: "CASH" });

    expect(res.status).toBe(403);
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("records a payment for an OWNER within their own business", async () => {
    (recordPayment as jest.Mock).mockResolvedValue({ id: "pay_1" });

    const res = await request(buildApp())
      .post("/api/payments")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ clientId: "client_1", amount: 100000, method: "CASH" });

    expect(res.status).toBe(201);
    expect(recordPayment).toHaveBeenCalledWith(expect.objectContaining({ businessId: "biz_1", clientId: "client_1", amount: 100000 }));
  });
});
