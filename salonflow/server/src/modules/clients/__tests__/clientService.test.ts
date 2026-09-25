jest.mock("../../../lib/prisma");
jest.mock("../../../core/auditLog");

import { prisma } from "../../../lib/prisma";
import { writeAuditLog } from "../../../core/auditLog";
import { updateClient } from "../clientService";
import { buildClient } from "../../../test-utils/factories";

beforeEach(() => {
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
});

describe("updateClient", () => {
  it("rejects updating a client from a different business", async () => {
    (prisma.client.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildClient({ businessId: "other_biz" }));

    await expect(
      updateClient({ clientId: "client_1", businessId: "biz_1", actorUserId: "owner_1", updates: { phone: "234800" } })
    ).rejects.toThrow(/not found/i);
    expect(prisma.client.update).not.toHaveBeenCalled();
  });

  it("applies the update and logs previous/new values", async () => {
    const existing = buildClient({ businessId: "biz_1", phone: "old-number" });
    (prisma.client.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);
    (prisma.client.update as jest.Mock).mockResolvedValue({ ...existing, phone: "new-number" });

    const updated = await updateClient({ clientId: "client_1", businessId: "biz_1", actorUserId: "owner_1", updates: { phone: "new-number" } });

    expect(updated.phone).toBe("new-number");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "client", action: "update", previousValue: existing })
    );
  });
});
