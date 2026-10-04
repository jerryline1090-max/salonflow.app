import { PaystackAdapter } from "../paystack/paystackAdapter";
import { paystackResourceId } from "../paystack/paystackIdentity";
import { BillingProviderError } from "../billingProvider";

const config = { secretKey: "sk_test_mock_only", timeoutMs: 100, planCodes: { STARTER: "PLN_test", GROWTH: "PLN_growth", PRO: "PLN_pro" } };
const input = { reference: "sf_test", amount: 1000000, currency: "NGN", providerCustomerId: "CUS_test", providerPlanCode: "PLN_test" };
const paidAt = new Date("2026-10-02T01:06:16Z");
const payment = { ...input, transactionId: "42", paidAt, domain: "test" as const };
const customer = { customer_code: "CUS_test", id: 12, integration: 9, domain: "test" };
const plan = { plan_code: "PLN_test", id: 13, integration: 9, domain: "test" };
const candidate = () => ({ subscription_code: "SUB_test", email_token: "fake_server_token", customer: { ...customer }, plan: { ...plan },
  integration: 9, domain: "test", status: "active", createdAt: paidAt.toISOString(), next_payment_date: "2026-11-02T01:06:00Z" });
function setup(pages: any[][] = [[candidate()]], overrides: Record<string, unknown> = {}) {
  const rows = pages.flat();
  const get = jest.fn(async (path: string): Promise<any> => {
    if (path in overrides) { const value = overrides[path]; if (value instanceof Error) throw value; return value; }
    if (path.startsWith("/transaction/verify/")) return { status: true, data: { ...input, reference: input.reference, id: 42, status: "success", paid_at: paidAt.toISOString(), domain: "test", customer, plan: null, plan_object: {} } };
    if (path === "/customer/CUS_test") return { status: true, data: customer };
    if (path === "/plan/PLN_test") return { status: true, data: plan };
    if (path.startsWith("/subscription?")) {
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
      const perPage = Math.max(1, pages[0].length);
      return { status: true, data: pages[page - 1], meta: { total: rows.length, page, pageCount: Math.ceil(rows.length / perPage), perPage, skipped: (page - 1) * perPage } };
    }
    return { status: true, data: rows.find(r => r.subscription_code === path.slice("/subscription/".length)) };
  });
  return { adapter: new PaystackAdapter(config, { post: jest.fn(), get }), get };
}
const page1 = "/subscription?customer=12&plan=13&perPage=100&page=1";
const page2 = "/subscription?customer=12&plan=13&perPage=100&page=2";

