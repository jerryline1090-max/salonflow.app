-- Provider-neutral commercial subscription foundation. Operational salon-client
-- payments remain in the existing "Payment" table and are not modified here.
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "PlanCode" AS ENUM ('STARTER', 'GROWTH', 'PRO');

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "planCode" "PlanCode" NOT NULL DEFAULT 'STARTER',
    "status" "SubscriptionStatus" NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "currentPeriodEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_businessId_key" ON "Subscription"("businessId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing businesses retain uninterrupted access. The unique business index
-- plus ON CONFLICT makes this backfill safe against duplicate subscriptions.
INSERT INTO "Subscription" (
  "id", "businessId", "planCode", "status", "trialEndsAt", "graceEndsAt",
  "currentPeriodEndsAt", "cancelAtPeriodEnd", "createdAt", "updatedAt"
)
SELECT
  'sub_' || md5("Business"."id" || clock_timestamp()::text || random()::text),
  "Business"."id",
  'STARTER'::"PlanCode",
  'ACTIVE'::"SubscriptionStatus",
  NULL,
  NULL,
  NULL,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Business"
ON CONFLICT ("businessId") DO NOTHING;
