import { hasEntitlement, resolveEntitlements } from "../entitlementService";

describe("entitlementService", () => {
  it.each(["STARTER", "GROWTH", "PRO"] as const)("resolves %s through centralized plan configuration", (plan) => {
    expect(resolveEntitlements(plan)?.code).toBe(plan);
    expect(hasEntitlement(plan, "aiAssistant")).toBe(true);
  });

  it("does not impose operational record caps or grant unknown plans", () => {
    expect(resolveEntitlements("STARTER")?.entitlements).not.toHaveProperty("clients");
    expect(resolveEntitlements("STARTER")?.entitlements).not.toHaveProperty("services");
    expect(resolveEntitlements("STARTER")?.entitlements).not.toHaveProperty("appointments");
    expect(resolveEntitlements("UNKNOWN")).toBeNull();
    expect(hasEntitlement("UNKNOWN", "aiAssistant")).toBe(false);
  });
});
