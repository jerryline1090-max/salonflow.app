jest.mock("../../lib/prisma");
jest.mock("../../modules/ai/receptionistOrchestrator");
jest.mock("../../modules/ai/assistantOrchestrator");
jest.mock("../../modules/ai/orchestratorFactory");
jest.mock("../../modules/integrations/integrationService");
jest.mock("../../modules/conversations/conversationEngine");
jest.mock("../../modules/appointments/appointmentService");
jest.mock("../../middleware/verifyMetaSignature", () => ({ verifyMetaSignature: () => mockSignature }));
const mockSignature = jest.fn((_req: any, _res: any, next: any) => next());

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { publicMessagingEnabled } from "../../middleware/publicMessaging";
import { publicChatRouter } from "../publicChat.routes";
import { webhooksRouter } from "../webhooks.routes";
import { integrationsRouter } from "../integrations.routes";
import { integrationsCallbackRouter } from "../integrationsCallback.routes";
import { conversationsRouter } from "../conversations.routes";
import { assistantRouter } from "../assistant.routes";
import { signTokenForCurrentUser } from "../../test-utils/authenticatedUser";
import { handleUnifiedMessage } from "../../modules/ai/receptionistOrchestrator";
import { askAssistant } from "../../modules/ai/assistantOrchestrator";
import * as factory from "../../modules/ai/orchestratorFactory";
import * as integration from "../../modules/integrations/integrationService";
import * as conversations from "../../modules/conversations/conversationEngine";
import * as appointments from "../../modules/appointments/appointmentService";
import { sendToClientChannel } from "../../modules/notifications/channelMessenger";

