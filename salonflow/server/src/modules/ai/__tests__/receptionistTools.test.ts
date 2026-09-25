jest.mock("../../../lib/prisma");
jest.mock("../../appointments/appointmentService");
jest.mock("../../conversations/conversationEngine");
jest.mock("../aiKnowledge");

import { prisma } from "../../../lib/prisma";
import { eventBus } from "../../../core/eventBus";
import { createAppointment, changeAppointmentStatus, rescheduleAppointment } from "../../appointments/appointmentService";
import { markEscalated } from "../../conversations/conversationEngine";
import { resolveClientQuestion } from "../aiKnowledge";
import {
  bookAppointment,
  getOwnAppointment,
  rescheduleOwnAppointment,
  cancelOwnAppointment,
  escalateToStaff,
  answerFromKnowledge,
  NotYourAppointmentError,
} from "../receptionistTools";
import { buildAppointment } from "../../../test-utils/factories";

const ctx = { businessId: "biz_1", clientId: "client_1", conversationId: "conv_1" };

beforeEach(() => {
  jest.spyOn(eventBus, "emit").mockResolvedValue(undefined);
});

describe("bookAppointment", () => {
  it("always books for the resolved conversation's client, never a client id the model might supply", async () => {
    (createAppointment as jest.Mock).mockResolvedValue(buildAppointment());

    await bookAppointment(ctx, {
      serviceId: "svc_1",
      staffId: "staff_1",
      startsAt: new Date("2026-08-27T14:00:00Z"),
      locationType: "SALON",
    });

    const callArgs = (createAppointment as jest.Mock).mock.calls[0][0];
    expect(callArgs.clientId).toBe("client_1");
    expect(callArgs.businessId).toBe("biz_1");
    expect(callArgs.bookingChannel).toBe("AI_RECEPTIONIST");
    expect(callArgs.actor).toEqual({ type: "AI" });
  });
});

describe("ownership scoping — the AI can only touch the resolved client's own appointments", () => {
  it("rejects fetching an appointment that belongs to a different client", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      buildAppointment({ businessId: "biz_1", clientId: "someone_else" })
    );

    await expect(getOwnAppointment(ctx, "appt_1")).rejects.toThrow(NotYourAppointmentError);
  });

  it("rejects fetching an appointment that belongs to a different business entirely", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      buildAppointment({ businessId: "other_biz", clientId: "client_1" })
    );

    await expect(getOwnAppointment(ctx, "appt_1")).rejects.toThrow(NotYourAppointmentError);
  });

  it("allows rescheduling when the appointment really does belong to this client", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      buildAppointment({ businessId: "biz_1", clientId: "client_1" })
    );
    (rescheduleAppointment as jest.Mock).mockResolvedValue(buildAppointment());

    await rescheduleOwnAppointment(ctx, { appointmentId: "appt_1", newStartsAt: new Date() });

    expect(rescheduleAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: "appt_1", actor: { type: "AI" } })
    );
  });

  it("blocks rescheduling someone else's appointment even if the client mentions its ID", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      buildAppointment({ businessId: "biz_1", clientId: "someone_else" })
    );

    await expect(rescheduleOwnAppointment(ctx, { appointmentId: "appt_1", newStartsAt: new Date() })).rejects.toThrow(
      NotYourAppointmentError
    );
    expect(rescheduleAppointment).not.toHaveBeenCalled();
  });

  it("cancels only through the real state machine, and only the client's own appointment", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      buildAppointment({ businessId: "biz_1", clientId: "client_1" })
    );
    (changeAppointmentStatus as jest.Mock).mockResolvedValue(buildAppointment({ status: "CANCELLED" }));

    await cancelOwnAppointment(ctx, { appointmentId: "appt_1" });

    expect(changeAppointmentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: "appt_1", newStatus: "CANCELLED", actor: { type: "AI" } })
    );
  });
});

describe("answerFromKnowledge", () => {
  it("delegates to the no-hallucination knowledge resolver, scoped to this business", async () => {
    (resolveClientQuestion as jest.Mock).mockResolvedValue({ answered: true, source: "SERVICE_DATA", answer: {} });

    await answerFromKnowledge(ctx, "How much are knotless braids?");

    expect(resolveClientQuestion).toHaveBeenCalledWith("biz_1", "How much are knotless braids?");
  });
});

describe("escalateToStaff", () => {
  it("marks the conversation escalated and emits the escalation event with conversation context preserved", async () => {
    (markEscalated as jest.Mock).mockResolvedValue({ id: "conv_1", status: "ESCALATED" });

    await escalateToStaff(ctx, { question: "Do you use Brazilian human-hair bundles?", reason: "Not in knowledge base" });

    expect(markEscalated).toHaveBeenCalledWith("conv_1", "Not in knowledge base");
    expect(eventBus.emit).toHaveBeenCalledWith(
      "ai.escalation_needed",
      "biz_1",
      expect.objectContaining({ question: "Do you use Brazilian human-hair bundles?", conversationId: "conv_1" })
    );
  });
});
