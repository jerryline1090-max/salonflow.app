jest.mock("../../lib/prisma");
jest.mock("../auditLog");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../auditLog";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";
import { authenticate } from "../../middleware/authenticate";
import { staffRouter } from "../../routes/staff.routes";
import { servicesRouter } from "../../routes/services.routes";
import { clientsRouter } from "../../routes/clients.routes";
import { knowledgeBaseRouter } from "../../routes/knowledgeBase.routes";
import { settingsRouter } from "../../routes/settings.routes";
import { updateStaffProfile, createStaffProfile } from "../../modules/staff/staffProfile";
import { updateService } from "../../modules/services/serviceService";
import { updateClient } from "../../modules/clients/clientService";
import { updateKnowledgeBaseEntry } from "../../modules/ai/knowledgeBaseService";
import { saveBusinessHours } from "../../modules/settings/businessHoursService";

const actor = { businessId: "business_A", actorUserId: "owner_A" };
const attacks = [
  { businessId: "business_B" }, { id: "record_B" }, { userId: "user_B" },
  { business: { connect: { id: "business_B" } } },
  { user: { update: { role: "OWNER", email: "changed", passwordHash: "changed", businessId: "business_B" } } },
  { permissions: { create: { canEdit: true } } },
  { appointments: { deleteMany: {} } }, { payments: { delete: { id: "payment_B" } } },
  { conversations: { update: { id: "conversation_B" } } },
  { channelIdentities: { create: {} } }, { schedule: { create: {} } }, { services: { connect: { id: "service_B" } } },
  { createdAt: "2020-01-01" }, { updatedAt: "2020-01-01" }, { unknown: { nested: true } },
  ...["connect", "disconnect", "update", "upsert", "create", "delete", "set"].map((key) => ({ [key]: { id: "record_B" } })),
];
const resources = [
  { name: "staff", model: "staff", route: "/staff", router: staffRouter, valid: { name: "Updated", phone: null, photoUrl: null, skills: ["braids"], homeServiceEligible: true, commissionPercent: null }, run: (id: string, updates: any) => updateStaffProfile({ ...actor, staffId: id, updates }) },
  { name: "service", model: "service", route: "/services", router: servicesRouter, valid: { name: "Updated", description: null, category: null, imageUrl: null, price: 1000, durationMinutes: 30, bufferMinutes: 5, availableAtSalon: true, availableAtHome: false, homeTravelBufferMins: null, requiredSkills: ["braids"], isActive: false }, run: (id: string, updates: any) => updateService({ ...actor, serviceId: id, updates }) },
  { name: "client", model: "client", route: "/clients", router: clientsRouter, valid: { name: "Updated", phone: null, email: null, address: null, notes: null }, run: (id: string, updates: any) => updateClient({ ...actor, clientId: id, updates }) },
  { name: "knowledge", model: "knowledgeBaseEntry", route: "/knowledge", router: knowledgeBaseRouter, valid: { topic: "Updated", question: null, answer: "Answer" }, run: (id: string, updates: any) => updateKnowledgeBaseEntry({ ...actor, entryId: id, updates }) },
];

function app(path: string, router: express.Router) {
  return express().use(express.json()).use(authenticate).use(path, router);
}
const token = signToken({ sub: "owner_A", businessId: "business_A", role: "OWNER" });

