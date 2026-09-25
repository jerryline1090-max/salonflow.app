import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";

export const notificationsRouter = Router();

/**
 * Every notification created throughout the app (appointment events,
 * staff removal, AI escalations, integration failures, reputation
 * feedback -- see notificationListeners.ts) surfaces here. A STAFF actor
 * only sees notifications actually meant for them; owner/manager-level
 * business alerts stay out of their feed.
 */
notificationsRouter.get("/", requirePermission("dashboard", "view"), async (req, res) => {
  const where: any = { businessId: req.actor!.businessId };
  if (req.actor!.role === "STAFF") {
    where.OR = [{ audience: "STAFF_MEMBER" }, { audienceUserId: req.actor!.userId }];
  }
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
});

notificationsRouter.post("/:id/read", requirePermission("dashboard", "view"), async (req, res) => {
  try {
    const notification = await prisma.notification.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, notification.businessId, "notification");

    const updated = await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    res.json(updated);
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});
