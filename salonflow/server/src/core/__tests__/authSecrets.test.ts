import jwt from "jsonwebtoken";
import { resolveAuthSecrets } from "../authSecrets";

// Public deterministic fixtures, not deployment credentials.
const valid = { NODE_ENV: "production", JWT_SECRET: "unit-jwt-signing-fixture", OAUTH_STATE_SECRET: "unit-state-signing-fixture" };
const invalid = [undefined, "", " \t\n ", "dev-secret-change-me", "dev-oauth-state-secret-change-me", "change-me", "change-me-oauth-state-secret", "replace-with-strong-production-secret", "  change-me  "];

describe("production signing secret validation", () => {
  it.each(["JWT_SECRET", "OAUTH_STATE_SECRET"] as const)("rejects missing/blank/default/template values for %s", (name) => {
    for (const value of invalid) {
      expect(() => resolveAuthSecrets({ ...valid, [name]: value })).toThrow(`Invalid production configuration: ${name} must be set to a non-placeholder signing secret`);
    }
  });
  it("accepts explicitly configured production secrets without altering their bytes", () => {
    expect(resolveAuthSecrets({ ...valid, JWT_SECRET: "  unit-jwt-fixture  " })).toEqual({ jwtSecret: "  unit-jwt-fixture  ", oauthStateSecret: valid.OAUTH_STATE_SECRET });
  });
  it.each(["development", "test", undefined])("retains deterministic defaults outside production (%s)", (NODE_ENV) => {
    expect(resolveAuthSecrets({ NODE_ENV })).toEqual({ jwtSecret: "dev-secret-change-me", oauthStateSecret: "dev-oauth-state-secret-change-me" });
  });
  it("never substitutes JWT_SECRET for missing OAuth state configuration", () => {
    expect(() => resolveAuthSecrets({ NODE_ENV: "production", JWT_SECRET: valid.JWT_SECRET })).toThrow("OAUTH_STATE_SECRET");
    expect(resolveAuthSecrets({ NODE_ENV: "test", JWT_SECRET: valid.JWT_SECRET }).oauthStateSecret).toBe("dev-oauth-state-secret-change-me");
  });
  it("reports only the invalid variable, never configured secret values", () => {
    for (const name of ["JWT_SECRET", "OAUTH_STATE_SECRET"] as const) {
      try {
        resolveAuthSecrets({ ...valid, [name]: "change-me" });
        throw new Error("Expected config rejection");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain(name);
        expect(message).not.toContain("change-me");
        expect(message).not.toContain(valid.JWT_SECRET);
        expect(message).not.toContain(valid.OAUTH_STATE_SECRET);
      }
    }
  });
});

describe("resolved signing/verification secrets", () => {
  const previous = process.env;
  afterEach(() => { process.env = previous; });
  it.each(["production", "test"])("uses the same resolved secrets and preserves TTLs in %s", (NODE_ENV) => {
    process.env = { ...previous, NODE_ENV, JWT_TTL: "12h" };
    delete process.env.JWT_SECRET;
    delete process.env.OAUTH_STATE_SECRET;
    if (NODE_ENV === "production") Object.assign(process.env, valid);
    const secrets = resolveAuthSecrets();
    jest.isolateModules(() => {
      const auth = require("../auth");
      const oauth = require("../oauthState");
      const session = { sub: "user_test", businessId: "business_test", role: "OWNER" };
      const state = { businessId: "business_test", provider: "WHATSAPP_BUSINESS", actorUserId: "user_test" };
      const token = auth.signToken(session);
      const stateToken = oauth.signOAuthState(state);
      const decoded = jwt.verify(token, secrets.jwtSecret) as jwt.JwtPayload;
      const decodedState = jwt.verify(stateToken, secrets.oauthStateSecret) as jwt.JwtPayload;
      expect(decoded.exp! - decoded.iat!).toBe(12 * 60 * 60);
      expect(decodedState.exp! - decodedState.iat!).toBe(10 * 60);
      expect(auth.verifyToken(jwt.sign(session, secrets.jwtSecret))).toEqual(session);
      expect(oauth.verifyOAuthState(jwt.sign(state, secrets.oauthStateSecret))).toEqual(state);
      expect(() => jwt.verify(token, secrets.oauthStateSecret)).toThrow();
      expect(() => jwt.verify(stateToken, secrets.jwtSecret)).toThrow();
    });
  });
});
