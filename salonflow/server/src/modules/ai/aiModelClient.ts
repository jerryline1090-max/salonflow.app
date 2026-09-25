/**
 * This is the one seam in the whole AI Receptionist where a real language
 * model (with tool/function calling — e.g. the Anthropic Messages API)
 * plugs in. Everything else in modules/ai/ — the tool allowlist, the
 * conversation engine, the channel adapters — is deterministic application
 * code that's fully testable without a live model. This interface is
 * deliberately the only non-deterministic dependency, injected into the
 * orchestrator, so:
 *   - unit tests use a scripted MockAiModelClient (see __tests__)
 *   - production wires in a real client that sends `history` + the tool
 *     schemas from TOOL_SCHEMAS (receptionistOrchestrator.ts) to the model
 *     and translates its response into one ModelDecision
 */

export type OrchestratorRole = "client" | "ai" | "staff" | "system";

export interface OrchestratorMessage {
  role: OrchestratorRole;
  content: string;
}

export interface ToolCallResult {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface ModelDecisionInput {
  businessId: string;
  /** Ordered oldest → newest. Voice notes appear as their transcription; images/video as their description (or a note that description failed/was low-confidence). */
  history: OrchestratorMessage[];
  /** Tool calls already made THIS turn, with their results — lets the model react to what it just found out (e.g. "that slot's taken, what else is open") before finalizing a reply. */
  toolResultsThisTurn: ToolCallResult[];
}

export type ModelDecision =
  | { kind: "reply"; text: string }
  | { kind: "tool_call"; tool: string; args: Record<string, unknown> }
  | { kind: "escalate"; reason: string };

export interface AiModelClient {
  decide(input: ModelDecisionInput): Promise<ModelDecision>;
}
