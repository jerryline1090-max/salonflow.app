import { WhatsAppChannelAdapter } from "../whatsappAdapter";

function buildPayload(message: any) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "PHONE_123" },
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

describe("WhatsAppChannelAdapter.normalizeInbound", () => {
  it("normalizes a text message", async () => {
    const mediaStore = { downloadAndStore: jest.fn(), getTemporaryAccessUrl: jest.fn(), purgeExpired: jest.fn() };
    const apiClient = { fetchMediaUrl: jest.fn(), sendText: jest.fn() } as any;
    const adapter = new WhatsAppChannelAdapter(mediaStore, apiClient);

    const payload = buildPayload({
      from: "2348000000000",
      id: "wamid.1",
      timestamp: "1735300000",
      type: "text",
      text: { body: "Hi, I want braids tomorrow" },
    });

    const [msg] = await adapter.normalizeInbound(payload, "biz_1");

    expect(msg).toMatchObject({
      channel: "WHATSAPP",
      businessId: "biz_1",
      externalConversationId: "PHONE_123:2348000000000",
      externalUserId: "2348000000000",
      externalMessageId: "wamid.1",
      type: "TEXT",
      text: "Hi, I want braids tomorrow",
    });
    expect(mediaStore.downloadAndStore).not.toHaveBeenCalled();
  });

  it("downloads and stores a voice note, tagging it as VOICE with a secure reference", async () => {
    const mediaStore = {
      downloadAndStore: jest.fn().mockResolvedValue({ secureRef: "local:abc", mimeType: "audio/ogg", sizeBytes: 1000 }),
      getTemporaryAccessUrl: jest.fn(),
      purgeExpired: jest.fn(),
    };
    const apiClient = {
      fetchMediaUrl: jest.fn().mockResolvedValue({ url: "https://provider/media/1", mimeType: "audio/ogg", authHeader: "Bearer x" }),
      sendText: jest.fn(),
    } as any;
    const adapter = new WhatsAppChannelAdapter(mediaStore, apiClient);

    const payload = buildPayload({
      from: "2348000000000",
      id: "wamid.2",
      timestamp: "1735300000",
      type: "audio",
      audio: { id: "media_1", mime_type: "audio/ogg" },
    });

    const [msg] = await adapter.normalizeInbound(payload, "biz_1");

    expect(apiClient.fetchMediaUrl).toHaveBeenCalledWith("media_1");
    expect(mediaStore.downloadAndStore).toHaveBeenCalledWith("https://provider/media/1", {
      mimeType: "audio/ogg",
      authHeader: "Bearer x",
    });
    expect(msg).toMatchObject({ type: "VOICE", mediaSecureRef: "local:abc", mediaMimeType: "audio/ogg" });
  });

  it("normalizes an image with a caption", async () => {
    const mediaStore = {
      downloadAndStore: jest.fn().mockResolvedValue({ secureRef: "local:img", mimeType: "image/jpeg", sizeBytes: 500 }),
      getTemporaryAccessUrl: jest.fn(),
      purgeExpired: jest.fn(),
    };
    const apiClient = {
      fetchMediaUrl: jest.fn().mockResolvedValue({ url: "https://provider/media/2", mimeType: "image/jpeg", authHeader: "Bearer x" }),
      sendText: jest.fn(),
    } as any;
    const adapter = new WhatsAppChannelAdapter(mediaStore, apiClient);

    const payload = buildPayload({
      from: "2348000000000",
      id: "wamid.3",
      timestamp: "1735300000",
      type: "image",
      image: { id: "media_2", mime_type: "image/jpeg", caption: "I want this style" },
    });

    const [msg] = await adapter.normalizeInbound(payload, "biz_1");

    expect(msg).toMatchObject({ type: "IMAGE", text: "I want this style", mediaSecureRef: "local:img" });
  });

  it("records a message as OTHER rather than dropping it when media download fails", async () => {
    const mediaStore = { downloadAndStore: jest.fn().mockRejectedValue(new Error("network error")), getTemporaryAccessUrl: jest.fn(), purgeExpired: jest.fn() };
    const apiClient = {
      fetchMediaUrl: jest.fn().mockResolvedValue({ url: "https://provider/media/3", mimeType: "video/mp4", authHeader: "Bearer x" }),
      sendText: jest.fn(),
    } as any;
    const adapter = new WhatsAppChannelAdapter(mediaStore, apiClient);

    const payload = buildPayload({
      from: "2348000000000",
      id: "wamid.4",
      timestamp: "1735300000",
      type: "video",
      video: { id: "media_3", mime_type: "video/mp4" },
    });

    const [msg] = await adapter.normalizeInbound(payload, "biz_1");

    expect(msg.type).toBe("OTHER");
    expect(msg.mediaSecureRef).toBeUndefined();
  });

  it("ignores status callbacks (delivery/read receipts) entirely", async () => {
    const mediaStore = { downloadAndStore: jest.fn(), getTemporaryAccessUrl: jest.fn(), purgeExpired: jest.fn() };
    const apiClient = { fetchMediaUrl: jest.fn(), sendText: jest.fn() } as any;
    const adapter = new WhatsAppChannelAdapter(mediaStore, apiClient);

    const payload = {
      entry: [{ changes: [{ value: { metadata: { phone_number_id: "PHONE_123" }, statuses: [{ id: "wamid.1", status: "read" }] } }] }],
    };

    const messages = await adapter.normalizeInbound(payload, "biz_1");

    expect(messages).toHaveLength(0);
  });
});

describe("WhatsAppChannelAdapter.sendOutbound", () => {
  it("reports success when the API call succeeds", async () => {
    const apiClient = { fetchMediaUrl: jest.fn(), sendText: jest.fn().mockResolvedValue(undefined) } as any;
    const adapter = new WhatsAppChannelAdapter({} as any, apiClient);

    const result = await adapter.sendOutbound({ externalConversationId: "x", externalUserId: "2348000000000", text: "Hi" });

    expect(result).toEqual({ success: true });
  });

  it("reports failure with the error message rather than throwing", async () => {
    const apiClient = { fetchMediaUrl: jest.fn(), sendText: jest.fn().mockRejectedValue(new Error("rate limited")) } as any;
    const adapter = new WhatsAppChannelAdapter({} as any, apiClient);

    const result = await adapter.sendOutbound({ externalConversationId: "x", externalUserId: "2348000000000", text: "Hi" });

    expect(result).toEqual({ success: false, error: "rate limited" });
  });
});
