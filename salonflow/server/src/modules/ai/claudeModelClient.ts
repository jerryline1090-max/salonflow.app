import { AiModelClient, ModelDecision, ModelDecisionInput } from "./aiModelClient";
import { AnthropicToolSchema, ESCALATE_TOOL_NAME } from "./toolSchemas";

/**
 * Wires an AI experience to a real Claude model via the Messages API's
 * native tool use. This one class serves BOTH the AI Receptionist and the
 * AI Assistant — they differ only in which tools they're allowed to call
 * and what system prompt grounds them (see orchestratorFactory.ts for the
 * Receptionist's wiring, assistantOrchestrator.ts for the Assistant's).
 * Everything else — message translation, response interpretation, error
 * handling — is identical, because it should be: the safety properties
 * (never fabricate, escalate/admit uncertainty instead of guessing) apply
 * to both.
 *
 * NOT exercised against the live Anthropic API in this sandbox (no network
 * access here). The request/response shapes match the documented Messages
 * API tool-use format as of this writing — smoke-test against a real API
 * key before relying on this in production.
 *
 * ONE SIMPLIFICATION worth knowing: the orchestrators call `decide()` once
 * per tool-call iteration, passing their own lightweight `history`/
 * `toolResultsThisTurn` shapes rather than a native Anthropic message
 * array. `buildAnthropicMessages` below reconstructs a valid alternating
 * user/assistant sequence from that each time (folding prior history into
 * one leading user turn, then replaying this turn's tool calls as
 * synthetic assistant tool_use / user tool_result pairs). This is correct
 * and works, but a production system pushing hard on cost/latency would
 * instead carry native Anthropic message state end-to-end to avoid
 * rebuilding it every iteration and to get prompt-caching benefits.
 */

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;

export interface ClaudeModelClientConfig {
  apiKey: string;
  model?: string;
  toolSchemas: AnthropicToolSchema[];
  buildSystemPrompt: (businessId: string) => Promise<string> | string;
}

export class ClaudeAiModelClient implements AiModelClient {
  constructor(private config: ClaudeModelClientConfig) {}

  async decide(input: ModelDecisionInput): Promise<ModelDecision> {
    const systemPrompt = await this.config.buildSystemPrompt(input.businessId);
    const messages = buildAnthropicMessages(input);

    const res = await fetch(ANTHROPIC_API_BASE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
        tools: this.config.toolSchemas,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => res.statusText);
      throw new Error(`Claude API request failed: ${res.status} ${errorBody}`);
    }

    const data = await res.json();
    return interpretClaudeResponse(data);
  }
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

function buildAnthropicMessages(input: ModelDecisionInput): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];

  const transcript = input.history.map((m) => `[${m.role}]: ${m.content}`).join("\n");
  messages.push({
    role: "user",
    content: `Conversation so far:\n${transcript || "(no messages yet)"}\n\nRespond as the AI Receptionist. Use tools to look up anything you're not already certain of.`,
  });

  // Replay any tool calls already made earlier THIS turn as synthetic
  // assistant/user pairs, so the model can build on what it just learned
  // before deciding its next move — see the class-level doc comment.
  for (const toolResult of input.toolResultsThisTurn) {
    const toolUseId = `toolu_${Math.random().toString(36).slice(2, 12)}`;
    messages.push({
      role: "assistant",
      content: [{ type: "tool_use", id: toolUseId, name: toolResult.tool, input: toolResult.args }],
    });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: toolResult.error ? `Error: ${toolResult.error}` : JSON.stringify(toolResult.result ?? null),
          is_error: Boolean(toolResult.error),
        },
      ],
    });
  }

  return messages;
}

function interpretClaudeResponse(data: any): ModelDecision {
  const content: any[] = data?.content ?? [];

  const toolUseBlock = content.find((block) => block.type === "tool_use");
  if (toolUseBlock) {
    if (toolUseBlock.name === ESCALATE_TOOL_NAME) {
      return { kind: "escalate", reason: toolUseBlock.input?.reason ?? "The AI Receptionist requested human assistance" };
    }
    return { kind: "tool_call", tool: toolUseBlock.name, args: toolUseBlock.input ?? {} };
  }

  const textBlock = content.find((block) => block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0);
  if (textBlock) {
    return { kind: "reply", text: textBlock.text };
  }

  // No tool call and no usable text — never let this fall through as an
  // empty/fabricated reply. Escalate instead (mirrors the orchestrator's
  // own safety-net for an unresolved tool loop).
  return { kind: "escalate", reason: "The AI model returned no usable response" };
}
