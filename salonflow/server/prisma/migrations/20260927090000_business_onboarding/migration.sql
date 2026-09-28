-- Existing salons must stay usable: they receive COMPLETED by default.
-- New registrations explicitly set IN_PROGRESS/BUSINESS_DETAILS in authService.
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE "OnboardingStep" AS ENUM ('BUSINESS_DETAILS', 'SERVICES', 'BUSINESS_HOURS', 'TEAM', 'INTEGRATIONS', 'REVIEW');

ALTER TABLE "Business"
  ADD COLUMN "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "onboardingStep" "OnboardingStep",
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN "onboardingServiceId" TEXT;
