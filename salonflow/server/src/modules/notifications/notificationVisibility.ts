import { NotificationAudience, Role } from "@prisma/client";

export interface NotificationActor {
  businessId?: string;
  userId: string;
  role: Role;
}

export interface NotificationTarget {
  businessId: string;
  audience: NotificationAudience;
  audienceUserId: string | null;
}

/** One audience policy shared by notification listing and mark-read. */
export function notificationVisibilityWhere(actor: NotificationActor) {
  const where: Record<string, unknown> = { businessId: actor.businessId };
  if (actor.role === "STAFF") {
    where.OR = [
      { audience: "STAFF_MEMBER", audienceUserId: null },
      { audienceUserId: actor.userId },
    ];
  }
  return where;
}

export function canViewNotification(actor: NotificationActor, notification: NotificationTarget) {
  if (actor.businessId !== notification.businessId) return false;
  if (actor.role !== "STAFF") return true;
  return (notification.audience === "STAFF_MEMBER" && notification.audienceUserId === null) || notification.audienceUserId === actor.userId;
}
