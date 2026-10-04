import { BillingProviderError, DiscoveredSubscription, InitialPaymentEvidence, SubscriptionDiscovery, VerifiedInitialPayment } from "../billingProvider";
import { PaystackConfig } from "./paystackConfig";
import { paystackResourceId } from "./paystackIdentity";

export type PaystackRead = (path: string) => Promise<{ status: boolean; data?: unknown; meta?: unknown }>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
function invalid(): never { throw new BillingProviderError("MALFORMED_RESPONSE", "Provider discovery evidence is incomplete or inconsistent"); }

function date(value: unknown): Date | undefined {
  // Require a timezone, reject calendar overflow rather than accepting Date's normalization.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const day = value.slice(0, 10);
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return undefined;
  const calendar = new Date(day + "T00:00:00Z");
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}
function environment(config: PaystackConfig): "test" | "live" {
  if (config.secretKey.startsWith("sk_test_")) return "test";
  if (config.secretKey.startsWith("sk_live_")) return "live";
  throw new BillingProviderError("CONFIGURATION", "Provider environment cannot be verified");
}
function integrationsAgree(resources: RecordValue[]): boolean {
  const ids = resources.filter(r => r.integration != null).map(r => paystackResourceId(r.integration));
  return ids.every(id => id !== undefined) && new Set(ids).size <= 1;
}
async function fetchRecord(read: PaystackRead, path: string) {
  const response = await read(path);
  if (!response.status || !response.data || Array.isArray(response.data) || typeof response.data !== "object") invalid();
  return record(response.data);
}

export async function verifyInitialPaystackPayment(read: PaystackRead, config: PaystackConfig, input: InitialPaymentEvidence): Promise<VerifiedInitialPayment> {
  const tx = await fetchRecord(read, `/transaction/verify/${encodeURIComponent(input.reference)}`);
  const transactionId = paystackResourceId(tx.id);
  const paidAt = date(tx.paid_at);
  const domain = environment(config);
  if (!transactionId || !paidAt || tx.status !== "success" || tx.reference !== input.reference
    || tx.amount !== input.amount || tx.currency !== input.currency
    || record(tx.customer).customer_code !== input.providerCustomerId || tx.domain !== domain) invalid();
  // Paystack may omit plan or return plan=null/plan_object={}. Cross-check
  // explicit codes when present; independent plan lookup remains mandatory.
  const scalarPlanId = paystackResourceId(tx.plan);
  const codes = [typeof tx.plan === "string" && !scalarPlanId ? tx.plan : record(tx.plan).plan_code, record(tx.plan_object).plan_code];
  if (codes.some(code => code != null && code !== input.providerPlanCode)) invalid();
  const rawPlanIds = [typeof tx.plan === "number" || scalarPlanId ? tx.plan : record(tx.plan).id, record(tx.plan_object).id].filter(id => id != null);
  const planIds = rawPlanIds.map(paystackResourceId);
  if (planIds.some(id => !id) || new Set(planIds).size > 1) invalid();
  const integrationId = tx.integration == null ? undefined : paystackResourceId(tx.integration);
  if (tx.integration != null && !integrationId) invalid();
  return { ...input, transactionId, paidAt, domain, integrationId, ...(planIds[0] ? { providerPlanId: planIds[0] } : {}) };
}

/** All pages must be proven complete. Limits bound work, never turn truncation
 * into not_found. No provider/customer payload or credential is logged. */
