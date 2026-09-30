ALTER TABLE "Subscription" ADD COLUMN "pastDueEndsAt" TIMESTAMP(3);
CREATE TABLE "SubscriptionLifecycleEvent" (
  "id" TEXT NOT NULL, "subscriptionId" TEXT NOT NULL, "businessId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionLifecycleEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubscriptionLifecycleEvent_subscriptionId_eventKey_key" ON "SubscriptionLifecycleEvent"("subscriptionId", "eventKey");
CREATE INDEX "SubscriptionLifecycleEvent_businessId_createdAt_idx" ON "SubscriptionLifecycleEvent"("businessId", "createdAt");
ALTER TABLE "SubscriptionLifecycleEvent" ADD CONSTRAINT "SubscriptionLifecycleEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionLifecycleEvent" ADD CONSTRAINT "SubscriptionLifecycleEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Subscription_status_trialEndsAt_idx" ON "Subscription"("status", "trialEndsAt");
CREATE INDEX "Subscription_status_graceEndsAt_idx" ON "Subscription"("status", "graceEndsAt");
CREATE INDEX "Subscription_status_pastDueEndsAt_idx" ON "Subscription"("status", "pastDueEndsAt");
CREATE INDEX "Subscription_cancelAtPeriodEnd_currentPeriodEndsAt_idx" ON "Subscription"("cancelAtPeriodEnd", "currentPeriodEndsAt");
