jest.mock("../../../lib/prisma");

import { prisma } from "../../../lib/prisma";
import { resolveOrCreateClientForChannel } from "../clientIdentity";

describe("resolveOrCreateClientForChannel", () => {
  it("returns the existing client when this exact channel identity is already linked", async () => {
    (prisma.clientChannelIdentity.findUnique as jest.Mock).mockResolvedValue({ clientId: "client_1" });
    (prisma.client.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "client_1", name: "Sarah" });

    const client = await resolveOrCreateClientForChannel({
      businessId: "biz_1",
      channel: "WHATSAPP",
      externalUserId: "2348000000000",
    });

    expect(client.id).toBe("client_1");
    expect(prisma.client.create).not.toHaveBeenCalled();
  });

  it("matches an existing WhatsApp client by phone number instead of creating a duplicate", async () => {
    (prisma.clientChannelIdentity.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.client.findFirst as jest.Mock).mockResolvedValue({ id: "client_existing", phone: "2348000000000" });

    const client = await resolveOrCreateClientForChannel({
      businessId: "biz_1",
      channel: "WHATSAPP",
      externalUserId: "2348000000000",
    });

    expect(client.id).toBe("client_existing");
    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(prisma.clientChannelIdentity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clientId: "client_existing", channel: "WHATSAPP" }) })
    );
  });

  it("creates a new client only when no identity or phone match exists", async () => {
    (prisma.clientChannelIdentity.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.client.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.client.create as jest.Mock).mockResolvedValue({ id: "client_new", phone: "2348000000000" });

    const client = await resolveOrCreateClientForChannel({
      businessId: "biz_1",
      channel: "WHATSAPP",
      externalUserId: "2348000000000",
      displayName: "New Client",
    });

    expect(client.id).toBe("client_new");
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: "2348000000000" }) })
    );
  });

  it("does not attempt a phone match for Instagram unless a phone was explicitly supplied", async () => {
    (prisma.clientChannelIdentity.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.client.create as jest.Mock).mockResolvedValue({ id: "client_ig" });

    await resolveOrCreateClientForChannel({
      businessId: "biz_1",
      channel: "INSTAGRAM",
      externalUserId: "ig_scoped_id_123",
    });

    expect(prisma.client.findFirst).not.toHaveBeenCalled();
  });

  it("still links the channel identity so a second message from the same person never creates a second client", async () => {
    (prisma.clientChannelIdentity.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.client.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.client.create as jest.Mock).mockResolvedValue({ id: "client_new" });

    await resolveOrCreateClientForChannel({ businessId: "biz_1", channel: "WHATSAPP", externalUserId: "234800000" });

    expect(prisma.clientChannelIdentity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { clientId: "client_new", businessId: "biz_1", channel: "WHATSAPP", externalUserId: "234800000" },
      })
    );
  });
});
