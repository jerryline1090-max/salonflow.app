jest.mock("../../../lib/prisma");
jest.mock("../../../core/auditLog");

import { prisma } from "../../../lib/prisma";
import { writeAuditLog } from "../../../core/auditLog";
import { createService, updateService, deactivateService } from "../serviceService";
import { buildService } from "../../../test-utils/factories";

beforeEach(() => {
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
});

describe("createService", () => {
  it("rejects a negative price", async () => {
    await expect(
      createService({ businessId: "biz_1", name: "X", price: -100, durationMinutes: 30, actorUserId: "u1" })
    ).rejects.toThrow(/negative/i);
    expect(prisma.service.create).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative duration", async () => {
    await expect(
      createService({ businessId: "biz_1", name: "X", price: 1000, durationMinutes: 0, actorUserId: "u1" })
    ).rejects.toThrow(/duration/i);
  });

  it("rejects a service offered at neither the salon nor at home", async () => {
    await expect(
      createService({
        businessId: "biz_1",
        name: "X",
        price: 1000,
        durationMinutes: 30,
        availableAtSalon: false,
        availableAtHome: false,
        actorUserId: "u1",
      })
    ).rejects.toThrow(/salon, at home, or both/i);
  });

  it("creates the service and writes an audit entry", async () => {
    const created = buildService();
    (prisma.service.create as jest.Mock).mockResolvedValue(created);

    const result = await createService({
      businessId: "biz_1",
      name: "Knotless Braids",
      price: 4_000_000,
      durationMinutes: 180,
      actorUserId: "u1",
    });

    expect(result).toBe(created);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ resource: "service", action: "create" }));
  });
});

describe("updateService", () => {
  it("rejects updating a service that belongs to a different business", async () => {
    (prisma.service.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildService({ businessId: "other_biz" }));

    await expect(
      updateService({ serviceId: "svc_1", businessId: "biz_1", actorUserId: "u1", updates: { name: "New Name" } })
    ).rejects.toThrow(/not found/i);
    expect(prisma.service.update).not.toHaveBeenCalled();
  });

  it("re-validates price/duration on update", async () => {
    (prisma.service.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildService({ businessId: "biz_1" }));

    await expect(
      updateService({ serviceId: "svc_1", businessId: "biz_1", actorUserId: "u1", updates: { price: -1 } })
    ).rejects.toThrow(/negative/i);
  });

  it("rejects flipping both location flags off", async () => {
    (prisma.service.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      buildService({ businessId: "biz_1", availableAtSalon: true, availableAtHome: false })
    );

    await expect(
      updateService({ serviceId: "svc_1", businessId: "biz_1", actorUserId: "u1", updates: { availableAtSalon: false } })
    ).rejects.toThrow(/salon, at home, or both/i);
  });

  it("applies a valid update and logs previous/new values", async () => {
    const existing = buildService({ businessId: "biz_1", price: 4_000_000 });
    (prisma.service.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);
    (prisma.service.update as jest.Mock).mockResolvedValue({ ...existing, price: 5_000_000 });

    const updated = await updateService({ serviceId: "svc_1", businessId: "biz_1", actorUserId: "u1", updates: { price: 5_000_000 } });

    expect(updated.price).toBe(5_000_000);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ previousValue: existing, newValue: expect.objectContaining({ price: 5_000_000 }) })
    );
  });
});

describe("deactivateService", () => {
  it("soft-deletes via isActive:false rather than removing the row", async () => {
    const existing = buildService({ businessId: "biz_1" });
    (prisma.service.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);
    (prisma.service.update as jest.Mock).mockResolvedValue({ ...existing, isActive: false });

    await deactivateService("svc_1", "biz_1", "u1");

    expect(prisma.service.update).toHaveBeenCalledWith({ where: { id: "svc_1", businessId: "biz_1" }, data: { isActive: false } });
    expect(prisma.service.delete).not.toHaveBeenCalled();
  });
});
