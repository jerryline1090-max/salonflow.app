import crypto from "crypto";
import { Request, Response } from "express";
import { verifyMetaSignature } from "../verifyMetaSignature";

const APP_SECRET_ENV = "TEST_META_APP_SECRET";

function mockReqRes(rawBody?: Buffer, signature?: string) {
  const req = { headers: signature ? { "x-hub-signature-256": signature } : {}, rawBody } as unknown as Request;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() } as unknown as Response;
  const next = jest.fn();
  return { req, res, next };
}

function sign(secret: string, body: Buffer): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyMetaSignature", () => {
  const originalSecret = process.env[APP_SECRET_ENV];
  afterEach(() => {
    process.env[APP_SECRET_ENV] = originalSecret;
  });

  it("500s if the app secret isn't configured on this server", async () => {
    delete process.env[APP_SECRET_ENV];
    const { req, res, next } = mockReqRes(Buffer.from("{}"), "sha256=whatever");

    verifyMetaSignature(APP_SECRET_ENV)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when there's no signature header or no captured raw body", () => {
    process.env[APP_SECRET_ENV] = "shh";
    const { req, res, next } = mockReqRes(undefined, undefined);

    verifyMetaSignature(APP_SECRET_ENV)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when the signature doesn't match the body", () => {
    process.env[APP_SECRET_ENV] = "shh";
    const body = Buffer.from(JSON.stringify({ entry: [] }));
    const { req, res, next } = mockReqRes(body, "sha256=" + "0".repeat(64));

    verifyMetaSignature(APP_SECRET_ENV)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when the body has been tampered with after signing", () => {
    process.env[APP_SECRET_ENV] = "shh";
    const originalBody = Buffer.from(JSON.stringify({ entry: [{ id: 1 }] }));
    const signature = sign("shh", originalBody);
    const tamperedBody = Buffer.from(JSON.stringify({ entry: [{ id: 2 }] }));
    const { req, res, next } = mockReqRes(tamperedBody, signature);

    verifyMetaSignature(APP_SECRET_ENV)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("calls next() when the signature is valid for the exact raw body", () => {
    process.env[APP_SECRET_ENV] = "shh";
    const body = Buffer.from(JSON.stringify({ entry: [{ id: 1 }] }));
    const signature = sign("shh", body);
    const { req, res, next } = mockReqRes(body, signature);

    verifyMetaSignature(APP_SECRET_ENV)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
