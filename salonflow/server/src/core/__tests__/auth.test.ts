import { signToken, verifyToken, hashPassword, verifyPassword, InvalidTokenError } from "../auth";

describe("signToken / verifyToken", () => {
  it("round-trips the payload it was given", () => {
    const token = signToken({ sub: "user_1", businessId: "biz_1", role: "OWNER" });
    const decoded = verifyToken(token);

    expect(decoded).toEqual({ sub: "user_1", businessId: "biz_1", role: "OWNER" });
  });

  it("throws InvalidTokenError for garbage input", () => {
    expect(() => verifyToken("not-a-real-token")).toThrow(InvalidTokenError);
  });

  it("throws InvalidTokenError for a token signed with a different secret", () => {
    // Simulate a forged/tampered token by mangling a valid one.
    const token = signToken({ sub: "user_1", businessId: "biz_1", role: "OWNER" });
    const tampered = token.slice(0, -2) + "xx";

    expect(() => verifyToken(tampered)).toThrow(InvalidTokenError);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("hashes a password such that only the original plaintext verifies against it", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");

    await expect(verifyPassword("correct-horse-battery-staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("never stores the plaintext password in the hash", async () => {
    const plain = "correct-horse-battery-staple";
    const hash = await hashPassword(plain);

    expect(hash).not.toContain(plain);
  });
});
