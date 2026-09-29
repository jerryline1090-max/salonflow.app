import { PlanCode } from "@prisma/client";
import { EntitlementKey, PlanDefinition, resolvePlanDefinition } from "./planConfig";

/** Server-side authority for commercial feature decisions. */
export function resolveEntitlements(planCode: string): PlanDefinition | null {
  return resolvePlanDefinition(planCode);
}

export function hasEntitlement(planCode: PlanCode | string, entitlement: EntitlementKey): boolean {
  return resolveEntitlements(planCode)?.entitlements[entitlement] ?? false;
}
