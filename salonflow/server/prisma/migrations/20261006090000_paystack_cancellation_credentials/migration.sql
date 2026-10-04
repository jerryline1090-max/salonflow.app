-- Paystack requires the subscription email token, together with the
-- subscription code, for its server-side enable/disable endpoints.
-- This is nullable so existing subscriptions remain valid until their
-- verified provider state supplies the credential.
ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "providerEmailToken" TEXT;
