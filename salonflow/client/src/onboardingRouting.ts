export interface OnboardingRouteUser {
  role: "OWNER" | "MANAGER" | "STAFF";
  onboarding?: { onboardingStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" };
}

export function requiresOnboarding(user: OnboardingRouteUser | null | undefined) {
  return user?.role === "OWNER" && user.onboarding?.onboardingStatus !== "COMPLETED";
}
