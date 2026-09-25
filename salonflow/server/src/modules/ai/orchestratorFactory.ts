import { SecretsProvider, secretsProvider } from "./secretsProvider";
import { LocalDevMediaStore, MediaStore } from "./mediaStore";
import { NotConfiguredSpeechToTextService, SpeechToTextService } from "./speechToText";
import { NotConfiguredMediaUnderstandingService, MediaUnderstandingService } from "./mediaUnderstanding";
import { AiModelClient, ModelDecision, ModelDecisionInput } from "./aiModelClient";
import { OpenAiModelClient } from "./openAiModelClient";
import { getOpenAiModel, isOpenAiConfigured } from "./modelConfig";
import { RECEPTIONIST_TOOL_SCHEMAS } from "./toolSchemas";
import { buildDefaultSystemPrompt } from "./systemPrompt";
import { WhatsAppChannelAdapter } from "./channels/whatsappAdapter";
import { WhatsAppApiClient } from "./channels/whatsappApiClient";
import { InstagramChannelAdapter } from "./channels/instagramAdapter";
import { InstagramApiClient } from "./channels/instagramApiClient";
import type { OrchestratorDeps } from "./receptionistOrchestrator";

/**
 * This is the single place a real deployment swaps stub implementations for
 * real ones (a real LLM, a real speech-to-text provider, a real media-
 * understanding model, S3-backed storage). Nothing in conversationEngine.ts,
 * receptionistTools.ts, or receptionistOrchestrator.ts needs to change when
 * you do — they only depend on the interfaces.
 *
 * Until a real model client is configured (OPENAI_API_KEY unset), every
 * conversation safely escalates to a human instead of doing nothing or
 * (worse) fabricating confident-sounding answers with no model behind them.
 */
export class NotConfiguredAiModelClient implements AiModelClient {
  async decide(_input: ModelDecisionInput): Promise<ModelDecision> {
    return { kind: "escalate", reason: "No AI model client configured for this deployment yet" };
  }
}

/**
 * Computed per call rather than cached at module load, so tests (and any
 * future per-business model configuration) can vary `OPENAI_API_KEY`
 * without needing module-reset gymnastics. The cost of re-constructing a
 * client object is negligible next to an actual model call.
 */
export function resolveModelClient(): AiModelClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!isOpenAiConfigured() || !apiKey) {
    return new NotConfiguredAiModelClient();
  }
  return new OpenAiModelClient({
    apiKey,
    model: getOpenAiModel("RECEPTIONIST"),
    toolSchemas: RECEPTIONIST_TOOL_SCHEMAS,
    buildSystemPrompt: buildDefaultSystemPrompt,
  });
}

import { ActorContext } from "../../core/permissions";
import { ASSISTANT_TOOL_SCHEMAS } from "./assistantToolSchemas";
import { buildAssistantSystemPrompt } from "./assistantSystemPrompt";

/**
 * Same fallback contract as resolveModelClient(): unset OPENAI_API_KEY
 * means every Assistant tool-calling loop hits the NotConfiguredAiModelClient's
 * "escalate" decision, which assistantOrchestrator.ts translates into a
 * plain "AI Assistant isn't configured yet" reply.
 */
export function resolveAssistantModelClient(actor: ActorContext, currentPage?: string): AiModelClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!isOpenAiConfigured() || !apiKey) {
    return new NotConfiguredAiModelClient();
  }
  return new OpenAiModelClient({
    apiKey,
    model: getOpenAiModel("ASSISTANT"),
    toolSchemas: ASSISTANT_TOOL_SCHEMAS,
    // The Assistant needs the actor's role and the page they're viewing,
    // neither of which travels through ModelDecisionInput (only businessId
    // does) — closing over them here instead. TypeScript allows a function
    // with fewer parameters to satisfy `buildSystemPrompt`'s declared
    // `(businessId: string) => ...` type.
    buildSystemPrompt: () => buildAssistantSystemPrompt(actor, currentPage),
  });
}

const secrets: SecretsProvider = secretsProvider;
export const mediaStore: MediaStore = new LocalDevMediaStore();
const speechToText: SpeechToTextService = new NotConfiguredSpeechToTextService();
const mediaUnderstanding: MediaUnderstandingService = new NotConfiguredMediaUnderstandingService();

export function buildWhatsAppDeps(phoneNumberId: string, accessTokenRef: string): OrchestratorDeps {
  const apiClient = new WhatsAppApiClient(phoneNumberId, accessTokenRef, secrets);
  return {
    modelClient: resolveModelClient(),
    mediaStore,
    speechToText,
    mediaUnderstanding,
    channelAdapter: new WhatsAppChannelAdapter(mediaStore, apiClient),
  };
}

export function buildInstagramDeps(igAccountId: string, accessTokenRef: string): OrchestratorDeps {
  const apiClient = new InstagramApiClient(igAccountId, accessTokenRef, secrets);
  return {
    modelClient: resolveModelClient(),
    mediaStore,
    speechToText,
    mediaUnderstanding,
    channelAdapter: new InstagramChannelAdapter(mediaStore, apiClient),
  };
}
