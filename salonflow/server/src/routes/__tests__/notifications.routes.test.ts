jest.mock("../../lib/prisma");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { notificationsRouter } from "../notifications.routes";
import { signToken } from "../../core/auth";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/notifications", notificationsRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
const managerToken = signToken({ sub: "manager_1", businessId: "biz_1", role: "MANAGER" });
const staffToken = signToken({ sub: "staff_1", businessId: "biz_1", role: "STAFF" });

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("GET /api/notifications", () => {
  it("scopes an OWNER's feed to their own business with no audience filter", async () => {
    (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

    await request(buildApp()).get("/api/notifications").set("Authorization", `Bearer ${ownerToken}`);

    const whereArg = (prisma.notification.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.businessId).toBe("biz_1");
    expect(whereArg.OR).toBeUndefined();
  });

  it("restricts a STAFF actor's feed to notifications actually meant for them", async () => {
    (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

    await request(buildApp()).get("/api/notifications").set("Authorization", `Bearer ${staffToken}`);

    const whereArg = (prisma.notification.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.OR).toEqual([{ audience: "STAFF_MEMBER", audienceUserId: null }, { audienceUserId: "staff_1" }]);
  });

  it("filters to unread only when requested", async () => {
    (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

    await request(buildApp()).get("/api/notifications?unreadOnly=true").set("Authorization", `Bearer ${ownerToken}`);

    expect((prisma.notification.findMany as jest.Mock).mock.calls[0][0].where.isRead).toBe(false);
  });

  it("caps the limit at 100 even if a larger value is requested", async () => {
    (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

    await request(buildApp()).get("/api/notifications?limit=99999").set("Authorization", `Bearer ${ownerToken}`);

    expect((prisma.notification.findMany as jest.Mock).mock.calls[0][0].take).toBe(100);
  });
});

describe("POST /api/notifications/:id/read", () => {
  it("403s marking a notification from a different business as read", async () => {
    const otherBusinessToken = signToken({ sub: "owner_2", businessId: "biz_2", role: "OWNER" });
    (prisma.notification.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "notif_1", businessId: "biz_1" });

    const res = await request(buildApp()).post("/api/notifications/notif_1/read").set("Authorization", `Bearer ${otherBusinessToken}`);

    expect(res.status).toBe(403);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it("marks a notification read within the actor's own business", async () => {
    (prisma.notification.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "notif_1", businessId: "biz_1", audience: "OWNER", audienceUserId: null });
    (prisma.notification.update as jest.Mock).mockResolvedValue({ id: "notif_1", isRead: true });

    const res = await request(buildApp()).post("/api/notifications/notif_1/read").set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: "notif_1" }, data: { isRead: true } });
  });

  it("allows a MANAGER to mark a business notification read under the existing manager visibility policy", async () => {
    (prisma.notification.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "notif_1", businessId: "biz_1", audience: "OWNER", audienceUserId: null });
    (prisma.notification.update as jest.Mock).mockResolvedValue({ id: "notif_1", isRead: true });

    const res = await request(buildApp()).post("/api/notifications/notif_1/read").set("Authorization", `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
  });

  it("allows STAFF to mark a notification addressed specifically to them read", async () => {
    (prisma.notification.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "notif_1", businessId: "biz_1", audience: "STAFF_MEMBER", audienceUserId: "staff_1" });
    (prisma.notification.update as jest.Mock).mockResolvedValue({ id: "notif_1", isRead: true });

    const res = await request(buildApp()).post("/api/notifications/notif_1/read").set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
  });

  it.each([
    { audience: "OWNER", audienceUserId: null },
    { audience: "STAFF_MEMBER", audienceUserId: "another_staff" },
  ])("forbids STAFF from marking an unreadable notification read", async (notification) => {
    (prisma.notification.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "notif_1", businessId: "biz_1", ...notification });

    const res = await request(buildApp()).post("/api/notifications/notif_1/read").set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });
});