describe("Paystack authoritative and embedded environment evidence", () => {
  const invalidDomains = [undefined, null, "live", "", 123];
  function withDomain(resource: Record<string, unknown>, domain: unknown) {
    const updated = { ...resource, domain };
    if (domain === undefined) delete (updated as Record<string, unknown>).domain;
    return updated;
  }
  function omitEmbeddedDomains(target: "customer" | "plan" | "both") {
    const row = candidate();
    return { ...row,
      customer: target !== "plan" ? withDomain(row.customer, undefined) : row.customer,
      plan: target !== "customer" ? withDomain(row.plan, undefined) : row.plan,
    };
  }

  it.each(["customer", "plan", "both"] as const)("accepts omitted embedded %s domains and fetches candidate details", async target => {
    const { adapter, get } = setup([[omitEmbeddedDomains(target)]]);
    await expect(adapter.discoverSubscriptions(payment)).resolves.toMatchObject({ outcome: "exactly_one" });
    expect(get).toHaveBeenCalledWith("/subscription/SUB_test", expect.any(Object));
  });

  it.each(["customer", "plan"] as const)("accepts explicitly matching embedded %s domain", async target => {
    const row = omitEmbeddedDomains("both");
    row[target] = withDomain(row[target], "test");
    await expect(setup([[row]]).adapter.discoverSubscriptions(payment)).resolves.toMatchObject({ outcome: "exactly_one" });
  });

  describe.each(["customer", "plan"] as const)("embedded %s", target => {
    it.each([null, "live", "", 123])("rejects an explicitly conflicting/malformed domain %j", async domain => {
      const row = candidate();
      const { adapter, get } = setup([[{ ...row, [target]: withDomain(row[target], domain) }]]);
      await expect(adapter.discoverSubscriptions(payment)).resolves.toEqual({ outcome: "not_found" });
      expect(get).not.toHaveBeenCalledWith("/subscription/SUB_test", expect.any(Object));
    });
  });

  it.each(invalidDomains)("rejects missing/conflicting/malformed top-level subscription domain %j", async domain => {
    await expect(setup([[withDomain(candidate(), domain)]]).adapter.discoverSubscriptions(payment)).resolves.toEqual({ outcome: "not_found" });
  });

  describe.each([
    ["customer", "/customer/CUS_test", customer],
    ["plan", "/plan/PLN_test", plan],
  ] as const)("fetched %s authoritative environment", (_name, path, resource) => {
    it.each(invalidDomains)("rejects missing/conflicting/malformed domain %j", async domain => {
      const { adapter } = setup(undefined, { [path]: { status: true, data: withDomain(resource, domain) } });
      await expect(adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
    });
  });

  it.each(invalidDomains)("rejects missing/conflicting/malformed verified transaction domain %j", async domain => {
    const { adapter, get } = setup();
    get.mockResolvedValueOnce({ status: true, data: withDomain({ id: 42, reference: input.reference, amount: input.amount,
      currency: input.currency, customer, paid_at: paidAt.toISOString(), status: "success" }, domain) });
    await expect(adapter.verifyInitialPayment(input)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });

  it.each(["customer", "plan", "both"] as const)("accepts details omitting embedded %s domains after a fully expanded list response", async target => {
    const { adapter, get } = setup(undefined, { "/subscription/SUB_test": { status: true, data: omitEmbeddedDomains(target) } });
    await expect(adapter.discoverSubscriptions(payment)).resolves.toMatchObject({ outcome: "exactly_one" });
    expect(get).toHaveBeenCalledWith("/subscription/SUB_test", expect.any(Object));
  });

  it.each(["customer", "plan"] as const)("rejects an embedded %s environment conflict appearing only in details", async target => {
    const row = candidate();
    const { adapter } = setup(undefined, { "/subscription/SUB_test": { status: true, data: { ...row, [target]: withDomain(row[target], "live") } } });
    await expect(adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });

  it.each(invalidDomains)("requires the authoritative subscription environment in details too: %j", async domain => {
    const { adapter } = setup(undefined, { "/subscription/SUB_test": { status: true, data: withDomain(candidate(), domain) } });
    await expect(adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });

  it("uses the same matching rules for a fully mocked live environment", async () => {
    const liveCustomer = withDomain(customer, "live"), livePlan = withDomain(plan, "live");
    const row = { ...omitEmbeddedDomains("both"), domain: "live" };
    const { adapter, get } = setup([[row]], {
      "/customer/CUS_test": { status: true, data: liveCustomer },
      "/plan/PLN_test": { status: true, data: livePlan },
    });
    await expect(adapter.discoverSubscriptions({ ...payment, domain: "live" })).resolves.toMatchObject({ outcome: "exactly_one" });
    expect(get).toHaveBeenCalledWith("/subscription/SUB_test", expect.any(Object));
  });
});

describe("Paystack discovery evidence", () => {
  it("accepts null/missing transaction plan and missing integration, using canonical paid_at", async () => {
    const { adapter } = setup();
    await expect(adapter.verifyInitialPayment(input)).resolves.toEqual(payment);
  });
  it.each(["id", "reference", "amount", "currency", "customer", "paid_at", "domain", "plan", "plan_object", "status"])("rejects invalid transaction %s", async field => {
    const tx: any = { id: 42, reference: input.reference, amount: input.amount, currency: input.currency, customer, paid_at: paidAt.toISOString(), domain: "test", status: "success" };
    tx[field] = field === "plan" || field === "plan_object" ? { plan_code: "PLN_other" } : field === "customer" ? { customer_code: "CUS_other" } : "wrong";
    const { adapter } = setup(undefined, { "/transaction/verify/sf_test": { status: true, data: tx } });
    await expect(adapter.verifyInitialPayment(input)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it.each([42, "42", "18446744073709551615"])("uses an exact transaction ID %s in both paths", async id => {
    const { adapter, get } = setup();
    get.mockResolvedValueOnce({ status: true, data: { id, reference: input.reference, amount: input.amount, currency: input.currency, customer, paid_at: paidAt.toISOString(), domain: "test", status: "success" } });
    const verified = await adapter.verifyInitialPayment(input);
    expect(adapter.normalizeWebhookEvent({ event: "charge.success", data: { id } })?.providerEventId).toBe(`charge.success:${verified.transactionId}`);
  });
  it.each([9007199254740992, "18446744073709551616", "42.0", -1, Infinity])("rejects unsafe transaction IDs %s", async id => {
    expect(paystackResourceId(id)).toBeUndefined();
    const { adapter, get } = setup();
    expect(adapter.normalizeWebhookEvent({ event: "charge.success", data: { id } })).toBeNull();
    get.mockResolvedValueOnce({ status: true, data: { id, reference: input.reference, amount: input.amount, currency: input.currency, customer, paid_at: paidAt.toISOString(), domain: "test", status: "success" } });
    await expect(adapter.verifyInitialPayment(input)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
});

describe("Paystack paginated subscription discovery", () => {
  it("returns exact customer/plan/payment match and server-only credentials", async () => {
    const { adapter, get } = setup();
    await expect(adapter.discoverSubscriptions(payment)).resolves.toMatchObject({ outcome: "exactly_one", candidate: { providerSubscriptionId: "SUB_test", providerEmailToken: "fake_server_token", currentPeriodEndsAt: new Date("2026-11-02T01:06:00Z") } });
    expect(get).toHaveBeenCalledWith(page1, expect.any(Object));
    expect(get).toHaveBeenCalledWith("/subscription/SUB_test", expect.any(Object));
  });
  it("finds a candidate on page 2 even when provider perPage is less than requested", async () => {
    const old = { ...candidate(), subscription_code: "SUB_old", createdAt: "2026-10-01T01:06:16Z" };
    const { adapter, get } = setup([[old], [candidate()]]);
    await expect(adapter.discoverSubscriptions(payment)).resolves.toMatchObject({ outcome: "exactly_one" });
    expect(get).toHaveBeenCalledWith(page2, expect.any(Object));
  });
  it("returns ambiguous for page 1 and page 2 candidates", async () => {
    const { adapter } = setup([[candidate()], [{ ...candidate(), subscription_code: "SUB_second" }]]);
    await expect(adapter.discoverSubscriptions(payment)).resolves.toEqual({ outcome: "ambiguous" });
  });
  it("fails rather than returning a partial page-1 match", async () => {
    const { adapter } = setup([[candidate()], [candidate()]], { [page2]: new Error("secret provider body") });
    await expect(adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "UNAVAILABLE", message: "Provider discovery is unavailable", providerMessage: undefined });
  });
  it.each([{}, { total: 1, perPage: 1, pageCount: 2, page: 1, skipped: 0 }, { total: 1, perPage: 100, pageCount: 1, page: 2, skipped: 0 }])("rejects malformed/inconsistent pagination %j", async meta => {
    const { adapter } = setup(undefined, { [page1]: { status: true, data: [candidate()], meta } });
    await expect(adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it("rejects repeated pages", async () => {
    const { adapter } = setup([[candidate()], [candidate()]]);
    await expect(adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it("never treats an exhausted page budget as a completed search", async () => {
    const pages = Array.from({ length: 21 }, (_, i) => [{ ...candidate(), subscription_code: `SUB_${i}`, createdAt: "2026-10-01T01:06:16Z" }]);
    await expect(setup(pages).adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it("deduplicates identical codes without duplicating candidates", async () => {
    await expect(setup([[candidate(), candidate()]]).adapter.discoverSubscriptions(payment)).resolves.toMatchObject({ outcome: "exactly_one" });
  });
  it("rejects conflicting representations of a repeated code", async () => {
    await expect(setup([[candidate(), { ...candidate(), email_token: "other_fake_token" }]]).adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it.each([
    { customer: { ...customer, customer_code: "CUS_other" } }, { customer: { ...customer, id: 99 } },
    { customer: { email: "same@example.test", id: 12, domain: "test" } },
    { plan: { ...plan, plan_code: "PLN_other" } }, { plan: { ...plan, id: 99 } },
    { integration: 99 }, { domain: "live" }, { customer: { ...customer, integration: 99 } },
    { plan: { ...plan, domain: "live" } }, { email_token: "" },
    { createdAt: "2026-10-01T01:06:16Z" },
    ...["attention", "completed", "cancelled", "unknown"].map(status => ({ status })),
  ])("does not trust provider filters: %j", async change => {
    await expect(setup([[{ ...candidate(), ...change }]]).adapter.discoverSubscriptions(payment)).resolves.toEqual({ outcome: "not_found" });
  });
  it.each(["not-a-date", "2026-02-30T01:06:16Z", "2026-10-02T01:06:16"])("rejects malformed creation timestamp %s", async createdAt => {
    await expect(setup([[{ ...candidate(), createdAt }]]).adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it.each([-120000, 600000])("includes exact window boundary %s", async delta => {
    await expect(setup([[{ ...candidate(), createdAt: new Date(paidAt.getTime() + delta).toISOString() }]]).adapter.discoverSubscriptions(payment)).resolves.toMatchObject({ outcome: "exactly_one" });
  });
  it.each([-120001, 600001])("excludes outside window %s", async delta => {
    await expect(setup([[{ ...candidate(), createdAt: new Date(paidAt.getTime() + delta).toISOString() }]]).adapter.discoverSubscriptions(payment)).resolves.toMatchObject({ outcome: "not_found" });
  });
  it("normalizes non-renewing candidates", async () => {
    await expect(setup([[{ ...candidate(), status: "non-renewing" }]]).adapter.discoverSubscriptions(payment)).resolves.toMatchObject({ outcome: "exactly_one", candidate: { status: "NON_RENEWING" } });
  });
  it("rejects list/detail conflicts", async () => {
    const { adapter } = setup(undefined, { "/subscription/SUB_test": { status: true, data: { ...candidate(), subscription_code: "SUB_other" } } });
    await expect(adapter.discoverSubscriptions(payment)).rejects.toBeInstanceOf(BillingProviderError);
  });
  it("returns not_found only after a complete empty result", async () => {
    await expect(setup([[]]).adapter.discoverSubscriptions(payment)).resolves.toEqual({ outcome: "not_found" });
  });
  it.each([
    { ...customer, integration: 8 }, { ...customer, domain: "live" }, { ...customer, id: 9007199254740992 },
  ])("rejects inconsistent fetched customer context %j", async data => {
    await expect(setup(undefined, { "/customer/CUS_test": { status: true, data } }).adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it("checks optional transaction integration against provider resources", async () => {
    await expect(setup().adapter.discoverSubscriptions({ ...payment, integrationId: "99" })).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it("checks optional transaction numeric plan ID independently", async () => {
    await expect(setup().adapter.discoverSubscriptions({ ...payment, providerPlanId: "99" })).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
    await expect(setup().adapter.discoverSubscriptions({ ...payment, providerPlanId: "13" })).resolves.toMatchObject({ outcome: "exactly_one" });
  });
  it("rejects changing pagination totals mid-search", async () => {
    const { adapter } = setup([[candidate()], [{ ...candidate(), subscription_code: "SUB_2" }]], { [page2]: { status: true, data: [], meta: { total: 1, perPage: 1, page: 2, pageCount: 1, skipped: 1 } } });
    await expect(adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it("rejects a malformed next-payment date", async () => {
    await expect(setup([[{ ...candidate(), next_payment_date: "invalid" }]]).adapter.discoverSubscriptions(payment)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
});
