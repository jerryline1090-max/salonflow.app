import { PlanCode } from "@prisma/client";
import { BillingProviderError } from "../billingProvider";
import { PaystackAdapter, PaystackHttpClient } from "../paystack/paystackAdapter";
import { getPaystackConfig, getPaystackPlanCode } from "../paystack/paystackConfig";
import { FetchPaystackHttpClient } from "../paystack/paystackProviderFactory";

const testEnvironment = {
  PAYSTACK_SECRET_KEY: "test-secret-not-a-real-key",
  PAYSTACK_STARTER_PLAN_CODE: "PLN_STARTER_TEST",
  PAYSTACK_GROWTH_PLAN_CODE: "PLN_GROWTH_TEST",
  PAYSTACK_PRO_PLAN_CODE: "PLN_PRO_TEST",
};

describe("Paystack provider foundation", () => {
  it("maps every SalonFlow plan to a server-configured provider plan", () => {
    expect(getPaystackPlanCode(PlanCode.STARTER, testEnvironment)).toBe("PLN_STARTER_TEST");
    expect(getPaystackPlanCode(PlanCode.GROWTH, testEnvironment)).toBe("PLN_GROWTH_TEST");
    expect(getPaystackPlanCode(PlanCode.PRO, testEnvironment)).toBe("PLN_PRO_TEST");
  });

  it("rejects incomplete provider configuration", () => {
    expect(() => getPaystackConfig({ PAYSTACK_SECRET_KEY: "test" })).toThrow(BillingProviderError);
  });

  it.each([
    [PlanCode.STARTER, 1_000_000, "PLN_STARTER_TEST"],
    [PlanCode.GROWTH, 1_500_000, "PLN_GROWTH_TEST"],
    [PlanCode.PRO, 2_500_000, "PLN_PRO_TEST"],
  ])("constructs a server-owned %s checkout amount and configured provider plan", async (planCode, amount, providerPlan) => {
    const post = jest.fn().mockResolvedValue({
      status: true,
      data: {
        authorization_url: "https://checkout.test/authorization",
        access_code: "access-test",
        reference: "billing-reference-1",
      },
    });
    const adapter = new PaystackAdapter(getPaystackConfig(testEnvironment), { post } as PaystackHttpClient);

    await expect(adapter.initializeCheckout({
      email: "owner@example.test",
      planCode,
      amount,
      reference: "billing-reference-1",
      metadata: { checkoutId: "checkout-1", checkoutReference: "billing-reference-1", businessId: "business-1", subscriptionId: "subscription-1", planCode },
    })).resolves.toEqual({
      authorizationUrl: "https://checkout.test/authorization",
      accessCode: "access-test",
      providerReference: "billing-reference-1",
    });

    expect(post).toHaveBeenCalledWith(
      "/transaction/initialize",
      expect.objectContaining({
        email: "owner@example.test",
        plan: providerPlan,
        amount: String(amount),
        reference: "billing-reference-1",
      }),
      expect.objectContaining({ timeoutMs: 10_000 }),
    );
  });

  it("maps transport failures to safe provider errors", async () => {
    const adapter = new PaystackAdapter(getPaystackConfig(testEnvironment), {
      post: jest.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "AbortError" })),
    });

    await expect(adapter.initializeCheckout({
      email: "owner@example.test",
      planCode: PlanCode.STARTER,
      amount: 1_000_000,
      reference: "billing-reference-2",
      metadata: { checkoutId: "checkout-2", checkoutReference: "billing-reference-2", businessId: "business-1", subscriptionId: "subscription-1", planCode: PlanCode.STARTER },
    })).rejects.toMatchObject({ kind: "TIMEOUT" });
  });

  it("retains only the provider HTTP status and bounded top-level message for a rejected checkout", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 422, json: jest.fn().mockResolvedValue({ status: false, message: "Invalid plan configuration" }) }) as any;
    const client = new FetchPaystackHttpClient();
    await expect(client.post("/transaction/initialize", {}, { authorization: "Bearer test", timeoutMs: 10_000 }))
      .rejects.toMatchObject({ kind: "REJECTED", providerStatus: 422, providerMessage: "Invalid plan configuration" });
    global.fetch = originalFetch;
  });

  it("does not retain malformed or non-string provider response data", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: jest.fn().mockResolvedValue({ message: { detail: "not allowlisted" }, data: { sensitive: true } }) }) as any;
    const client = new FetchPaystackHttpClient();
    await expect(client.post("/transaction/initialize", {}, { authorization: "Bearer test", timeoutMs: 10_000 }))
      .rejects.toMatchObject({ kind: "REJECTED", providerStatus: 400, providerMessage: undefined });
    global.fetch = originalFetch;
  });

  it("provides signature verification and normalized event data without route wiring", () => {
    const adapter = new PaystackAdapter(getPaystackConfig(testEnvironment), { post: jest.fn() });
    const rawBody = Buffer.from('{"event":"charge.success"}');
    const signature = require("crypto").createHmac("sha512", testEnvironment.PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");

    expect(adapter.verifyWebhookSignature(rawBody, signature)).toBe(true);
    expect(adapter.normalizeWebhookEvent({
      event: "charge.success",
      data: { id: 42, reference: "billing-reference-3", paid_at: "2026-09-29T00:00:00.000Z" },
    })).toMatchObject({ provider: "PAYSTACK", providerEventId: "charge.success:42", eventType: "charge.success" });
  });

  it.each([
    ["prefers nested customer_code over a numeric id", { id: 123, customer_code: "CUS_PREFERRED" }, "CUS_PREFERRED"],
    ["prefers nested customer_code over a string id", { id: "123", customer_code: "CUS_PREFERRED" }, "CUS_PREFERRED"],
    ["normalizes a numeric customer id when no code exists", { id: 123 }, "123"],
    ["uses a non-empty string customer id when no code exists", { id: "CUS_STRING_ID" }, "CUS_STRING_ID"],
    ["does not derive identity from email", { email: "owner@example.test" }, undefined],
    ["returns undefined when customer identity is missing", {}, undefined],
  ])("%s", (_label, customer, expectedCustomerId) => {
    const adapter = new PaystackAdapter(getPaystackConfig(testEnvironment), { post: jest.fn() });
    const normalized = adapter.normalizeWebhookEvent({ event: "charge.success", data: { id: 42, reference: "billing-reference-customer", customer } });
    expect(normalized?.providerCustomerId).toBe(expectedCustomerId);
  });

  it("reads and normalizes only a matching provider subscription through the mockable HTTP boundary", async () => {
    const get = jest.fn().mockResolvedValue({ status: true, data: { subscription_code: "sub_code", status: "active", customer: { id: 123, customer_code: "CUS_SUBSCRIPTION" }, plan: { plan_code: "plan" }, next_payment_date: "2026-11-01T00:00:00.000Z" } });
    const adapter = new PaystackAdapter(getPaystackConfig(testEnvironment), { post: jest.fn(), get });
    await expect(adapter.getSubscriptionState("sub_code")).resolves.toMatchObject({ providerSubscriptionId: "sub_code", providerCustomerId: "CUS_SUBSCRIPTION", providerPlanCode: "plan", status: "ACTIVE" });
    expect(get).toHaveBeenCalledWith("/subscription/sub_code", expect.objectContaining({ timeoutMs: 10_000 }));
  });

  it("rejects malformed provider subscription responses without local fallback", async () => {
    const adapter = new PaystackAdapter(getPaystackConfig(testEnvironment), { post: jest.fn(), get: jest.fn().mockResolvedValue({ status: true, data: { subscription_code: "other" } }) });
    await expect(adapter.getSubscriptionState("sub_code")).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
});
