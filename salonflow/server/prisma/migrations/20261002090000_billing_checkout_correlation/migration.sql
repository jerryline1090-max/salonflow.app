-- CreateEnum
CREATE TYPE "BillingCheckoutStatus" AS ENUM ('INITIALIZED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "BillingCheckout" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "provider" "BillingProvider" NOT NULL,
  "reference" TEXT NOT NULL,
  "planCode" "PlanCode" NOT NULL,
  "providerPlanCode" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "status" "BillingCheckoutStatus" NOT NULL DEFAULT 'INITIALIZED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "BillingCheckout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingCheckout_reference_key" ON "BillingCheckout"("reference");
CREATE INDEX "BillingCheckout_businessId_createdAt_idx" ON "BillingCheckout"("businessId", "createdAt");
CREATE INDEX "BillingCheckout_subscriptionId_createdAt_idx" ON "BillingCheckout"("subscriptionId", "createdAt");

ALTER TABLE "BillingCheckout" ADD CONSTRAINT "BillingCheckout_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingCheckout" ADD CONSTRAINT "BillingCheckout_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
