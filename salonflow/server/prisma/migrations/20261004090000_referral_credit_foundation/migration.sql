-- Referral attribution and the commercial-credit ledger are additive. Existing
-- businesses retain a NULL referralCode until their code is lazily generated.
CREATE TYPE "ReferralStatus" AS ENUM ('ATTRIBUTED', 'REWARDED', 'REVERSED');
CREATE TYPE "BillingCreditDirection" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "BillingCreditReason" AS ENUM ('REFERRAL_REWARD', 'REFERRAL_REVERSAL');

ALTER TABLE "Business" ADD COLUMN "referralCode" TEXT;
CREATE UNIQUE INDEX "Business_referralCode_key" ON "Business"("referralCode");

CREATE TABLE "Referral" (
  "id" TEXT NOT NULL,
  "referrerBusinessId" TEXT NOT NULL,
  "referredBusinessId" TEXT NOT NULL,
  "referralCode" TEXT NOT NULL,
  "status" "ReferralStatus" NOT NULL DEFAULT 'ATTRIBUTED',
  "rewardedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Referral_referredBusinessId_key" ON "Referral"("referredBusinessId");
CREATE INDEX "Referral_referrerBusinessId_status_idx" ON "Referral"("referrerBusinessId", "status");
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerBusinessId_fkey"
  FOREIGN KEY ("referrerBusinessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredBusinessId_fkey"
  FOREIGN KEY ("referredBusinessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BillingCreditEntry" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "direction" "BillingCreditDirection" NOT NULL,
  "reason" "BillingCreditReason" NOT NULL,
  "referralId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingCreditEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingCreditEntry_referralId_key" ON "BillingCreditEntry"("referralId");
CREATE INDEX "BillingCreditEntry_businessId_createdAt_idx" ON "BillingCreditEntry"("businessId", "createdAt");
ALTER TABLE "BillingCreditEntry" ADD CONSTRAINT "BillingCreditEntry_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingCreditEntry" ADD CONSTRAINT "BillingCreditEntry_referralId_fkey"
  FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
