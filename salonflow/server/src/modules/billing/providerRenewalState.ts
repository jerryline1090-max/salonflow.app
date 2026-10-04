/** Same period-end semantics for verified webhooks and provider discovery.
 * Access evaluation/finalization uses the persisted deadline and server time. */
export function providerNonRenewingState(currentPeriodEndsAt?: Date | null) {
  return { cancelAtPeriodEnd: true, ...(currentPeriodEndsAt ? { currentPeriodEndsAt } : {}) };
}