const original = process.env.PUBLIC_MESSAGING_ENABLED;
const unavailable = { error: "Messaging is currently unavailable." };
const owner = signTokenForCurrentUser({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
function app() {
  const api = express();
  api.use("/api/webhooks", webhooksRouter);
  api.use(express.json());
  api.use("/api/public", publicChatRouter);
  api.use("/api/integrations", integrationsCallbackRouter);
  api.use(authenticate);
  api.use("/api/integrations", integrationsRouter);
  api.use("/api/conversations", conversationsRouter);
  api.use("/api/assistant", assistantRouter);
  return api;
}
beforeEach(() => {
  delete process.env.PUBLIC_MESSAGING_ENABLED;
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});
afterAll(() => {
  if (original === undefined) delete process.env.PUBLIC_MESSAGING_ENABLED;
  else process.env.PUBLIC_MESSAGING_ENABLED = original;
});
function noMessagingWork() {
  expect(prisma.business.findUnique).not.toHaveBeenCalled();
  expect(prisma.integration.findFirst).not.toHaveBeenCalled();
  expect(prisma.conversation.create).not.toHaveBeenCalled();
  expect(prisma.conversationMessage.create).not.toHaveBeenCalled();
  expect(handleUnifiedMessage).not.toHaveBeenCalled();
  for (const module of [factory, integration, conversations, appointments])
    for (const fn of Object.values(module)) if (jest.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
}

it.each([undefined, "false", "1", "yes", "TRUE", " true", "true ", ""])("fails closed for flag %s before all public chat work", async value => {
  if (value !== undefined) process.env.PUBLIC_MESSAGING_ENABLED = value;
  expect(publicMessagingEnabled(value)).toBe(false);
  for (const business of ["biz_1", "missing"]) for (const sessionId of ["valid-looking", null]) {
    const res = await request(app()).post(`/api/public/${business}/chat`).send({ sessionId, text: "hello" });
    expect(res.status).toBe(503);
    expect(res.body).toEqual(unavailable);
  }
  noMessagingWork();
});
it("explicit true reaches existing website chat behavior with mocks only", async () => {
  process.env.PUBLIC_MESSAGING_ENABLED = "true";
  expect(publicMessagingEnabled("true")).toBe(true);
  (prisma.business.findUnique as jest.Mock).mockResolvedValue({ id: "biz_1" });
  (handleUnifiedMessage as jest.Mock).mockResolvedValue({ reply: "hello" });
  const res = await request(app()).post("/api/public/biz_1/chat").send({ sessionId: "session", text: "hello" });
  expect(res.status).toBe(200);
  expect(handleUnifiedMessage).toHaveBeenCalledTimes(1);
});
it.each(["whatsapp", "instagram"])("blocks %s GET/POST before handshake, parsing, signature or integration work", async provider => {
  const api = app();
  const get = await request(api).get(`/api/webhooks/${provider}`).query({ "hub.mode": "subscribe", "hub.challenge": "challenge" });
  const post = await request(api).post(`/api/webhooks/${provider}`).set("Content-Type", "application/json").send("{invalid");
  for (const res of [get, post]) { expect(res.status).toBe(503); expect(res.body).toEqual(unavailable); }
  expect(mockSignature).not.toHaveBeenCalled();
  noMessagingWork();
});
it.each(["whatsapp", "instagram"])("blocks %s setup including callback before state/provider processing", async provider => {
  const api = app();
  const responses = [
    await request(api).post(`/api/integrations/${provider}/connect`).set("Authorization", `Bearer ${owner}`),
    await request(api).get(`/api/integrations/${provider}/candidates`).set("Authorization", `Bearer ${owner}`),
    await request(api).post(`/api/integrations/${provider}/select-account`).set("Authorization", `Bearer ${owner}`).send({ externalId: "foreign" }),
    await request(api).get(`/api/integrations/${provider}/callback`).query({ code: "fixture", state: "invalid" }),
  ];
  for (const res of responses) { expect(res.status).toBe(503); expect(res.body).toEqual(unavailable); }
  noMessagingWork();
});
it("retains authenticated integration viewing/disconnect without enabling setup", async () => {
  (integration.listIntegrations as jest.Mock).mockResolvedValue([]);
  (integration.disconnectIntegration as jest.Mock).mockResolvedValue({ status: "DISCONNECTED" });
  expect((await request(app()).get("/api/integrations").set("Authorization", `Bearer ${owner}`)).status).toBe(200);
  expect((await request(app()).post("/api/integrations/whatsapp/disconnect").set("Authorization", `Bearer ${owner}`)).status).toBe(200);
  expect(integration.disconnectIntegration).toHaveBeenCalledWith("biz_1", "WHATSAPP_BUSINESS", "owner_1", expect.anything());
  expect((await request(app()).get("/api/integrations")).status).toBe(401);
});
it("blocks authenticated reply before lookup/write and shared outbound sender before provider work", async () => {
  const res = await request(app()).post("/api/conversations/known/reply").set("Authorization", `Bearer ${owner}`).send({ text: "hello" });
  expect(res.status).toBe(503);
  expect(res.body).toEqual(unavailable);
  expect(prisma.conversation.findUniqueOrThrow).not.toHaveBeenCalled();
  for (const channel of ["WHATSAPP", "INSTAGRAM", "WEBSITE"] as const)
    expect(await sendToClientChannel("biz_1", channel, "conversation", "user", "hello")).toEqual({ success: false, error: unavailable.error });
  noMessagingWork();
});
it("internal Assistant remains callable while messaging is disabled", async () => {
  (factory.resolveAssistantModelClient as jest.Mock).mockReturnValue({});
  (askAssistant as jest.Mock).mockResolvedValue({ reply: "internal answer" });
  const res = await request(app()).post("/api/assistant/ask").set("Authorization", `Bearer ${owner}`).send({ message: "help" });
  expect(res.status).toBe(200);
  expect(res.body.reply).toBe("internal answer");
  expect(askAssistant).toHaveBeenCalledTimes(1);
});

it("historical conversation reads and admin controls remain available while disabled", async () => {
  (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({ id: "known", businessId: "biz_1" });
  (prisma.conversation.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "known", businessId: "biz_1" });
  (conversations.takeOverConversation as jest.Mock).mockResolvedValue({ status: "HUMAN_HANDLING" });
  (conversations.returnConversationToAi as jest.Mock).mockResolvedValue({ status: "AI_HANDLING" });
  for (const path of ["/api/conversations", "/api/conversations/known"])
    expect((await request(app()).get(path).set("Authorization", `Bearer ${owner}`)).status).toBe(200);
  for (const action of ["takeover", "return-to-ai"])
    expect((await request(app()).post(`/api/conversations/known/${action}`).set("Authorization", `Bearer ${owner}`)).status).toBe(200);
  expect(handleUnifiedMessage).not.toHaveBeenCalled();
  expect(factory.buildWhatsAppDeps).not.toHaveBeenCalled();
  expect(factory.buildInstagramDeps).not.toHaveBeenCalled();
});

it.each(["whatsapp", "instagram"])("explicit true reaches %s webhook processing in mocked tests", async provider => {
  process.env.PUBLIC_MESSAGING_ENABLED = "true";
  (prisma.integration.findFirst as jest.Mock).mockResolvedValue(null);
  const body = provider === "whatsapp"
    ? { entry: [{ changes: [{ value: { metadata: { phone_number_id: "fixture" } } }] }] }
    : { entry: [{ id: "fixture" }] };
  const res = await request(app()).post(`/api/webhooks/${provider}`).send(body);
  expect(res.status).toBe(200);
  expect(mockSignature).toHaveBeenCalledTimes(1);
  expect(prisma.integration.findFirst).toHaveBeenCalledTimes(1);
});
