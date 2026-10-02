-- Add durable, provider-event retry state without changing existing billing data.
ALTER TYPE "BillingEventStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "BillingEventStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "BillingEvent"
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "processingToken" TEXT,
  ADD COLUMN "failureStage" TEXT;

CREATE INDEX "BillingEvent_status_processingStartedAt_idx"
  ON "BillingEvent"("status", "processingStartedAt");
