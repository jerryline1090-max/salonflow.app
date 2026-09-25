import { signOAuthState, verifyOAuthState, InvalidOAuthStateError } from "../oauthState";

describe("signOAuthState / verifyOAuthState", () => {
  it("round-trips the payload", () => {
    const state = signOAuthState({ businessId: "biz_1", provider: "WHATSAPP_BUSINESS", actorUserId: "owner_1" });
    const decoded = verifyOAuthState(state);

    expect(decoded).toEqual({ businessId: "biz_1", provider: "WHATSAPP_BUSINESS", actorUserId: "owner_1" });
  });

  it("rejects garbage input", () => {
    expect(() => verifyOAuthState("not-a-real-token")).toThrow(InvalidOAuthStateError);
  });

  it("rejects a tampered state token", () => {
    const state = signOAuthState({ businessId: "biz_1", provider: "INSTAGRAM", actorUserId: "owner_1" });
    const tampered = state.slice(0, -2) + "xx";

    expect(() => verifyOAuthState(tampered)).toThrow(InvalidOAuthStateError);
  });

  it("uses a secret independent of the login JWT_SECRET — a session token must not verify as OAuth state", () => {
    // Sanity check that this module has its own verification path rather
    // than accidentally delegating to core/auth.ts's verifyToken.
    const { verifyToken } = require("../auth");
    const state = signOAuthState({ businessId: "biz_1", provider: "WHATSAPP_BUSINESS", actorUserId: "owner_1" });

    expect(() => verifyToken(state)).toThrow();
  });
});
