// Predictable values are permitted only for local development/test use.
const DEV_JWT_SECRET = "dev-secret-change-me";
const DEV_OAUTH_STATE_SECRET = "dev-oauth-state-secret-change-me";
const PLACEHOLDERS = new Set([
  DEV_JWT_SECRET,
  DEV_OAUTH_STATE_SECRET,
  "change-me",
  "change-me-oauth-state-secret",
  "replace-with-strong-production-secret",
]);

export function resolveAuthSecrets(environment: NodeJS.ProcessEnv = process.env) {
  const production = environment.NODE_ENV === "production";
  function resolve(name: "JWT_SECRET" | "OAUTH_STATE_SECRET", developmentDefault: string): string {
    const value = environment[name];
    if (production && (!value?.trim() || PLACEHOLDERS.has(value.trim()))) {
      // Never include values, environment contents, or provider details.
      throw new Error(`Invalid production configuration: ${name} must be set to a non-placeholder signing secret`);
    }
    // Preserve configured bytes; trimming is only for validation.
    return value ?? developmentDefault;
  }
  return {
    jwtSecret: resolve("JWT_SECRET", DEV_JWT_SECRET),
    oauthStateSecret: resolve("OAUTH_STATE_SECRET", DEV_OAUTH_STATE_SECRET),
  };
}
