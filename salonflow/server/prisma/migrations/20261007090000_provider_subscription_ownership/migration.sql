-- Preflight must report duplicate non-null provider/subscription pairs before
-- deployment. CREATE UNIQUE INDEX fails closed if any exist; no data repair.
CREATE UNIQUE INDEX "Subscription_provider_providerSubscriptionId_key"
  ON "Subscription"("provider", "providerSubscriptionId");
