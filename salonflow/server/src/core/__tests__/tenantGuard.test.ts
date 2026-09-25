import { assertBelongsToBusiness, ForbiddenError } from "../tenantGuard";

describe("assertBelongsToBusiness", () => {
  it("passes silently when the resource belongs to the actor's business", () => {
    expect(() => assertBelongsToBusiness({ businessId: "biz_1" }, "biz_1", "appointment")).not.toThrow();
  });

  it("throws ForbiddenError when the resource belongs to a different business", () => {
    expect(() => assertBelongsToBusiness({ businessId: "biz_1" }, "biz_2", "appointment")).toThrow(ForbiddenError);
  });

  it("throws when the actor has no businessId at all (should never happen post-auth, but fail closed)", () => {
    expect(() => assertBelongsToBusiness({}, "biz_1", "appointment")).toThrow(ForbiddenError);
  });
});
