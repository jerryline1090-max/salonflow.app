import { PlanCode } from "@prisma/client";

export interface PlanDefinition {
  code: PlanCode;
  displayName: string;
  currency: "NGN";
  monthlyPriceMinor: number;
  // Kept intentionally open for future version-controlled entitlements.
  // V1 does not impose limits on clients, appointments, or services.
  entitlements: Record<EntitlementKey, boolean>;
}

export type EntitlementKey = "aiAssistant" | "websiteAiReceptionist" | "whatsAppAiReceptionist" | "instagramAiReceptionist";

const FULL_FEATURE_ENTITLEMENTS: Record<EntitlementKey, boolean> = {
  aiAssistant: true,
  websiteAiReceptionist: true,
  whatsAppAiReceptionist: true,
  instagramAiReceptionist: true,
};

export const PLAN_DEFINITIONS: Record<PlanCode, PlanDefinition> = {
  STARTER: { code: "STARTER", displayName: "Starter", currency: "NGN", monthlyPriceMinor: 1_000_000, entitlements: FULL_FEATURE_ENTITLEMENTS },
  GROWTH: { code: "GROWTH", displayName: "Growth", currency: "NGN", monthlyPriceMinor: 1_500_000, entitlements: FULL_FEATURE_ENTITLEMENTS },
  PRO: { code: "PRO", displayName: "Pro", currency: "NGN", monthlyPriceMinor: 2_500_000, entitlements: FULL_FEATURE_ENTITLEMENTS },
};

export function getPlanDefinition(planCode: PlanCode): PlanDefinition {
  return PLAN_DEFINITIONS[planCode];
}

export function resolvePlanDefinition(planCode: string): PlanDefinition | null {
  return Object.prototype.hasOwnProperty.call(PLAN_DEFINITIONS, planCode)
    ? PLAN_DEFINITIONS[planCode as PlanCode]
    : null;
}
