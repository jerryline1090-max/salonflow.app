jest.mock("../../../lib/prisma");
jest.mock("../../settings/businessHoursService", () => ({ saveBusinessHours: jest.fn() }));
import { prisma } from "../../../lib/prisma";
import { saveBusinessHours } from "../../settings/businessHoursService";
import { advanceOnboarding, completeOnboarding, createOnboardingService, getOnboardingState, getOnboardingReview, saveOnboardingBusinessHours, skipOnboardingStep } from "../onboardingService";
import { readFileSync } from "fs";
import { resolve } from "path";

const business = { id: "biz_1", name: "Salon", timezone: "Africa/Lagos", onboardingStatus: "IN_PROGRESS", onboardingStep: "SERVICES", onboardingCompletedAt: null, onboardingServiceId: null };
beforeEach(() => { (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue(business); (prisma.business.update as jest.Mock).mockResolvedValue({ onboardingStatus: "IN_PROGRESS", onboardingStep: "TEAM", onboardingCompletedAt: null }); });

describe("onboarding workflow", () => {
  it("restores the server-persisted step when onboarding is resumed", async () => {
    const persisted = { onboardingStatus: "IN_PROGRESS", onboardingStep: "BUSINESS_HOURS", onboardingCompletedAt: null };
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue(persisted);
    await expect(getOnboardingState("biz_1", "OWNER")).resolves.toEqual(persisted);
    expect(prisma.business.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "biz_1" } }));
  });
  it("skips integrations and completes without a connected Meta account", async () => {
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...business, onboardingStep: "INTEGRATIONS" });
    await skipOnboardingStep("biz_1", "OWNER");
    expect(prisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ data: { onboardingStep: "REVIEW" } }));
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...business, onboardingStep: "REVIEW" });
    await completeOnboarding("biz_1", "OWNER");
    expect(prisma.business.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ onboardingStatus: "COMPLETED", onboardingStep: null }) }));
    expect(prisma.integration.findMany).not.toHaveBeenCalled();
  });
  it("does not create or advance for invalid service price/duration", async () => {
    await expect(createOnboardingService("biz_1", "OWNER", { name: "Cut", price: 1.5, durationMinutes: 30 })).rejects.toThrow(/whole numbers/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.business.update).not.toHaveBeenCalled();
  });
  it("does not let non-owners manipulate owner onboarding", async () => {
    await expect(advanceOnboarding("biz_1", "STAFF")).rejects.toThrow(/owner/i);
  });
  it("requires an active service before advancing from SERVICES", async () => {
    (prisma.service.count as jest.Mock).mockResolvedValue(0);
    await expect(advanceOnboarding("biz_1", "OWNER")).rejects.toThrow(/active service/i);
  });
  it("allows only optional steps to be skipped", async () => {
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...business, onboardingStep: "TEAM" });
    await expect(skipOnboardingStep("biz_1", "OWNER")).resolves.toEqual(expect.objectContaining({ onboardingStep: "TEAM" }));
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue(business);
    await expect(skipOnboardingStep("biz_1", "OWNER")).rejects.toThrow(/only Team/i);
  });
  it("does not complete until required prerequisites have progressed to REVIEW", async () => {
    (prisma.service.count as jest.Mock).mockResolvedValue(0);
    await expect(completeOnboarding("biz_1", "OWNER")).rejects.toThrow(/active service/i);
  });
  it("returns the already-created onboarding service on retry", async () => {
    const tx: any = { business: { findUniqueOrThrow: jest.fn().mockResolvedValue({ ...business, onboardingServiceId: "svc_1" }) }, service: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "svc_1" }) } };
    (prisma.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await expect(createOnboardingService("biz_1", "OWNER", { name: "Cut", price: 1000, durationMinutes: 30 })).resolves.toEqual({ id: "svc_1" });
    expect(tx.service.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "svc_1" } });
  });

  it("persists a valid seven-day week before advancing to TEAM", async () => {
    const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, openTime: "09:00", closeTime: "17:00", isClosed: dayOfWeek === 0 }));
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...business, onboardingStep: "BUSINESS_HOURS" });
    (prisma.businessHours.findMany as jest.Mock).mockResolvedValue(hours);
    await expect(saveOnboardingBusinessHours("biz_1", "owner_1", "OWNER", hours)).resolves.toEqual(expect.objectContaining({ onboardingStep: "TEAM" }));
    expect(saveBusinessHours).toHaveBeenCalledWith("biz_1", "owner_1", hours);
    expect(prisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ onboardingStep: "TEAM" }) }));
  });

  it("does not persist or advance invalid business hours", async () => {
    const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, openTime: "17:00", closeTime: "09:00", isClosed: false }));
    await expect(saveOnboardingBusinessHours("biz_1", "owner_1", "OWNER", hours)).rejects.toThrow(/valid business hours/i);
    expect(saveBusinessHours).not.toHaveBeenCalled();
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  it("does not advance when business-hours persistence fails", async () => {
    const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, openTime: "09:00", closeTime: "17:00", isClosed: false }));
    (saveBusinessHours as jest.Mock).mockRejectedValue(new Error("storage unavailable"));
    await expect(saveOnboardingBusinessHours("biz_1", "owner_1", "OWNER", hours)).rejects.toThrow("storage unavailable");
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  it("returns persisted hours in the resumable onboarding review", async () => {
    const hours = [{ dayOfWeek: 1, openTime: "09:00", closeTime: "17:00", isClosed: false }];
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...business, workingHours: hours, integrations: [] });
    (prisma.service.count as jest.Mock).mockResolvedValue(1);
    (prisma.user.count as jest.Mock).mockResolvedValue(1);
    await expect(getOnboardingReview("biz_1", "OWNER")).resolves.toEqual(expect.objectContaining({ workingHours: hours }));
  });

  it("keeps incomplete owners out of normal application routes", () => {
    const app = readFileSync(resolve(__dirname, "../../../../../client/src/App.tsx"), "utf8");
    expect(app).toContain('if (requiresOnboarding(user)) return <Navigate to="/onboarding" replace />;');
    expect(app).toContain('if (!requiresOnboarding(user)) return <Navigate to="/" replace />;');
  });
});
