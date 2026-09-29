import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { asyncHandler, protectRouterAsyncHandlers } from "../asyncHandler";
import { DATABASE_UNAVAILABLE_MESSAGE, errorHandler, HttpError } from "../errorHandler";

function appFor(handler: () => Promise<void>) {
  const app = express();
  app.get("/", asyncHandler(async () => handler()));
  app.use(errorHandler);
  return app;
}

describe("central error handling", () => {
  it("forwards a rejected async handler to the central middleware", async () => {
    const response = await request(appFor(async () => { throw new Error("unexpected"); })).get("/");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal server error" });
  });

  it("protects existing async router callbacks when the app is assembled", async () => {
    const app = express();
    const router = express.Router();
    router.get("/", async () => { throw new Error("unexpected"); });
    protectRouterAsyncHandlers(router);
    app.use(router);
    app.use(errorHandler);

    const response = await request(app).get("/");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal server error" });
  });

  it("maps Prisma connectivity failures to a safe 503", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "5.18.0" });
    const response = await request(appFor(async () => { throw error; })).get("/");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: DATABASE_UNAVAILABLE_MESSAGE });
    expect(response.text).not.toContain("database server");
  });

  it("preserves explicit HTTP statuses", async () => {
    const response = await request(appFor(async () => { throw new HttpError(422, "Validation failed"); })).get("/");
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: "Validation failed" });
  });
});