export async function discoverPaystackSubscriptions(read: PaystackRead, payment: VerifiedInitialPayment): Promise<SubscriptionDiscovery> {
  const customer = await fetchRecord(read, `/customer/${encodeURIComponent(payment.providerCustomerId)}`);
  const plan = await fetchRecord(read, `/plan/${encodeURIComponent(payment.providerPlanCode)}`);
  const customerId = paystackResourceId(customer.id);
  const planId = paystackResourceId(plan.id);
  const context = [customer, plan, { integration: payment.integrationId }];
  if (!customerId || !planId || customer.customer_code !== payment.providerCustomerId || plan.plan_code !== payment.providerPlanCode
    || customer.domain !== payment.domain || plan.domain !== payment.domain || !integrationsAgree(context)
    || payment.providerPlanId !== undefined && payment.providerPlanId !== planId) invalid();

  const seen = new Map<string, string>();
  const matches = new Map<string, DiscoveredSubscription>();
  const pageFingerprints = new Set<string>();
  let expectedMeta: string | undefined;
  let consumed = 0;
  for (let page = 1; page <= 20; page++) {
    const response = await read(`/subscription?customer=${customerId}&plan=${planId}&perPage=100&page=${page}`);
    if (!response.status || !Array.isArray(response.data)) invalid();
    const rows = response.data;
    const meta = record(response.meta);
    const { total, perPage, pageCount, skipped } = meta;
    if (![total, perPage, pageCount, skipped, meta.page].every(v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0)
      || (perPage as number) < 1 || (perPage as number) > 100 || meta.page !== page
      || skipped !== (page - 1) * (perPage as number)
      || pageCount !== Math.ceil((total as number) / (perPage as number)) && !(total === 0 && pageCount === 1)
      || rows.length !== Math.min(perPage as number, Math.max(0, (total as number) - (skipped as number)))) invalid();
    const signature = JSON.stringify([total, perPage, pageCount]);
    if (expectedMeta !== undefined && expectedMeta !== signature) invalid();
    expectedMeta = signature;
    const fingerprint = JSON.stringify(rows.map(r => text(record(r).subscription_code)).sort());
    if (rows.length && pageFingerprints.has(fingerprint)) invalid();
    pageFingerprints.add(fingerprint);
    consumed += rows.length;
    if (consumed > 2000) invalid();
    for (const raw of rows) {
      const row = record(raw);
      const code = text(row.subscription_code);
      if (!code) invalid();
      // Compare only relevant provider evidence, in stable key order.
      const representation = JSON.stringify([row.subscription_code, row.email_token, row.status, row.createdAt, row.next_payment_date,
        record(row.customer).customer_code, paystackResourceId(record(row.customer).id), record(row.customer).domain, paystackResourceId(record(row.customer).integration),
        record(row.plan).plan_code, paystackResourceId(record(row.plan).id), record(row.plan).domain, paystackResourceId(record(row.plan).integration),
        paystackResourceId(row.integration), row.domain]);
      if (seen.has(code) && seen.get(code) !== representation) invalid();
      if (seen.has(code)) continue;
      seen.set(code, representation);
      const candidate = normalizeCandidate(row);
      if (!candidate) continue;
      const detail = await fetchRecord(read, `/subscription/${encodeURIComponent(code)}`);
      const confirmed = normalizeCandidate(detail);
      if (!confirmed || JSON.stringify(candidate) !== JSON.stringify(confirmed)) invalid();
      matches.set(code, confirmed);
    }
    if (page >= (pageCount as number)) {
      if (consumed !== total) invalid();
      if (matches.size === 0) return { outcome: "not_found" };
      if (matches.size > 1) return { outcome: "ambiguous" };
      return { outcome: "exactly_one", candidate: [...matches.values()][0] };
    }
  }
  return invalid();

  function normalizeCandidate(row: RecordValue): DiscoveredSubscription | undefined {
    const c = record(row.customer), p = record(row.plan);
    // The subscription and independently fetched resources are authoritative.
    // Embedded domains may be omitted, but an explicit value must corroborate
    // that environment. Apply this rule to both list and detail responses.
    if (c.customer_code !== payment.providerCustomerId || paystackResourceId(c.id) !== customerId
      || p.plan_code !== payment.providerPlanCode || paystackResourceId(p.id) !== planId
      || row.domain !== payment.domain
      || [c, p].some(r => "domain" in r && r.domain !== payment.domain)
      || !integrationsAgree([...context, row, c, p])) return undefined;
    if (row.status !== "active" && row.status !== "non-renewing") return undefined;
    const createdAt = date(row.createdAt);
    const currentPeriodEndsAt = date(row.next_payment_date);
    if (!createdAt || !currentPeriodEndsAt) invalid();
    const delta = createdAt.getTime() - payment.paidAt.getTime();
    const token = text(row.email_token), code = text(row.subscription_code);
    if (delta < -120_000 || delta > 600_000 || !token || !code || currentPeriodEndsAt <= createdAt) return undefined;
    return { providerSubscriptionId: code, providerEmailToken: token, providerCustomerId: payment.providerCustomerId,
      providerPlanCode: payment.providerPlanCode, createdAt, currentPeriodEndsAt, status: row.status === "active" ? "ACTIVE" : "NON_RENEWING" };
  }
}
