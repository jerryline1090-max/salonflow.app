jest.mock("../../../lib/prisma");
jest.mock("../../../core/auditLog");
jest.mock("../../conversations/conversationEngine");
jest.mock("../../notifications/channelMessenger");

import { prisma } from "../../../lib/prisma";
import { eventBus } from "../../../core/eventBus";
import { writeAuditLog } from "../../../core/auditLog";
import { appendOutboundMessage } from "../../conversations/conversationEngine";
import { sendToClientChannel } from "../../notifications/channelMessenger";
import {
  queuePendingReputationRequests,
  sendPendingReputationRequests,
  recordReputationResponse,
  resolveReputationRequest,
} from "../reputationService";
import { buildBusiness, buildAppointment, buildClient } from "../../../test-utils/factories";

beforeEach(() => {
  jest.spyOn(eventBus, "emit").mockResolvedValue(undefined);
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
});

describe("queuePendingReputationRequests", () => {
  it("skips businesses with the reputation engine disabled", async () => {
    (prisma.business.findMany as jest.Mock).mockResolvedValue([buildBusiness({ reputationEnabled: false })]);

    const result = await queuePendingReputationRequests();

    expect(result).toEqual({ queued: 0 });
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it("only queries appointments past the configured delay and without an existing request", async () => {
    (prisma.business.findMany as jest.Mock).mockResolvedValue([
      buildBusiness({ id: "biz_1", reputationEnabled: true, reputationRequestDelayHours: 2 }),
    ]);
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([buildAppointment({ id: "appt_1", clientId: "client_1" })]);
    (prisma.reputationRequest.create as jest.Mock).mockResolvedValue({ id: "req_1" });

    const result = await queuePendingReputationRequests();

    const whereArg = (prisma.appointment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.status).toBe("COMPLETED");
    expect(whereArg.reputationRequest).toBeNull();
    expect(whereArg.updatedAt.lte).toBeInstanceOf(Date);
    expect(result).toEqual({ queued: 1 });
  });

  it("scopes to a single business when businessId is provided", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue(buildBusiness({ id: "biz_1", reputationEnabled: true }));
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    await queuePendingReputationRequests("biz_1");

    expect(prisma.business.findMany).not.toHaveBeenCalled();
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: "biz_1" }) }));
  });
});

describe("sendPendingReputationRequests", () => {
  it("marks a request EXPIRED when the client has no WhatsApp/Instagram conversation to reach them through", async () => {
    (prisma.reputationRequest.findMany as jest.Mock).mockResolvedValue([
      { id: "req_1", businessId: "biz_1", appointment: buildAppointment({ client: buildClient(), service: {}, staff: {} }) },
    ]);
    (prisma.conversation.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await sendPendingReputationRequests("biz_1");

    expect(prisma.reputationRequest.update).toHaveBeenCalledWith({ where: { id: "req_1" }, data: { status: "EXPIRED" } });
    expect(result).toEqual({ sent: 0, skipped: 1 });
  });

  it("sends through the client's existing conversation, records the outbound message, and marks SENT", async () => {
    const appointment = buildAppointment({
      client: buildClient({ name: "Sarah" }),
      service: { name: "Knotless Braids" },
      staff: { name: "Ada" },
    });
    (prisma.reputationRequest.findMany as jest.Mock).mockResolvedValue([{ id: "req_1", businessId: "biz_1", appointment }]);
    (prisma.conversation.findFirst as jest.Mock).mockResolvedValue({
      id: "conv_1",
      channel: "WHATSAPP",
      externalConversationId: "phone:234800",
      externalUserId: "234800",
    });
    (sendToClientChannel as jest.Mock).mockResolvedValue({ success: true });

    const result = await sendPendingReputationRequests("biz_1");

    expect(appendOutboundMessage).toHaveBeenCalledWith(
      "conv_1",
      expect.objectContaining({ actorType: "AI", relatedAppointmentId: appointment.id })
    );
    const sentText = (appendOutboundMessage as jest.Mock).mock.calls[0][1].text;
    expect(sentText).toContain("Sarah");
    expect(sentText).toContain("Knotless Braids");
    expect(sentText).toContain("Ada");
    expect(prisma.reputationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT", conversationId: "conv_1" }) })
    );
    expect(result).toEqual({ sent: 1, skipped: 0 });
  });

  it("leaves the request PENDING (for retry) rather than marking it sent when delivery fails", async () => {
    (prisma.reputationRequest.findMany as jest.Mock).mockResolvedValue([
      { id: "req_1", businessId: "biz_1", appointment: buildAppointment({ client: buildClient(), service: {}, staff: {} }) },
    ]);
    (prisma.conversation.findFirst as jest.Mock).mockResolvedValue({
      id: "conv_1",
      channel: "WHATSAPP",
      externalConversationId: "x",
      externalUserId: "y",
    });
    (sendToClientChannel as jest.Mock).mockResolvedValue({ success: false, error: "WhatsApp down" });

    const result = await sendPendingReputationRequests("biz_1");

    expect(prisma.reputationRequest.update).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, skipped: 1 });
  });
});

