import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";
import { canViewNotification, notificationVisibilityWhere } from "../modules/notifications/notificationVisibility";
import { asyncHandler } from "../middleware/asyncHandler";
import { rethrowIfDatabaseUnavailable } from "../middleware/errorHandler";

export const notificationsRouter = Router();

/**
 * Every notification created throughout the app (appointment events,
 * staff removal, AI escalations, integration failures, reputation
 * feedback -- see notificationListeners.ts) surfaces here. A STAFF actor
 * only sees notifications actually meant for them; owner/manager-level
 * business alerts stay out of their feed.
 */
notificationsRouter.get("/", requirePermission("dashboard", "view"), asyncHandler(async (req, res) => {
  const where: any = notificationVisibilityWhere(req.actor!);
  if (req.query.unreadOnly === "true") {
    where.isRead = false;
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  res.json(notifications);
}));

notificationsRouter.post("/:id/read", requirePermission("dashboard", "view"), asyncHandler(async (req, res) => {
  try {
    const notification = await prisma.notification.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, notification.businessId, "notification");
    if (!canViewNotification(req.actor!, notification)) {
      return res.status(403).json({ error: "You cannot access this notification" });
    }

    const updated = await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    res.json(updated);
  } catch (err: any) {
    rethrowIfDatabaseUnavailable(err);
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
}));
