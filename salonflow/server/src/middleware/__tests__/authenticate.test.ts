jest.mock("../../lib/prisma");

import { Request, Response } from "express";
import { authenticate } from "../authenticate";
import { signToken } from "../../core/auth";
import { prisma } from "../../lib/prisma";

function mockReqRes(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn();
  return { req, res, next };
}

describe("authenticate middleware", () => {
  it("rejects a request with no Authorization header", () => {
    const { req, res, next } = mockReqRes();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a malformed Authorization header", () => {
    const { req, res, next } = mockReqRes({ authorization: "Basic something" });

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid token", () => {
    const { req, res, next } = mockReqRes({ authorization: "Bearer garbage" });

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.actor).toBeUndefined();
  });

  it("attaches an ActorContext to the request and calls next() for a valid token", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user_1", businessId: "biz_1", role: "MANAGER", isActive: true });
    const token = signToken({ sub: "user_1", businessId: "biz_1", role: "MANAGER" });
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${token}` });

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.actor).toEqual({ userId: "user_1", businessId: "biz_1", role: "MANAGER" });
    expect(res.status).not.toHaveBeenCalled();
  });
});
