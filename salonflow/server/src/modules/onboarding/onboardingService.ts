import { OnboardingStep, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { assertValidTimezone } from "../../core/timezone";
import { BusinessHoursInput, saveBusinessHours } from "../settings/businessHoursService";

export class OnboardingAccessError extends Error {}

function assertOwner(role: Role) {
  if (role !== "OWNER") throw new OnboardingAccessError("Only the business owner can manage onboarding");
}

export async function getOnboardingState(businessId: string, role: Role) {
  assertOwner(role);
  return prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { onboardingStatus: true, onboardingStep: true, onboardingCompletedAt: true },
  });
}

export async function advanceOnboarding(businessId: string, role: Role) {
  assertOwner(role);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  if (business.onboardingStatus === "COMPLETED") return stateOf(business);

  const next = await nextRequiredStep(business);
  if (!next) return stateOf(business);
  return prisma.business.update({ where: { id: businessId }, data: { onboardingStatus: "IN_PROGRESS", onboardingStep: next }, select: stateSelect });
}

export async function skipOnboardingStep(businessId: string, role: Role) {
  assertOwner(role);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  if (business.onboardingStatus === "COMPLETED") return stateOf(business);
  if (business.onboardingStep === "TEAM") {
    return prisma.business.update({ where: { id: businessId }, data: { onboardingStep: "INTEGRATIONS" }, select: stateSelect });
  }
  if (business.onboardingStep === "INTEGRATIONS") {
    return prisma.business.update({ where: { id: businessId }, data: { onboardingStep: "REVIEW" }, select: stateSelect });
  }
  throw new Error("Only Team and Integrations can be skipped");
}

export async function getOnboardingReview(businessId: string, role: Role) {
  assertOwner(role);
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { workingHours: { orderBy: { dayOfWeek: "asc" } }, integrations: { select: { provider: true, status: true } } },
  });
  const [activeServiceCount, teamAccountCount] = await Promise.all([
    prisma.service.count({ where: { businessId, isActive: true } }),
    prisma.user.count({ where: { businessId } }),
  ]);
  return { business: { name: business.name, phone: business.phone, timezone: business.timezone }, workingHours: business.workingHours, activeServiceCount, teamAccountCount, integrations: business.integrations };
}

export async function completeOnboarding(businessId: string, role: Role) {
  assertOwner(role);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  if (business.onboardingStatus === "COMPLETED") return stateOf(business);
  const next = await nextRequiredStep(business);
  if (next) throw new Error("Complete the required onboarding steps before finishing");
  return prisma.business.update({
    where: { id: businessId },
    data: { onboardingStatus: "COMPLETED", onboardingStep: null, onboardingCompletedAt: new Date() },
    select: stateSelect,
  });
}

export async function createOnboardingService(businessId: string, role: Role, input: { name: string; category?: string; price: number; durationMinutes: number }) {
  assertOwner(role);
  if (!input.name.trim()) throw new Error("Service name is required");
  if (!Number.isSafeInteger(input.price) || input.price < 0 || !Number.isSafeInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new Error("Service price and duration must be valid whole numbers");
  }
  return prisma.$transaction(async (tx) => {
    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    if (business.onboardingServiceId) return tx.service.findUniqueOrThrow({ where: { id: business.onboardingServiceId } });
    const service = await tx.service.create({ data: { businessId, name: input.name.trim(), category: input.category?.trim() || null, price: input.price, durationMinutes: input.durationMinutes } });
    await tx.business.update({ where: { id: businessId }, data: { onboardingServiceId: service.id } });
    return service;
  });
}

export async function saveOnboardingBusinessHours(
  businessId: string,
  actorUserId: string,
  role: Role,
  hours: BusinessHoursInput[],
) {
  assertOwner(role);
  assertCompleteValidWeek(hours);
  await saveBusinessHours(businessId, actorUserId, hours);
  return advanceOnboarding(businessId, role);
}

async function nextRequiredStep(business: { id: string; name: string; timezone: string; onboardingStep: OnboardingStep | null }): Promise<OnboardingStep | null> {
  const current = business.onboardingStep ?? "BUSINESS_DETAILS";
  if (current === "BUSINESS_DETAILS") {
    if (!business.name.trim()) throw new Error("Business name is required");
    assertValidTimezone(business.timezone);
    return "SERVICES";
  }
  if (current === "SERVICES") {
    if ((await prisma.service.count({ where: { businessId: business.id, isActive: true } })) < 1) throw new Error("Add at least one active service before continuing");
    return "BUSINESS_HOURS";
  }
  if (current === "BUSINESS_HOURS") {
    const hours = await prisma.businessHours.findMany({ where: { businessId: business.id } });
    if (hours.length !== 7 || hours.some((hour) => hour.dayOfWeek < 0 || hour.dayOfWeek > 6 || (!hour.isClosed && hour.openTime >= hour.closeTime))) {
      throw new Error("Configure valid business hours for every day before continuing");
    }
    return "TEAM";
  }
  if (current === "TEAM") return "INTEGRATIONS";
  if (current === "INTEGRATIONS") return "REVIEW";
  return null;
}

const stateSelect = { onboardingStatus: true, onboardingStep: true, onboardingCompletedAt: true } as const;
function stateOf(business: { onboardingStatus: any; onboardingStep: any; onboardingCompletedAt: any }) { return { onboardingStatus: business.onboardingStatus, onboardingStep: business.onboardingStep, onboardingCompletedAt: business.onboardingCompletedAt }; }

function assertCompleteValidWeek(hours: BusinessHoursInput[]) {
  if (hours.length !== 7 || new Set(hours.map((hour) => hour.dayOfWeek)).size !== 7 || hours.some((hour) => hour.dayOfWeek < 0 || hour.dayOfWeek > 6 || (!hour.isClosed && hour.openTime >= hour.closeTime))) {
    throw new Error("Configure valid business hours for every day before continuing");
  }
}