describe("recordReputationResponse", () => {
  it("returns handled:false when there's no pending request for this conversation (the overwhelming common case)", async () => {
    (prisma.reputationRequest.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await recordReputationResponse("conv_1", "biz_1", "I want braids tomorrow");

    expect(result).toEqual({ handled: false });
  });

  it("treats a numeric rating at/above the happy threshold as HAPPY and offers the configured Google review link", async () => {
    (prisma.reputationRequest.findFirst as jest.Mock).mockResolvedValue({ id: "req_1", appointmentId: "appt_1", clientId: "client_1" });
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      buildBusiness({ reputationHappyThreshold: 4, googleReviewUrl: "https://g.page/r/big-kitchen/review" })
    );

    const result = await recordReputationResponse("conv_1", "biz_1", "5, loved it!");

    expect(prisma.reputationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RESPONDED", sentiment: "HAPPY", rating: 5 }) })
    );
    expect(result.reply).toContain("https://g.page/r/big-kitchen/review");
    expect(eventBus.emit).toHaveBeenCalledWith(
      "reputation.response_received",
      "biz_1",
      expect.objectContaining({ sentiment: "HAPPY", rating: 5 })
    );
  });

  it("never invents a review link when none is configured", async () => {
    (prisma.reputationRequest.findFirst as jest.Mock).mockResolvedValue({ id: "req_1", appointmentId: "appt_1", clientId: "client_1" });
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildBusiness({ reputationHappyThreshold: 4, googleReviewUrl: null }));

    const result = await recordReputationResponse("conv_1", "biz_1", "5 stars!");

    expect(result.reply).not.toMatch(/http/);
  });

  it("treats a low rating as UNHAPPY and routes privately — never mentions a public review", async () => {
    (prisma.reputationRequest.findFirst as jest.Mock).mockResolvedValue({ id: "req_1", appointmentId: "appt_1", clientId: "client_1" });
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      buildBusiness({ reputationHappyThreshold: 4, googleReviewUrl: "https://g.page/review" })
    );

    const result = await recordReputationResponse("conv_1", "biz_1", "2, not great honestly");

    expect(result.reply).not.toMatch(/http/);
    expect(result.reply).toMatch(/salon will reach out/i);
    expect(eventBus.emit).toHaveBeenCalledWith("reputation.response_received", "biz_1", expect.objectContaining({ sentiment: "UNHAPPY" }));
  });

  it("falls back to keyword sentiment when there's no numeric rating", async () => {
    (prisma.reputationRequest.findFirst as jest.Mock).mockResolvedValue({ id: "req_1", appointmentId: "appt_1", clientId: "client_1" });
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildBusiness({ reputationHappyThreshold: 4 }));

    const happy = await recordReputationResponse("conv_1", "biz_1", "It was amazing, thank you!");
    const unhappy = await recordReputationResponse("conv_1", "biz_1", "Honestly it was pretty disappointing");

    expect((prisma.reputationRequest.update as jest.Mock).mock.calls[0][0].data.sentiment).toBe("HAPPY");
    expect((prisma.reputationRequest.update as jest.Mock).mock.calls[1][0].data.sentiment).toBe("UNHAPPY");
  });

  it("treats genuinely ambiguous feedback as NEUTRAL and still notifies (via the event) without pushing a review", async () => {
    (prisma.reputationRequest.findFirst as jest.Mock).mockResolvedValue({ id: "req_1", appointmentId: "appt_1", clientId: "client_1" });
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildBusiness({ reputationHappyThreshold: 4, googleReviewUrl: "https://g.page/review" }));

    const result = await recordReputationResponse("conv_1", "biz_1", "it was fine I guess");

    expect((prisma.reputationRequest.update as jest.Mock).mock.calls[0][0].data.sentiment).toBe("NEUTRAL");
    expect(result.reply).not.toMatch(/http/);
  });

  it("never alters the client's own words when storing feedbackText", async () => {
    (prisma.reputationRequest.findFirst as jest.Mock).mockResolvedValue({ id: "req_1", appointmentId: "appt_1", clientId: "client_1" });
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildBusiness({ reputationHappyThreshold: 4 }));

    const original = "Ada was AMAZING but the wait was too long tbh";
    await recordReputationResponse("conv_1", "biz_1", original);

    expect((prisma.reputationRequest.update as jest.Mock).mock.calls[0][0].data.feedbackText).toBe(original);
  });
});

describe("resolveReputationRequest", () => {
  it("rejects resolving a request from a different business", async () => {
    (prisma.reputationRequest.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "req_1", businessId: "other_biz" });

    await expect(resolveReputationRequest("req_1", "biz_1", "owner_1", "Called the client")).rejects.toThrow(/not found/i);
  });

  it("marks resolved with notes and audits it", async () => {
    (prisma.reputationRequest.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "req_1", businessId: "biz_1" });
    (prisma.reputationRequest.update as jest.Mock).mockResolvedValue({ id: "req_1", resolvedAt: new Date() });

    await resolveReputationRequest("req_1", "biz_1", "owner_1", "Called the client, offered a discount on next visit");

    expect(prisma.reputationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resolutionNotes: "Called the client, offered a discount on next visit" }) })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "resolve" }));
  });
});
