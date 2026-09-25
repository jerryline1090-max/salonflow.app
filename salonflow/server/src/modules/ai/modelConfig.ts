export type AiFeature = "ASSISTANT" | "RECEPTIONIST" | "VISION" | "TRANSCRIPTION";

const DEFAULT_MODEL = "gpt-5.6-luna";

/** Central, backwards-compatible model selection. Specialized models are
 * optional; the shared OPENAI_MODEL remains the fallback. */
export function getOpenAiModel(feature: AiFeature): string {
  const specialized: Record<AiFeature, string | undefined> = {
    ASSISTANT: process.env.OPENAI_ASSISTANT_MODEL,
    RECEPTIONIST: process.env.OPENAI_RECEPTIONIST_MODEL,
    VISION: process.env.OPENAI_VISION_MODEL,
    TRANSCRIPTION: process.env.OPENAI_TRANSCRIPTION_MODEL,
  };
  return specialized[feature] || process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}
