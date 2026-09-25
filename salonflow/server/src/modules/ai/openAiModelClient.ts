import { AiModelClient, ModelDecision, ModelDecisionInput } from "./aiModelClient";
import { AnthropicToolSchema, ESCALATE_TOOL_NAME } from "./toolSchemas";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5.6-luna";

export interface OpenAiModelClientConfig {
  apiKey: string;
  model?: string;
  toolSchemas: AnthropicToolSchema[];
  buildSystemPrompt: (businessId: string) => Promise<string> | string;
}

/** OpenAI Chat Completions adapter. It translates the existing provider-neutral
 * decision contract; permissions and actual business actions stay outside it. */
export class OpenAiModelClient implements AiModelClient {
  constructor(private config: OpenAiModelClientConfig) {}

  async decide(input: ModelDecisionInput): Promise<ModelDecision> {
    const system = await this.config.buildSystemPrompt(input.businessId);
    const transcript = input.history.map((message) => `[${message.role}]: ${message.content}`).join("\n") || "(no messages yet)";
    const toolResults = input.toolResultsThisTurn.length
      ? `\n\nTool results from this turn:\n${input.toolResultsThisTurn.map((item) => `${item.tool}: ${item.error ? `Error: ${item.error}` : JSON.stringify(item.result ?? null)}`).join("\n")}`
      : "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Conversation so far:\n${transcript}${toolResults}` },
        ],
        tools: this.config.toolSchemas.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
        })),
        tool_choice: "auto",
      }),
      signal: controller.signal,
      });
    } catch (error: any) {
      if (error?.name === "AbortError") throw new Error("SalonFlow AI timed out. Please try again.");
      throw new Error("SalonFlow AI is temporarily unavailable. Please try again.");
    } finally { clearTimeout(timeout); }
    if (!res.ok) {
      if (res.status === 429) throw new Error("SalonFlow AI is busy right now. Please try again shortly.");
      throw new Error("SalonFlow AI is temporarily unavailable. Please try again.");
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
    const message = data.choices?.[0]?.message;
    const toolCall = message?.tool_calls?.[0]?.function;
    if (toolCall?.name) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(toolCall.arguments ?? "{}"); } catch { return { kind: "escalate", reason: "The AI returned invalid tool arguments" }; }
      if (toolCall.name === ESCALATE_TOOL_NAME) return { kind: "escalate", reason: typeof args.reason === "string" ? args.reason : "The AI requested human assistance" };
      return { kind: "tool_call", tool: toolCall.name, args };
    }
    if (typeof message?.content === "string" && message.content.trim()) return { kind: "reply", text: message.content };
    return { kind: "escalate", reason: "The AI returned no usable response" };
  }
}
