jest.mock("../../../lib/prisma");
jest.mock("../../conversations/conversationEngine");
jest.mock("../receptionistTools");
jest.mock("../../reputation/reputationService");

import { prisma } from "../../../lib/prisma";
import { eventBus } from "../../../core/eventBus";
import {
  ingestInboundMessage,
  getRecentContext,
  updateMessageProcessing,
  appendOutboundMessage,
} from "../../conversations/conversationEngine";
import * as tools from "../receptionistTools";
import { handleUnifiedMessage, OrchestratorDeps } from "../receptionistOrchestrator";
import { UnifiedInboundMessage } from "../channels/types";
import { AiModelClient, ModelDecision } from "../aiModelClient";
import { recordReputationResponse } from "../../reputation/reputationService";

const baseMsg: UnifiedInboundMessage = {
  channel: "WHATSAPP",
  businessId: "biz_1",
  externalConversationId: "phone:2348000000000",
  externalUserId: "2348000000000",
  externalMessageId: "wamid.1",
  type: "TEXT",
  text: "I want braids tomorrow",
  receivedAt: new Date(),
};

function buildConversation(overrides: Partial<any> = {}) {
  return {
    id: "conv_1",
    businessId: "biz_1",
    clientId: "client_1",
    status: "AI_HANDLING",
    externalConversationId: "phone:2348000000000",
    externalUserId: "2348000000000",
    ...overrides,
  };
}

function buildMessage(overrides: Partial<any> = {}) {
  return { id: "msg_1", type: "TEXT", text: "I want braids tomorrow", mediaSecureRef: null, mediaType: null, ...overrides };
}

class ScriptedModelClient implements AiModelClient {
  private calls = 0;
  constructor(private script: ModelDecision[]) {}
  async decide(): Promise<ModelDecision> {
    const decision = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls++;
    return decision;
  }
}

function buildDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    modelClient: new ScriptedModelClient([{ kind: "reply", text: "default reply" }]),
    channelAdapter: { channel: "WHATSAPP", normalizeInbound: jest.fn(), sendOutbound: jest.fn().mockResolvedValue({ success: true }) },
    mediaStore: { downloadAndStore: jest.fn(), getTemporaryAccessUrl: jest.fn().mockResolvedValue("https://media/x"), purgeExpired: jest.fn() },
    speechToText: { transcribe: jest.fn() },
    mediaUnderstanding: { describeImage: jest.fn(), describeVideo: jest.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  jest.spyOn(eventBus, "emit").mockResolvedValue(undefined);
  (getRecentContext as jest.Mock).mockResolvedValue([{ actorType: "CLIENT", text: "I want braids tomorrow" }]);
  (appendOutboundMessage as jest.Mock).mockResolvedValue({ id: "out_1" });
  (updateMessageProcessing as jest.Mock).mockResolvedValue({});
  (prisma.conversationMessage.update as jest.Mock).mockResolvedValue({});
  // Default: not a reputation-response conversation, so existing tests
  // exercise the normal tool-calling loop unless they override this.
  (recordReputationResponse as jest.Mock).mockResolvedValue({ handled: false });
});

describe("human takeover", () => {
  it("does not invoke the model at all once a staff member has taken over the conversation", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({
      conversation: buildConversation({ status: "HUMAN_HANDLING" }),
      message: buildMessage(),
    });
    const decideSpy = jest.fn();
    const deps = buildDeps({ modelClient: { decide: decideSpy } });

    const result = await handleUnifiedMessage(baseMsg, deps);

    expect(result.handled).toBe(false);
    expect(decideSpy).not.toHaveBeenCalled();
    expect(appendOutboundMessage).not.toHaveBeenCalled();
  });
});

describe("tool-calling loop", () => {
  it("executes a tool call, feeds the result back, and sends the model's final reply", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({ conversation: buildConversation(), message: buildMessage() });
    (tools.searchServices as jest.Mock).mockResolvedValue([{ id: "svc_1", name: "Knotless Braids" }]);

    const modelClient = new ScriptedModelClient([
      { kind: "tool_call", tool: "searchServices", args: { query: "braids" } },
      { kind: "reply", text: "We offer Knotless Braids." },
    ]);
    const deps = buildDeps({ modelClient });

    const result = await handleUnifiedMessage(baseMsg, deps);

    expect(tools.searchServices).toHaveBeenCalledWith(expect.objectContaining({ businessId: "biz_1", clientId: "client_1" }), "braids");
    expect(appendOutboundMessage).toHaveBeenCalledWith("conv_1", { text: "We offer Knotless Braids.", actorType: "AI" });
    expect(deps.channelAdapter.sendOutbound).toHaveBeenCalledWith({
      externalConversationId: "phone:2348000000000",
      externalUserId: "2348000000000",
      text: "We offer Knotless Braids.",
    });
    expect(result.reply).toBe("We offer Knotless Braids.");
    expect(result.escalated).toBe(false);
  });

  it("feeds a tool error back into the loop instead of crashing the conversation", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({ conversation: buildConversation(), message: buildMessage() });
    (tools.getOwnAppointment as jest.Mock).mockRejectedValue(new Error("not found"));

    const modelClient = new ScriptedModelClient([
      { kind: "tool_call", tool: "getOwnAppointment", args: { appointmentId: "ghost" } },
      { kind: "reply", text: "I couldn't find that appointment." },
    ]);
    const deps = buildDeps({ modelClient });

    const result = await handleUnifiedMessage(baseMsg, deps);

    expect(result.reply).toBe("I couldn't find that appointment.");
  });
});

