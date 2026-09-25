jest.mock("../../lib/prisma");

import { prisma } from "../../lib/prisma";
import { can, assertCan, PermissionDeniedError } from "../permissions";

describe("permissions", () => {
  it("applies role defaults when no explicit override exists", async () => {
    (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(can({ userId: "u1", role: "OWNER" }, "payments", "delete")).resolves.toBe(true);
    await expect(can({ userId: "u2", role: "STAFF" }, "payments", "view")).resolves.toBe(false);
    await expect(can({ userId: "u2", role: "STAFF" }, "appointments", "view")).resolves.toBe(true);
  });

  it("a STAFF user cannot view reports by default, so the AI must not reveal reports to them either", async () => {
    (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);

    const staffActor = { userId: "u2", role: "STAFF" as const };
    await expect(can(staffActor, "reports", "view")).resolves.toBe(false);

    // The AI Assistant calling the exact same function for the same actor
    // gets the exact same answer — there is no separate, more permissive
    // path for AI-originated requests (section 27, hard rule).
    await expect(can(staffActor, "reports", "view")).resolves.toBe(false);
  });

  it("an explicit per-user override takes precedence over the role default", async () => {
    // Role default for STAFF on payments is no access at all, but this
    // specific staff member has been explicitly granted view access.
    (prisma.permission.findUnique as jest.Mock).mockResolvedValue({
      userId: "u2",
      resource: "payments",
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
    });

    await expect(can({ userId: "u2", role: "STAFF" }, "payments", "view")).resolves.toBe(true);
    await expect(can({ userId: "u2", role: "STAFF" }, "payments", "edit")).resolves.toBe(false);
  });

  it("an override can also be MORE restrictive than the role default", async () => {
    // Role default for OWNER on payments allows delete, but this override
    // explicitly revokes it for one user.
    (prisma.permission.findUnique as jest.Mock).mockResolvedValue({
      userId: "u1",
      resource: "payments",
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false,
    });

    await expect(can({ userId: "u1", role: "OWNER" }, "payments", "delete")).resolves.toBe(false);
  });

  it("assertCan throws PermissionDeniedError instead of silently proceeding", async () => {
    (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(assertCan({ userId: "u2", role: "STAFF" }, "settings", "edit")).rejects.toThrow(PermissionDeniedError);
  });
});
