jest.mock("../../lib/prisma");
jest.mock("../../modules/auth/authService");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authRouter } from "../auth.routes";
import { signToken } from "../../core/auth";
import { registerBusiness, login, createTeamMember, InvalidCredentialsError } from "../../modules/auth/authService";
import { errorHandler } from "../../middleware/errorHandler";
import { Prisma } from "@prisma/client";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("POST /api/auth/register", () => {
  it("rejects a request missing required fields without touching the database", async () => {
    const res = await request(buildApp()).post("/api/auth/register").send({ email: "amaka@test.com" });

    expect(res.status).toBe(400);
    expect(registerBusiness).not.toHaveBeenCalled();
  });

  it("creates the business and returns a token on success", async () => {
    (registerBusiness as jest.Mock).mockResolvedValue({
      business: { id: "biz_1", name: "Big Kitchen" },
      user: { id: "user_1", name: "Amaka", email: "amaka@test.com", role: "OWNER" },
      token: "signed.jwt.token",
    });

    const res = await request(buildApp()).post("/api/auth/register").send({
      businessName: "Big Kitchen",
      ownerName: "Amaka",
      email: "amaka@test.com",
      password: "supersecret",
    });

    expect(res.status).toBe(201);
    expect(res.body.token).toBe("signed.jwt.token");
    expect(res.body.user.role).toBe("OWNER");
  });
});

describe("POST /api/auth/login", () => {
  it("returns 401 with a generic message on invalid credentials", async () => {
    (login as jest.Mock).mockRejectedValue(new InvalidCredentialsError());

    const res = await request(buildApp()).post("/api/auth/login").send({ email: "x@test.com", password: "wrong" });

    expect(res.status).toBe(401);
  });

  it("returns a token on success", async () => {
    (login as jest.Mock).mockResolvedValue({
      user: { id: "user_1", name: "Amaka", email: "amaka@test.com", role: "OWNER", businessId: "biz_1" },
      token: "signed.jwt.token",
    });

    const res = await request(buildApp()).post("/api/auth/login").send({ email: "amaka@test.com", password: "correct" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBe("signed.jwt.token");
  });

  it("does not expose database or internal errors to the sign-in form", async () => {
    const logError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (login as jest.Mock).mockRejectedValue(new Error("Can't reach database server at secret-host:5432"));

    const res = await request(buildApp()).post("/api/auth/login").send({ email: "amaka@test.com", password: "correct" });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("We couldn't connect to SalonFlow right now. Please try again shortly.");
    expect(res.body.error).not.toContain("secret-host");
    logError.mockRestore();
  });
});

describe("GET /api/auth/team", () => {
  it("401s with no token", async () => {
    const res = await request(buildApp()).get("/api/auth/team");
    expect(res.status).toBe(401);
  });

  it("MANAGER can view the team list (view is a lighter bar than create)", async () => {
    const managerToken = signToken({ sub: "mgr_1", businessId: "biz_1", role: "MANAGER" });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(buildApp()).get("/api/auth/team").set("Authorization", `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect((prisma.user.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ businessId: "biz_1" });
  });
});

describe("GET /api/auth/me", () => {
  it("returns a safe 503 for a Prisma connectivity failure", async () => {
    const token = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
    (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "5.18.0" }));

    const res = await request(buildApp()).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
  });
});

describe("POST /api/auth/team", () => {
  const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
  const staffToken = signToken({ sub: "staff_1", businessId: "biz_1", role: "STAFF" });

  it("401s with no token", async () => {
    const res = await request(buildApp()).post("/api/auth/team").send({ name: "Mike", email: "mike@test.com", password: "pw", role: "STAFF" });
    expect(res.status).toBe(401);
  });

  it("403s for a STAFF token — only an OWNER may create team accounts by default", async () => {
    const res = await request(buildApp())
      .post("/api/auth/team")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ name: "Mike", email: "mike@test.com", password: "pw", role: "STAFF" });

    expect(res.status).toBe(403);
    expect(createTeamMember).not.toHaveBeenCalled();
  });

  it("rejects an attempt to create another OWNER account through this endpoint", async () => {
    const res = await request(buildApp())
      .post("/api/auth/team")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Second Owner", email: "second@test.com", password: "pw", role: "OWNER" });

    expect(res.status).toBe(400);
    expect(createTeamMember).not.toHaveBeenCalled();
  });

  it("lets an OWNER create a STAFF or MANAGER account, scoped to their own business", async () => {
    (createTeamMember as jest.Mock).mockResolvedValue({ id: "user_2", name: "Mike", email: "mike@test.com", role: "STAFF" });

    const res = await request(buildApp())
      .post("/api/auth/team")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Mike", email: "mike@test.com", password: "pw123456", role: "STAFF" });

    expect(res.status).toBe(201);
    expect(createTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "biz_1", role: "STAFF", actorUserId: "owner_1" })
    );
  });
});
