import { InstagramChannelAdapter } from "../instagramAdapter";

function buildPayload(messagingEvent: any, entryId = "IG_ACCOUNT_1") {
  return { entry: [{ id: entryId, messaging: [messagingEvent] }] };
}

describe("InstagramChannelAdapter.normalizeInbound", () => {
  it("normalizes a plain text message", async () => {
    const mediaStore = { downloadAndStore: jest.fn(), getTemporaryAccessUrl: jest.fn(), purgeExpired: jest.fn() };
    const apiClient = { sendText: jest.fn() } as any;
    const adapter = new InstagramChannelAdapter(mediaStore, apiClient);

    const payload = buildPayload({
      sender: { id: "ig_user_1" },
      timestamp: 1735300000000,
      message: { mid: "mid.1", text: "Heyyy your braids are so fine" },
    });

    const [msg] = await adapter.normalizeInbound(payload, "biz_1");

    expect(msg).toMatchObject({
      channel: "INSTAGRAM",
      businessId: "biz_1",
      externalConversationId: "IG_ACCOUNT_1:ig_user_1",
      externalUserId: "ig_user_1",
      type: "TEXT",
      text: "Heyyy your braids are so fine",
    });
  });

  it("downloads an image attachment and tags it IMAGE", async () => {
    const mediaStore = {
      downloadAndStore: jest.fn().mockResolvedValue({ secureRef: "local:ig-img", mimeType: "image/jpeg", sizeBytes: 100 }),
      getTemporaryAccessUrl: jest.fn(),
      purgeExpired: jest.fn(),
    };
    const apiClient = { sendText: jest.fn() } as any;
    const adapter = new InstagramChannelAdapter(mediaStore, apiClient);

    const payload = buildPayload({
      sender: { id: "ig_user_1" },
      timestamp: 1735300000000,
      message: { mid: "mid.2", attachments: [{ type: "image", payload: { url: "https://cdn.instagram.com/img.jpg" } }] },
    });

    const [msg] = await adapter.normalizeInbound(payload, "biz_1");

    expect(mediaStore.downloadAndStore).toHaveBeenCalledWith("https://cdn.instagram.com/img.jpg", expect.objectContaining({ mimeType: "image/jpeg" }));
    expect(msg).toMatchObject({ type: "IMAGE", mediaSecureRef: "local:ig-img" });
  });

  it("ignores the business's own outbound message echoes", async () => {
    const mediaStore = { downloadAndStore: jest.fn(), getTemporaryAccessUrl: jest.fn(), purgeExpired: jest.fn() };
    const apiClient = { sendText: jest.fn() } as any;
    const adapter = new InstagramChannelAdapter(mediaStore, apiClient);

    const payload = buildPayload({
      sender: { id: "ig_user_1" },
      timestamp: 1735300000000,
      message: { mid: "mid.3", text: "our own reply", is_echo: true },
    });

    const messages = await adapter.normalizeInbound(payload, "biz_1");

    expect(messages).toHaveLength(0);
  });

  it("ignores read receipts and delivery confirmations", async () => {
    const mediaStore = { downloadAndStore: jest.fn(), getTemporaryAccessUrl: jest.fn(), purgeExpired: jest.fn() };
    const apiClient = { sendText: jest.fn() } as any;
    const adapter = new InstagramChannelAdapter(mediaStore, apiClient);

    const payload = buildPayload({ sender: { id: "ig_user_1" }, timestamp: 1735300000000, read: { watermark: 123 } });

    const messages = await adapter.normalizeInbound(payload, "biz_1");

    expect(messages).toHaveLength(0);
  });
});

describe("InstagramChannelAdapter.sendOutbound", () => {
  it("reports failure without throwing", async () => {
    const apiClient = { sendText: jest.fn().mockRejectedValue(new Error("token expired")) } as any;
    const adapter = new InstagramChannelAdapter({} as any, apiClient);

    const result = await adapter.sendOutbound({ externalConversationId: "x", externalUserId: "ig_user_1", text: "Hi" });

    expect(result).toEqual({ success: false, error: "token expired" });
  });
});
