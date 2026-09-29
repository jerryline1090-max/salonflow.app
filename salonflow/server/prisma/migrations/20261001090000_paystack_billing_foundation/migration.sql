-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('PAYSTACK');

-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BillingEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- AlterTable: all provider fields are nullable so existing subscriptions remain valid.
ALTER TABLE "Subscription"
  ADD COLUMN "provider" "BillingProvider",
  ADD COLUMN "providerCustomerId" TEXT,
  ADD COLUMN "providerSubscriptionId" TEXT,
  ADD COLUMN "providerPlanCode" TEXT;

-- CreateTable
CREATE TABLE "BillingInvoice" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "provider" "BillingProvider" NOT NULL,
  "providerReference" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3),
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
  "id" TEXT NOT NULL,
  "provider" "BillingProvider" NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" "BillingEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "businessId" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "failureCode" TEXT,

  CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_provider_providerReference_key"
  ON "BillingInvoice"("provider", "providerReference");
CREATE INDEX "BillingInvoice_businessId_occurredAt_idx"
  ON "BillingInvoice"("businessId", "occurredAt");
CREATE INDEX "BillingInvoice_subscriptionId_occurredAt_idx"
  ON "BillingInvoice"("subscriptionId", "occurredAt");
CREATE UNIQUE INDEX "BillingEvent_provider_providerEventId_key"
  ON "BillingEvent"("provider", "providerEventId");
CREATE INDEX "BillingEvent_businessId_receivedAt_idx"
  ON "BillingEvent"("businessId", "receivedAt");
CREATE INDEX "Subscription_provider_providerCustomerId_idx"
  ON "Subscription"("provider", "providerCustomerId");
CREATE INDEX "Subscription_provider_providerSubscriptionId_idx"
  ON "Subscription"("provider", "providerSubscriptionId");

-- AddForeignKey
ALTER TABLE "BillingInvoice"
  ADD CONSTRAINT "BillingInvoice_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice"
  ADD CONSTRAINT "BillingInvoice_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingEvent"
  ADD CONSTRAINT "BillingEvent_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
