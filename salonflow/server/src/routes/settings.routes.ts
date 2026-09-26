import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { writeAuditLog } from "../core/auditLog";
import { assertValidTimezone } from "../core/timezone";

export const settingsRouter = Router();

// Only business-wide fields live here (section 4) — service price/duration,
// staff schedules, client history, etc. are never editable through this
// endpoint; they belong to their own resource routes.
const EDITABLE_FIELDS = [
  "name",
  "logoUrl",
  "description",
  "phone",
  "email",
  "address",
  "timezone",
  "mode",
  "defaultBufferMinutes",
  "minBookingNoticeMins",
  "maxBookingHorizonDays",
  "homeServiceRadiusKm",
  "homeServiceTravelBufferMins",
  "reputationEnabled",
  "reputationRequestDelayHours",
  "reputationHappyThreshold",
  "googleReviewUrl",
] as const;

settingsRouter.get("/", requirePermission("settings", "view"), async (req, res) => {
  const business = await prisma.business.findUnique({
    where: { id: req.actor!.businessId },
    include: { workingHours: true },
  });
  if (!business) return res.status(404).json({ error: "Business not found" });
  res.json(business);
});

settingsRouter.put("/", requirePermission("settings", "edit"), async (req, res) => {
  try {
    const before = await prisma.business.findUniqueOrThrow({ where: { id: req.actor!.businessId } });

    const data: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in req.body) data[field] = req.body[field];
    }
    if ("timezone" in data) assertValidTimezone(data.timezone);

    const updated = await prisma.business.update({ where: { id: before.id }, data });

    await writeAuditLog({
      businessId: before.id,
      actorUserId: req.actor!.userId,
      resource: "settings",
      resourceId: before.id,
      action: "update",
      previousValue: before,
      newValue: updated,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

settingsRouter.put("/working-hours", requirePermission("settings", "edit"), async (req, res) => {
  try {
    const { hours } = req.body as { hours: { dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }[] };
    const businessId = req.actor!.businessId!;

    await prisma.$transaction(
      hours.map((h) =>
        prisma.businessHours.upsert({
          where: { businessId_dayOfWeek: { businessId, dayOfWeek: h.dayOfWeek } },
          create: { businessId, ...h },
          update: h,
        })
      )
    );

    await writeAuditLog({
      businessId,
      actorUserId: req.actor!.userId,
      resource: "settings",
      resourceId: businessId,
      action: "update_working_hours",
      newValue: hours,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
