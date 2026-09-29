import { PlanCode } from "@prisma/client";
import { BillingProviderError } from "../billingProvider";

export interface PaystackConfig {
  secretKey: string;
  planCodes: Record<PlanCode, string>;
  timeoutMs: number;
}

type Environment = NodeJS.ProcessEnv;

const planEnvironmentNames: Record<PlanCode, keyof Environment> = {
  STARTER: "PAYSTACK_STARTER_PLAN_CODE",
  GROWTH: "PAYSTACK_GROWTH_PLAN_CODE",
  PRO: "PAYSTACK_PRO_PLAN_CODE",
};

export function getPaystackConfig(environment: Environment = process.env): PaystackConfig {
  const secretKey = environment.PAYSTACK_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new BillingProviderError("CONFIGURATION", "Paystack billing is not configured");
  }

  const planCodes = {} as Record<PlanCode, string>;
  for (const planCode of Object.values(PlanCode)) {
    const value = environment[planEnvironmentNames[planCode]]?.trim();
    if (!value) {
      throw new BillingProviderError(
        "CONFIGURATION",
        `Paystack plan mapping is missing for ${planCode}`,
      );
    }
    planCodes[planCode] = value;
  }

  return { secretKey, planCodes, timeoutMs: 10_000 };
}

export function getPaystackPlanCode(planCode: PlanCode, environment?: Environment): string {
  return getPaystackConfig(environment).planCodes[planCode];
}
