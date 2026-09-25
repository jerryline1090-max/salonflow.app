jest.mock("../../core/permissions", () => {
  const actual = jest.requireActual("../../core/permissions");
  return { ...actual, assertCan: jest.fn() };
});

import { Request, Response } from "express";
import { requirePermission } from "../authorize";
import { assertCan, PermissionDeniedError } from "../../core/permissions";

function mockReqRes(actor?: any) {
  const req = { actor } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn();
  return { req, res, next };
}

describe("requirePermission middleware", () => {
  it("returns 401 when there is no authenticated actor on the request", async () => {
    const { req, res, next } = mockReqRes(undefined);

    await requirePermission("payments", "view")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when assertCan resolves (actor is permitted)", async () => {
    (assertCan as jest.Mock).mockResolvedValue(undefined);
    const { req, res, next } = mockReqRes({ userId: "u1", role: "OWNER", businessId: "biz_1" });

    await requirePermission("payments", "delete")(req, res, next);

    expect(assertCan).toHaveBeenCalledWith(req.actor, "payments", "delete");
    expect(next).toHaveBeenCalledWith();
  });

  it("returns 403 when assertCan throws PermissionDeniedError", async () => {
    (assertCan as jest.Mock).mockRejectedValue(new PermissionDeniedError("payments", "delete"));
    const { req, res, next } = mockReqRes({ userId: "u2", role: "STAFF", businessId: "biz_1" });

    await requirePermission("payments", "delete")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards unexpected errors to Express's error handler instead of masking them as a 403", async () => {
    (assertCan as jest.Mock).mockRejectedValue(new Error("database exploded"));
    const { req, res, next } = mockReqRes({ userId: "u1", role: "OWNER", businessId: "biz_1" });

    await requirePermission("payments", "view")(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