describe("explicit escalation", () => {
  it("escalates via the tool, marks the conversation, and replies with the natural fallback — not a fabricated answer", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({ conversation: buildConversation(), message: buildMessage() });
    const modelClient = new ScriptedModelClient([{ kind: "escalate", reason: "Client asked something outside the knowledge base" }]);
    const deps = buildDeps({ modelClient });

    const result = await handleUnifiedMessage(baseMsg, deps);

    expect(tools.escalateToStaff).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv_1" }),
      expect.objectContaining({ reason: "Client asked something outside the knowledge base" })
    );
    expect(result.escalated).toBe(true);
    expect(result.reply).toMatch(/let the team know/i);
  });
});

describe("safety-net escalation", () => {
  it("force-escalates rather than looping forever or replying ungrounded when the model never resolves", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({ conversation: buildConversation(), message: buildMessage() });
    (tools.searchServices as jest.Mock).mockResolvedValue([]);
    // Always another tool call, never "reply" or "escalate" — must not spin forever.
    const modelClient = new ScriptedModelClient([{ kind: "tool_call", tool: "searchServices", args: {} }]);
    const deps = buildDeps({ modelClient });

    const result = await handleUnifiedMessage(baseMsg, deps);

    expect(tools.escalateToStaff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: expect.stringMatching(/could not resolve/i) })
    );
    expect(result.escalated).toBe(true);
  });
});

describe("voice notes", () => {
  it("transcribes successfully and proceeds into the normal tool-calling loop", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({
      conversation: buildConversation(),
      message: buildMessage({ type: "VOICE", text: null, mediaSecureRef: "local:abc", mediaType: "audio/ogg" }),
    });
    const modelClient = new ScriptedModelClient([{ kind: "reply", text: "Got it, tomorrow works!" }]);
    const speechToText = { transcribe: jest.fn().mockResolvedValue({ text: "I want braids tomorrow around 2" }) };
    const deps = buildDeps({ modelClient, speechToText });

    const result = await handleUnifiedMessage({ ...baseMsg, type: "VOICE", text: undefined }, deps);

    expect(speechToText.transcribe).toHaveBeenCalled();
    expect(updateMessageProcessing).toHaveBeenCalledWith("msg_1", {
      transcription: "I want braids tomorrow around 2",
      mediaProcessingStatus: "PROCESSED",
    });
    expect(result.reply).toBe("Got it, tomorrow works!");
  });

  it("degrades gracefully and asks the client to type instead of guessing what was said", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({
      conversation: buildConversation(),
      message: buildMessage({ type: "VOICE", text: null, mediaSecureRef: "local:abc", mediaType: "audio/ogg" }),
    });
    const decideSpy = jest.fn();
    const speechToText = { transcribe: jest.fn().mockRejectedValue(new Error("STT unavailable")) };
    const deps = buildDeps({ modelClient: { decide: decideSpy }, speechToText });

    const result = await handleUnifiedMessage({ ...baseMsg, type: "VOICE", text: undefined }, deps);

    expect(decideSpy).not.toHaveBeenCalled(); // never guesses at unheard audio
    expect(updateMessageProcessing).toHaveBeenCalledWith("msg_1", { mediaProcessingStatus: "FAILED" });
    expect(result.reply).toMatch(/type it out/i);
  });
});

