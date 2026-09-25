/**
 * Section 4 (hard rule): if the AI can't reliably identify what's in an
 * image/video, it must say so rather than guess. This interface returns a
 * confidence score alongside any description precisely so the orchestrator
 * can enforce that rule in code, not just hope the model's wording is
 * appropriately hedged.
 */
export interface MediaDescription {
  description: string;
  /** 0–1. Below MEDIA_CONFIDENCE_THRESHOLD, the orchestrator must ask for clarification instead of asserting a match. */
  confidence: number;
  /** Populated only when the description was matched to an actual Service in this business's catalog. */
  matchedServiceId?: string;
}

export interface MediaUnderstandingService {
  describeImage(input: { temporaryAccessUrl: string; mimeType: string; businessId: string; context?: string }): Promise<MediaDescription>;
  describeVideo(input: { temporaryAccessUrl: string; mimeType: string; businessId: string; context?: string }): Promise<MediaDescription>;
}

/** Below this, the orchestrator treats the media as unidentified rather than asserting a guess as fact. */
export const MEDIA_CONFIDENCE_THRESHOLD = 0.6;

export class MediaUnderstandingNotConfiguredError extends Error {
  constructor() {
    super("No media-understanding provider configured — set one before enabling image/video handling");
    this.name = "MediaUnderstandingNotConfiguredError";
  }
}

export class NotConfiguredMediaUnderstandingService implements MediaUnderstandingService {
  async describeImage(): Promise<MediaDescription> {
    throw new MediaUnderstandingNotConfiguredError();
  }
  async describeVideo(): Promise<MediaDescription> {
    throw new MediaUnderstandingNotConfiguredError();
  }
}
