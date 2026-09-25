/**
 * Section 33 (master spec) + section 19: WhatsApp/Instagram access tokens
 * are never stored as plaintext in the `Integration.secretRef` column —
 * that column holds a *reference* into whatever secrets manager the
 * deployment uses (AWS Secrets Manager, GCP Secret Manager, Vault, etc.).
 * This interface is the only way code resolves a reference to an actual
 * token, so swapping providers never touches business logic.
 */
export interface SecretsProvider {
  getSecret(ref: string): Promise<string>;
  setSecret(ref: string, value: string): Promise<void>;
  deleteSecret(ref: string): Promise<void>;
}

/**
 * Development-only implementation: reads from environment variables named
 * by the ref (e.g. secretRef="WHATSAPP_TOKEN_BIZ1" -> process.env.WHATSAPP_TOKEN_BIZ1),
 * with an in-memory override map for secrets written at runtime (e.g. a
 * token obtained via the OAuth connect flow in modules/integrations/).
 *
 * The in-memory map does NOT survive a process restart and is NOT shared
 * across multiple instances of the API — acceptable for local development
 * only. Replace with a real secrets-manager-backed provider (with actual
 * persistent, encrypted writes) before production; env vars and in-memory
 * maps are not an acceptable place to keep live API tokens for a
 * multi-tenant SaaS.
 */
export class EnvSecretsProvider implements SecretsProvider {
  private overrides = new Map<string, string>();

  async getSecret(ref: string): Promise<string> {
    const value = this.overrides.get(ref) ?? process.env[ref];
    if (!value) {
      throw new Error(`No secret found for reference "${ref}" (dev EnvSecretsProvider checks its in-memory map, then process.env)`);
    }
    return value;
  }

  async setSecret(ref: string, value: string): Promise<void> {
    this.overrides.set(ref, value);
  }

  async deleteSecret(ref: string): Promise<void> {
    this.overrides.delete(ref);
  }
}

/**
 * Shared singleton so every part of the app (the OAuth connect flow that
 * writes a token, and the channel adapters that read it) resolve secrets
 * through the exact same instance — important for the dev in-memory
 * implementation, where a second `new EnvSecretsProvider()` would have an
 * empty map and never see a token written by the first.
 */
export const secretsProvider: SecretsProvider = new EnvSecretsProvider();
