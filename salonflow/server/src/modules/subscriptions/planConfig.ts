import { PlanCode } from "@prisma/client";

export interface PlanDefinition {
  code: PlanCode;
  currency: "NGN";
  monthlyPriceMinor: number;
  // Kept intentionally open for future version-controlled entitlements.
  // V1 does not impose limits on clients, appointments, or services.
  entitlements: Record<string, boolean>;
}

export const PLAN_DEFINITIONS: Record<PlanCode, PlanDefinition> = {
  STARTER: { code: "STARTER", currency: "NGN", monthlyPriceMinor: 1_000_000, entitlements: {} },
  GROWTH: { code: "GROWTH", currency: "NGN", monthlyPriceMinor: 1_500_000, entitlements: {} },
  PRO: { code: "PRO", currency: "NGN", monthlyPriceMinor: 2_500_000, entitlements: {} },
};

export function getPlanDefinition(planCode: PlanCode): PlanDefinition {
  return PLAN_DEFINITIONS[planCode];
}
