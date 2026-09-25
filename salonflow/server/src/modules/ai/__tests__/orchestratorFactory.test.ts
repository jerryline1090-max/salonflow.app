import { resolveModelClient, NotConfiguredAiModelClient, resolveAssistantModelClient } from "../orchestratorFactory";
import { OpenAiModelClient } from "../openAiModelClient";

describe("resolveModelClient", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("falls back to NotConfiguredAiModelClient (safe escalation) when no API key is set", () => {
    delete process.env.OPENAI_API_KEY;

    const client = resolveModelClient();

    expect(client).toBeInstanceOf(NotConfiguredAiModelClient);
  });

  it("wires a real OpenAiModelClient once OPENAI_API_KEY is configured", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";

    const client = resolveModelClient();

    expect(client).toBeInstanceOf(OpenAiModelClient);
  });

  it("the unconfigured fallback always escalates rather than replying or doing nothing", async () => {
    const client = new NotConfiguredAiModelClient();

    const decision = await client.decide({ businessId: "biz_1", history: [], toolResultsThisTurn: [] });

    expect(decision.kind).toBe("escalate");
  });
});

describe("resolveAssistantModelClient", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const actor = { userId: "owner_1", role: "OWNER" as const, businessId: "biz_1" };

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("falls back to NotConfiguredAiModelClient when no API key is set", () => {
    delete process.env.OPENAI_API_KEY;

    const client = resolveAssistantModelClient(actor, "Reports");

    expect(client).toBeInstanceOf(NotConfiguredAiModelClient);
  });

  it("wires a real OpenAiModelClient once OPENAI_API_KEY is configured", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";

    const client = resolveAssistantModelClient(actor, "Reports");

    expect(client).toBeInstanceOf(OpenAiModelClient);
  });
});
