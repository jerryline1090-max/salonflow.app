import { ClaudeAiModelClient } from "../claudeModelClient";
import { ESCALATE_TOOL_NAME } from "../toolSchemas";
import { ModelDecisionInput } from "../aiModelClient";

const originalFetch = global.fetch;

function mockFetchOnce(response: { ok: boolean; status?: number; json?: any; text?: string }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    statusText: response.ok ? "OK" : "Error",
    json: async () => response.json,
    text: async () => response.text ?? "",
  }) as any;
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const baseInput: ModelDecisionInput = {
  businessId: "biz_1",
  history: [{ role: "client", content: "I want braids tomorrow" }],
  toolResultsThisTurn: [],
};

function buildClient(systemPromptBuilder = jest.fn().mockResolvedValue("system prompt")) {
  return new ClaudeAiModelClient({
    apiKey: "test-key",
    toolSchemas: [{ name: "searchServices", description: "test", input_schema: { type: "object", properties: {} } }, { name: ESCALATE_TOOL_NAME, description: "escalate", input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } }],
    buildSystemPrompt: systemPromptBuilder,
  });
}

describe("ClaudeAiModelClient.decide", () => {
  it("sends the resolved system prompt and the full tool schema list to the Messages API", async () => {
    mockFetchOnce({ ok: true, json: { content: [{ type: "text", text: "Hello!" }] } });
    const systemPromptBuilder = jest.fn().mockResolvedValue("You are the AI Receptionist for Big Kitchen.");
    const client = buildClient(systemPromptBuilder);

    await client.decide(baseInput);

    expect(systemPromptBuilder).toHaveBeenCalledWith("biz_1");
    const requestBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(requestBody.system).toBe("You are the AI Receptionist for Big Kitchen.");
    expect(requestBody.tools.length).toBeGreaterThan(0);
    expect(requestBody.tools.some((t: any) => t.name === ESCALATE_TOOL_NAME)).toBe(true);
  });

  it("interprets a plain text response as a reply", async () => {
    mockFetchOnce({ ok: true, json: { content: [{ type: "text", text: "We're open 9-6 daily." }] } });
    const client = buildClient();

    const decision = await client.decide(baseInput);

    expect(decision).toEqual({ kind: "reply", text: "We're open 9-6 daily." });
  });

  it("interprets a tool_use block as a tool_call decision", async () => {
    mockFetchOnce({
      ok: true,
      json: { content: [{ type: "tool_use", id: "toolu_1", name: "searchServices", input: { query: "braids" } }] },
    });
    const client = buildClient();

    const decision = await client.decide(baseInput);

    expect(decision).toEqual({ kind: "tool_call", tool: "searchServices", args: { query: "braids" } });
  });

  it("intercepts the escalate_to_staff tool and returns an escalate decision instead of a tool_call", async () => {
    mockFetchOnce({
      ok: true,
      json: { content: [{ type: "tool_use", id: "toolu_2", name: ESCALATE_TOOL_NAME, input: { reason: "Client asked about a product we don't carry" } }] },
    });
    const client = buildClient();

    const decision = await client.decide(baseInput);

    expect(decision).toEqual({ kind: "escalate", reason: "Client asked about a product we don't carry" });
  });

  it("escalates rather than fabricating a reply when the model returns no usable content", async () => {
    mockFetchOnce({ ok: true, json: { content: [] } });
    const client = buildClient();

    const decision = await client.decide(baseInput);

    expect(decision.kind).toBe("escalate");
  });

  it("throws on a non-2xx response rather than silently treating it as an empty reply", async () => {
    mockFetchOnce({ ok: false, status: 401, text: "invalid x-api-key" });
    const client = buildClient();

    await expect(client.decide(baseInput)).rejects.toThrow(/401/);
  });

  it("replays this turn's prior tool calls as synthetic tool_use/tool_result pairs", async () => {
    mockFetchOnce({ ok: true, json: { content: [{ type: "text", text: "Got it." }] } });
    const client = buildClient();

    await client.decide({
      ...baseInput,
      toolResultsThisTurn: [{ tool: "searchServices", args: { query: "braids" }, result: [{ id: "svc_1", name: "Knotless Braids" }] }],
    });

    const requestBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const assistantToolUse = requestBody.messages.find((m: any) => m.role === "assistant");
    const userToolResult = requestBody.messages.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === "tool_result");

    expect(assistantToolUse.content[0]).toMatchObject({ type: "tool_use", name: "searchServices" });
    expect(userToolResult.content[0].content).toContain("Knotless Braids");
    expect(userToolResult.content[0].is_error).toBe(false);
  });

  it("marks a failed tool result as is_error so the model knows to try something else", async () => {
    mockFetchOnce({ ok: true, json: { content: [{ type: "text", text: "Let me try again." }] } });
    const client = buildClient();

    await client.decide({
      ...baseInput,
      toolResultsThisTurn: [{ tool: "getOwnAppointment", args: { appointmentId: "ghost" }, error: "not found" }],
    });

    const requestBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const userToolResult = requestBody.messages.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === "tool_result");

    expect(userToolResult.content[0].is_error).toBe(true);
    expect(userToolResult.content[0].content).toContain("not found");
  });
});
