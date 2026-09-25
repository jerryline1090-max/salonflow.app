import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

/**
 * Section 12: don't permanently store every media file, and never keep a
 * raw, long-lived provider URL as the durable reference (those expire and
 * leak access to whoever holds the link). Every adapter downloads media
 * through this interface and gets back an opaque `secureRef` that only
 * SalonFlow's own storage understands.
 *
 * Swap `LocalDevMediaStore` for an S3/GCS-backed implementation in
 * production — nothing else in the codebase needs to change.
 */
export interface StoredMedia {
  secureRef: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MediaStore {
  /** Downloads from `sourceUrl` (a short-lived, authenticated provider URL) and stores it securely. */
  downloadAndStore(sourceUrl: string, opts: { mimeType: string; authHeader?: string }): Promise<StoredMedia>;
  /** Resolves a secureRef back to a short-lived, authenticated URL for internal use (e.g. feeding to a media-understanding model). */
  getTemporaryAccessUrl(secureRef: string): Promise<string>;
  /** Enforces retention policy — called by a scheduled job, not inline in the request path. */
  purgeExpired(): Promise<{ purgedCount: number }>;
}

/**
 * Minimal local-filesystem implementation for development. NOT suitable
 * for production (no encryption at rest, no retention enforcement, and a
 * multi-instance deployment wouldn't share this disk). Production should
 * inject an S3/GCS-backed MediaStore with server-side encryption and a
 * lifecycle policy matching the salon's data retention settings.
 */
export class LocalDevMediaStore implements MediaStore {
  constructor(private baseDir: string = "/tmp/salonflow-media") {}

  async downloadAndStore(sourceUrl: string, opts: { mimeType: string; authHeader?: string }): Promise<StoredMedia> {
    const res = await fetch(sourceUrl, {
      headers: opts.authHeader ? { Authorization: opts.authHeader } : undefined,
    });
    if (!res.ok) {
      throw new Error(`Failed to download media: ${res.status} ${res.statusText}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(this.baseDir, { recursive: true });
    const filename = `${crypto.randomUUID()}`;
    const fullPath = path.join(this.baseDir, filename);
    await fs.writeFile(fullPath, buffer);
    return { secureRef: `local:${filename}`, mimeType: opts.mimeType, sizeBytes: buffer.length };
  }

  async getTemporaryAccessUrl(secureRef: string): Promise<string> {
    // In this dev-only implementation we just return a file:// style
    // reference; a real implementation returns a signed, expiring URL.
    return secureRef;
  }

  async purgeExpired(): Promise<{ purgedCount: number }> {
    return { purgedCount: 0 }; // no retention policy in the dev store — implement before going to production
  }
}
