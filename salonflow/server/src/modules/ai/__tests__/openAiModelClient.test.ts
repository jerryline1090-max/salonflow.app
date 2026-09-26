import { ModelDecisionInput } from "../aiModelClient";
import { getOpenAiModel } from "../modelConfig";
import { OpenAiModelClient } from "../openAiModelClient";
import { ESCALATE_TOOL_NAME } from "../toolSchemas";

const originalFetch = global.fetch;
const modelEnvironmentKeys = [
  "OPENAI_MODEL",
  "OPENAI_ASSISTANT_MODEL",
  "OPENAI_RECEPTIONIST_MODEL",
  "OPENAI_VISION_MODEL",
  "OPENAI_TRANSCRIPTION_MODEL",
] as const;
const originalModelEnvironment = new Map(modelEnvironmentKeys.map((key) => [key, process.env[key]]));

const baseInput: ModelDecisionInput = {
  businessId: "biz_1",
  history: [{ role: "client", content: "I want braids tomorrow" }],
  toolResultsThisTurn: [],
};

function mockFetchResponse(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? "Too Many Requests" : status >= 400 ? "Server Error" : "OK",
    json: async () => body,
  }) as unknown as typeof fetch;
}

function buildClient(model = "test-model") {
  return new OpenAiModelClient({
    apiKey: "test-key",
    model,
    toolSchemas: [
      { name: "searchServices", description: "Search services", input_schema: { type: "object", properties: {} } },
      { name: ESCALATE_TOOL_NAME, description: "Escalate", input_schema: { type: "object", properties: {} } },
    ],
    buildSystemPrompt: async () => "system prompt",
  });
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
  for (const [key, value] of originalModelEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("getOpenAiModel", () => {
  it("uses a feature override, then the shared model, then the safe default", () => {
    for (const key of modelEnvironmentKeys) delete process.env[key];
    expect(getOpenAiModel("ASSISTANT")).toBe("gpt-5.6-luna");

    process.env.OPENAI_MODEL = "shared-model";
    expect(getOpenAiModel("RECEPTIONIST")).toBe("shared-model");

    process.env.OPENAI_ASSISTANT_MODEL = "assistant-model";
    expect(getOpenAiModel("ASSISTANT")).toBe("assistant-model");
  });
});

describe("OpenAiModelClient.decide", () => {
  it("sends the selected model and parses a function call", async () => {
    mockFetchResponse({
      choices: [{ message: { tool_calls: [{ function: { name: "searchServices", arguments: '{"query":"braids"}' } }] } }],
    });

    const decision = await buildClient("assistant-model").decide(baseInput);

    expect(decision).toEqual({ kind: "tool_call", tool: "searchServices", args: { query: "braids" } });
    const request = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(request.model).toBe("assistant-model");
    expect(request.tools).toHaveLength(2);
  });

  it("converts malformed tool arguments and malformed response shapes into safe escalation", async () => {
    mockFetchResponse({ choices: [{ message: { tool_calls: [{ function: { name: "searchServices", arguments: "not-json" } }] } }] });
    await expect(buildClient().decide(baseInput)).resolves.toEqual(expect.objectContaining({ kind: "escalate" }));

    mockFetchResponse({ choices: [{ message: {} }] });
    await expect(buildClient().decide(baseInput)).resolves.toEqual(expect.objectContaining({ kind: "escalate" }));
  });

  it("returns a safe busy error for HTTP 429", async () => {
    mockFetchResponse({}, 429);
    await expect(buildClient().decide(baseInput)).rejects.toThrow(/busy/i);
  });

  it("returns a safe unavailable error for provider failures", async () => {
    mockFetchResponse({}, 500);
    await expect(buildClient().decide(baseInput)).rejects.toThrow(/temporarily unavailable/i);

    global.fetch = jest.fn().mockRejectedValue(new Error("network failure")) as unknown as typeof fetch;
    await expect(buildClient().decide(baseInput)).rejects.toThrow(/temporarily unavailable/i);
  });

  it("aborts and reports a safe timeout after 20 seconds", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })
    ) as unknown as typeof fetch;

    const pending = buildClient().decide(baseInput);
    await Promise.resolve();
    jest.advanceTimersByTime(20_000);

    await expect(pending).rejects.toThrow(/timed out/i);
  });
});
