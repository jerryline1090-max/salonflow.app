/**
 * Section 3: voice notes get transcribed before the AI ever reasons about
 * them. This is deliberately an interface, not a concrete Whisper/Deepgram/
 * Google STT call — plug in whichever provider the deployment uses without
 * touching the conversation engine or orchestrator.
 */
export interface TranscriptionResult {
  text: string;
  confidence?: number;
  languageDetected?: string;
}

export interface SpeechToTextService {
  transcribe(input: { secureRef: string; mimeType: string; temporaryAccessUrl: string }): Promise<TranscriptionResult>;
}

/**
 * Thrown by the not-yet-configured default so a misconfigured deployment
 * fails loudly (a voice note silently getting no reply) rather than the
 * AI inventing what it thinks the client might have said.
 */
export class SpeechToTextNotConfiguredError extends Error {
  constructor() {
    super("No speech-to-text provider configured — set one before enabling voice-note handling");
    this.name = "SpeechToTextNotConfiguredError";
  }
}

export class NotConfiguredSpeechToTextService implements SpeechToTextService {
  async transcribe(): Promise<TranscriptionResult> {
    throw new SpeechToTextNotConfiguredError();
  }
}