describe("media understanding — never asserts a guess as fact", () => {
  it("states the identified style plainly when confidence is high", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({
      conversation: buildConversation(),
      message: buildMessage({ type: "IMAGE", text: "I want this style", mediaSecureRef: "local:img", mediaType: "image/jpeg" }),
    });
    const mediaUnderstanding = {
      describeImage: jest.fn().mockResolvedValue({ description: "Boho Knotless Braids", confidence: 0.9 }),
      describeVideo: jest.fn(),
    };
    const modelClient = new ScriptedModelClient([{ kind: "reply", text: "That's our Boho Knotless Braids style!" }]);
    const deps = buildDeps({ modelClient, mediaUnderstanding });

    await handleUnifiedMessage({ ...baseMsg, type: "IMAGE", mediaSecureRef: "local:img", mediaMimeType: "image/jpeg" }, deps);

    const updateArg = (prisma.conversationMessage.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.data.text).toContain("Boho Knotless Braids");
    expect(updateArg.data.text).not.toMatch(/could not be confidently identified/i);
  });

  it("flags low-confidence identification instead of asserting a match", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({
      conversation: buildConversation(),
      message: buildMessage({ type: "IMAGE", text: null, mediaSecureRef: "local:img", mediaType: "image/jpeg" }),
    });
    const mediaUnderstanding = {
      describeImage: jest.fn().mockResolvedValue({ description: "uncertain hairstyle", confidence: 0.3 }),
      describeVideo: jest.fn(),
    };
    const modelClient = new ScriptedModelClient([{ kind: "reply", text: "Could you tell me the style name?" }]);
    const deps = buildDeps({ modelClient, mediaUnderstanding });

    await handleUnifiedMessage({ ...baseMsg, type: "IMAGE", mediaSecureRef: "local:img", mediaMimeType: "image/jpeg" }, deps);

    const updateArg = (prisma.conversationMessage.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.data.text).toMatch(/could not be confidently identified/i);
    expect(updateArg.data.text).toMatch(/do not guess/i);
  });

  it("treats a media-understanding failure the same as low confidence, not as a silent skip", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({
      conversation: buildConversation(),
      message: buildMessage({ type: "IMAGE", text: null, mediaSecureRef: "local:img", mediaType: "image/jpeg" }),
    });
    const mediaUnderstanding = { describeImage: jest.fn().mockRejectedValue(new Error("model down")), describeVideo: jest.fn() };
    const modelClient = new ScriptedModelClient([{ kind: "reply", text: "Could you describe the style?" }]);
    const deps = buildDeps({ modelClient, mediaUnderstanding });

    await handleUnifiedMessage({ ...baseMsg, type: "IMAGE", mediaSecureRef: "local:img", mediaMimeType: "image/jpeg" }, deps);

    expect(updateMessageProcessing).toHaveBeenCalledWith("msg_1", { mediaProcessingStatus: "FAILED" });
    const updateArg = (prisma.conversationMessage.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.data.text).toMatch(/could not be analyzed/i);
  });
});

describe("channel send failure", () => {
  it("records the failure via the event bus rather than pretending the reply went through", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({ conversation: buildConversation(), message: buildMessage() });
    const modelClient = new ScriptedModelClient([{ kind: "reply", text: "Sure thing!" }]);
    const channelAdapter = {
      channel: "WHATSAPP" as const,
      normalizeInbound: jest.fn(),
      sendOutbound: jest.fn().mockResolvedValue({ success: false, error: "WhatsApp API down" }),
    };
    const deps = buildDeps({ modelClient, channelAdapter });

    await handleUnifiedMessage(baseMsg, deps);

    expect(eventBus.emit).toHaveBeenCalledWith(
      "conversation.send_failed",
      "biz_1",
      expect.objectContaining({ conversationId: "conv_1", error: "WhatsApp API down" })
    );
  });
});

describe("reputation feedback responses short-circuit the normal tool loop", () => {
  it("when the conversation is awaiting feedback, sends the reputation reply and never calls the model", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({ conversation: buildConversation(), message: buildMessage({ text: "5, loved it!" }) });
    (recordReputationResponse as jest.Mock).mockResolvedValue({
      handled: true,
      reply: "So glad to hear that! Thank you so much for letting us know.",
    });
    const decideSpy = jest.fn();
    const deps = buildDeps({ modelClient: { decide: decideSpy } });

    const result = await handleUnifiedMessage(baseMsg, deps);

    expect(decideSpy).not.toHaveBeenCalled();
    expect(appendOutboundMessage).toHaveBeenCalledWith("conv_1", {
      text: "So glad to hear that! Thank you so much for letting us know.",
      actorType: "AI",
    });
    expect(deps.channelAdapter.sendOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ text: "So glad to hear that! Thank you so much for letting us know." })
    );
    expect(result.reply).toBe("So glad to hear that! Thank you so much for letting us know.");
    expect(result.escalated).toBe(false);
  });

  it("an ordinary message with no pending feedback request proceeds through the normal tool loop", async () => {
    (ingestInboundMessage as jest.Mock).mockResolvedValue({ conversation: buildConversation(), message: buildMessage() });
    (recordReputationResponse as jest.Mock).mockResolvedValue({ handled: false });
    const modelClient = new ScriptedModelClient([{ kind: "reply", text: "Sure, let's get you booked!" }]);
    const deps = buildDeps({ modelClient });

    const result = await handleUnifiedMessage(baseMsg, deps);

    expect(result.reply).toBe("Sure, let's get you booked!");
  });
});
