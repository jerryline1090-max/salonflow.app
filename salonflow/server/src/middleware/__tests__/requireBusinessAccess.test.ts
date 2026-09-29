jest.mock("../../modules/subscriptions/subscriptionService");

import { Request, Response } from "express";
import { getBusinessSubscription, resolveBusinessAccess } from "../../modules/subscriptions/subscriptionService";
import { requireBusinessAccess } from "../requireBusinessAccess";

function context() {
  const req = { actor: { userId: "owner_1", role: "OWNER", businessId: "biz_1" } } as unknown as Request;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() } as unknown as Response;
  return { req, res, next: jest.fn() };
}

describe("requireBusinessAccess", () => {
  it.each(["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"])("allows %s operational access", async (status) => {
    const { req, res, next } = context();
    (getBusinessSubscription as jest.Mock).mockResolvedValue({ id: "sub_1" });
    (resolveBusinessAccess as jest.Mock).mockReturnValue({ allowed: true, accessState: status === "ACTIVE" || status === "TRIALING" ? "FULL_ACCESS" : "RECOVERY" });
    await requireBusinessAccess(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each(["SUSPENDED", "CANCELLED", "MISSING"])("blocks %s from operational routes", async (status) => {
    const { req, res, next } = context();
    (getBusinessSubscription as jest.Mock).mockResolvedValue(status === "MISSING" ? null : { id: "sub_1" });
    (resolveBusinessAccess as jest.Mock).mockReturnValue({ allowed: false, accessState: status === "MISSING" ? "UNAVAILABLE" : "SUSPENDED" });
    await requireBusinessAccess(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