describe.each(resources)("$name runtime write boundary", (resource) => {
  let state: any[];
  let protectedRelations: any;
  let before: string;
  let model: any;
  beforeEach(() => {
    state = ["A", "B"].map((suffix) => ({ id: `record_${suffix}`, businessId: `business_${suffix}`, name: "Before", availableAtSalon: true, availableAtHome: false, price: 1000, durationMinutes: 30 }));
    protectedRelations = { user: { role: "STAFF", email: "unchanged", passwordHash: "unchanged", businessId: "business_A" }, permissions: [], appointments: [], payments: [], conversations: [] };
    before = JSON.stringify({ state, protectedRelations });
    model = (prisma as any)[resource.model];
    model.findUniqueOrThrow.mockImplementation(async ({ where }: any) => state.find((row) => row.id === where.id));
    model.update.mockImplementation(async ({ where, data }: any) => {
      const row = state.find((item) => item.id === where.id && item.businessId === where.businessId);
      if (!row) throw new Error("Not found");
      Object.entries(data).forEach(([key, value]) => { if (value !== undefined) row[key] = value; });
      return row;
    });
  });

  it.each(attacks)("rejects hostile fields %j without protected-state changes", async (attack) => {
    await expect(resource.run("record_A", { ...resource.valid, ...attack })).rejects.toThrow("Invalid editable fields");
    expect(model.update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(JSON.stringify({ state, protectedRelations })).toBe(before);
  });
  it("rejects scalar Prisma operators", async () => {
    const key = resource.name === "knowledge" ? "topic" : "name";
    await expect(resource.run("record_A", { [key]: { set: "Injected" } })).rejects.toThrow("Invalid editable fields");
    expect(JSON.stringify({ state, protectedRelations })).toBe(before);
  });
  it("rejects another business record without changing either business", async () => {
    await expect(resource.run("record_B", resource.valid)).rejects.toThrow(/not found for this business/);
    expect(model.update).not.toHaveBeenCalled();
    expect(JSON.stringify({ state, protectedRelations })).toBe(before);
  });
  it("fences a stale ownership check at the mutation itself", async () => {
    model.findUniqueOrThrow.mockImplementation(async () => {
      const snapshot = { ...state[0] };
      state[0].businessId = "business_B";
      return snapshot;
    });
    await expect(resource.run("record_A", resource.valid)).rejects.toThrow("Not found");
    expect(state[0].name).toBe("Before");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
  it("preserves every allowed scalar/null edit and scopes the actual mutation", async () => {
    const other = JSON.stringify(state[1]);
    const relations = JSON.stringify(protectedRelations);
    await resource.run("record_A", resource.valid);
    expect(state[0]).toMatchObject(resource.valid);
    expect(model.update).toHaveBeenCalledWith({ where: { id: "record_A", businessId: "business_A" }, data: expect.objectContaining(resource.valid) });
    expect(JSON.stringify(state[1])).toBe(other);
    expect(JSON.stringify(protectedRelations)).toBe(relations);
  });
  it("returns a safe HTTP 400 for hostile input", async () => {
    const res = await request(app(resource.route, resource.router)).put(`${resource.route}/record_A`).set("Authorization", `Bearer ${token}`).send({ ...resource.valid, business: { connect: { id: "secret-value" } } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid editable fields" });
    expect(model.update).not.toHaveBeenCalled();
  });
});

const hour = { dayOfWeek: 1, openTime: "09:00", closeTime: "18:00", isClosed: false };
describe("business hours natural-key isolation", () => {
  it.each(attacks)("rejects injected row fields %j before any mutation", async (attack) => {
    await expect(saveBusinessHours(actor.businessId, actor.actorUserId, [{ ...hour, ...attack }])).rejects.toThrow("Invalid editable fields");
    expect(prisma.businessHours.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
  it.each([{ dayOfWeek: -1 }, { dayOfWeek: 7 }, { dayOfWeek: 1.5 }, { isClosed: "false" }, { openTime: "25:00" }, { closeTime: "9:00" }, { closeTime: "08:00" }, { openTime: { set: "09:00" } }])("rejects malformed hours %j", async (invalid) => {
    await expect(saveBusinessHours(actor.businessId, actor.actorUserId, [{ ...hour, ...invalid } as any])).rejects.toThrow("Invalid editable fields");
    expect(prisma.businessHours.upsert).not.toHaveBeenCalled();
  });
  it("preserves partial-week Settings saves and never changes business B", async () => {
    const rows = [{ ...hour, businessId: "business_A" }, { ...hour, businessId: "business_B" }];
    const other = JSON.stringify(rows[1]);
    (prisma.businessHours.upsert as jest.Mock).mockImplementation(({ where, update }) => {
      const row = rows.find((value) => value.businessId === where.businessId_dayOfWeek.businessId && value.dayOfWeek === where.businessId_dayOfWeek.dayOfWeek)!;
      Object.assign(row, update); return Promise.resolve(row);
    });
    await saveBusinessHours(actor.businessId, actor.actorUserId, [{ ...hour, openTime: "10:00" }]);
    expect(rows[0].openTime).toBe("10:00");
    expect(JSON.stringify(rows[1])).toBe(other);
    expect(prisma.businessHours.upsert).toHaveBeenCalledWith({ where: { businessId_dayOfWeek: { businessId: "business_A", dayOfWeek: 1 } }, create: { ...hour, openTime: "10:00", businessId: "business_A" }, update: { openTime: "10:00", closeTime: "18:00", isClosed: false } });
  });
  it("accepts seven valid days, including closed days with equal times", async () => {
    await saveBusinessHours(actor.businessId, actor.actorUserId, Array.from({ length: 7 }, (_, dayOfWeek) => ({ ...hour, dayOfWeek, isClosed: true, closeTime: "09:00" })));
    expect(prisma.businessHours.upsert).toHaveBeenCalledTimes(7);
  });
  it("returns safe 400 for injected row identity", async () => {
    const res = await request(app("/settings", settingsRouter)).put("/settings/working-hours").set("Authorization", `Bearer ${token}`).send({ hours: [{ ...hour, id: "record_B" }] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid editable fields" });
  });
});

describe("staff creation nested schedule", () => {
  it.each([...attacks, { staffId: "staff_business_B" }, { staff: { connect: { id: "staff_business_B" } } }])("rejects unprojected nested writes %j", async (attack) => {
    await expect(createStaffProfile({ ...actor, name: "Valid", schedule: [{ dayOfWeek: 1, startTime: "09:00", endTime: "18:00", ...attack }] })).rejects.toThrow("Invalid editable fields");
    expect(prisma.staff.create).not.toHaveBeenCalled();
    expect(prisma.staffSchedule.create).not.toHaveBeenCalled();
    expect(prisma.staffSchedule.upsert).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
  it("projects valid nested schedule fields only", async () => {
    (prisma.staff.create as jest.Mock).mockResolvedValue({ id: "new_staff" });
    await createStaffProfile({ ...actor, name: "Valid", schedule: [{ dayOfWeek: 1, startTime: "09:00", endTime: "18:00" }] });
    expect(prisma.staff.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ businessId: "business_A", schedule: { create: [{ dayOfWeek: 1, startTime: "09:00", endTime: "18:00", isOff: false }] } }) }));
  });
});

describe("business Settings scalar projection", () => {
  beforeEach(() => { (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "business_A" }); });
  it("rejects an enumerable __proto__ field from ordinary HTTP JSON without producing write data", async () => {
    // Send raw JSON: an object-literal __proto__ would change the fixture's
    // prototype instead of representing an enumerable JSON request property.
    const json = '{"name":"Valid","__proto__":{"r1Injected":true}}';
    expect(Object.prototype.propertyIsEnumerable.call(JSON.parse(json), "__proto__")).toBe(true);
    const res = await request(app("/settings", settingsRouter)).put("/settings")
      .set("Authorization", `Bearer ${token}`).set("Content-Type", "application/json").send(json);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid editable fields" });
    expect(prisma.business.update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(Object.prototype.hasOwnProperty.call(res.body, "__proto__")).toBe(false);
    expect(({} as Record<string, unknown>).r1Injected).toBeUndefined();
  });
  it.each([...attacks, { name: { set: "Changed" } }, { defaultBufferMinutes: { increment: 1 } }])("rejects unsupported fields/operators %j", async (attack) => {
    const res = await request(app("/settings", settingsRouter)).put("/settings").set("Authorization", `Bearer ${token}`).send({ name: "Valid", ...attack });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid editable fields" });
    expect(prisma.business.update).not.toHaveBeenCalled();
  });
  it("allows existing scalar Settings edits with server-owned business ID", async () => {
    const res = await request(app("/settings", settingsRouter)).put("/settings").set("Authorization", `Bearer ${token}`).send({ name: "Valid", phone: null, defaultBufferMinutes: 5, reputationEnabled: false });
    expect(res.status).toBe(200);
    expect(prisma.business.update).toHaveBeenCalledWith({ where: { id: "business_A" }, data: { name: "Valid", phone: null, defaultBufferMinutes: 5, reputationEnabled: false } });
  });
});
