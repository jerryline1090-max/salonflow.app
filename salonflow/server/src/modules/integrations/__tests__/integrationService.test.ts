jest.mock("../../../lib/prisma");
jest.mock("../../../core/auditLog");
jest.mock("../metaOAuthClient", () => {
  const actual = jest.requireActual("../metaOAuthClient");
  return {
    ...actual,
    buildAuthorizationUrl: jest.fn(),
    exchangeCodeForToken: jest.fn(),
    exchangeForLongLivedToken: jest.fn(),
    listWhatsAppBusinessAccounts: jest.fn(),
    listInstagramAccounts: jest.fn(),
  };
});

import { prisma } from "../../../lib/prisma";
import { eventBus } from "../../../core/eventBus";
import { writeAuditLog } from "../../../core/auditLog";
import * as metaOAuthClient from "../metaOAuthClient";
import {
  beginConnect,
  completeConnect,
  selectAccount,
  listCandidateAccounts,
  disconnectIntegration,
  buildSecretRef,
} from "../integrationService";

const secrets = {
  getSecret: jest.fn(),
  setSecret: jest.fn(),
  deleteSecret: jest.fn(),
};

beforeEach(() => {
  secrets.getSecret.mockReset();
  secrets.setSecret.mockReset();
  secrets.deleteSecret.mockReset();
  secrets.deleteSecret.mockResolvedValue(undefined);
  jest.spyOn(eventBus, "emit").mockResolvedValue(undefined);
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
  process.env.META_APP_ID = "app_id";
  process.env.META_APP_SECRET = "app_secret";
  process.env.META_OAUTH_REDIRECT_URI = "https://salonflow.test/api/integrations/whatsapp/callback";
  (metaOAuthClient.buildAuthorizationUrl as jest.Mock).mockReturnValue("https://facebook.com/oauth/dialog?...");
});

describe("beginConnect", () => {
  it("marks the integration CONNECTING and returns a real Meta authorization URL", async () => {
    (prisma.integration.upsert as jest.Mock).mockResolvedValue({ id: "int_1", status: "CONNECTING" });

    const url = await beginConnect("biz_1", "WHATSAPP_BUSINESS", "owner_1");

    expect(prisma.integration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId_provider: { businessId: "biz_1", provider: "WHATSAPP_BUSINESS" } },
        create: expect.objectContaining({ status: "CONNECTING" }),
      })
    );
    expect(url).toBe("https://facebook.com/oauth/dialog?...");
  });

  it("throws clearly when Meta app credentials aren't configured", async () => {
    delete process.env.META_APP_ID;

    await expect(beginConnect("biz_1", "WHATSAPP_BUSINESS", "owner_1")).rejects.toThrow(/META_APP_ID/);
  });
});

describe("completeConnect", () => {
  it("auto-selects and connects immediately when exactly one candidate account is found", async () => {
    (metaOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue({ accessToken: "short_lived" });
    (metaOAuthClient.exchangeForLongLivedToken as jest.Mock).mockResolvedValue({ accessToken: "long_lived_token" });
    (metaOAuthClient.listWhatsAppBusinessAccounts as jest.Mock).mockResolvedValue([
      { phoneNumberId: "phone_123", displayPhoneNumber: "+234 800 000 0000" },
    ]);
    (prisma.integration.update as jest.Mock).mockResolvedValue({ status: "CONNECTED" });

    const result = await completeConnect("auth_code", "biz_1", "WHATSAPP_BUSINESS", secrets as any);

    expect(secrets.setSecret).toHaveBeenCalledWith(buildSecretRef("biz_1", "WHATSAPP_BUSINESS"), "long_lived_token");
    expect(prisma.integration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CONNECTED", externalId: "phone_123" }) })
    );
    expect(result.status).toBe("CONNECTED");
  });

  it("returns NEEDS_SETUP with the candidate list when multiple accounts are found", async () => {
    (metaOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue({ accessToken: "short_lived" });
    (metaOAuthClient.exchangeForLongLivedToken as jest.Mock).mockResolvedValue({ accessToken: "long_lived_token" });
    (metaOAuthClient.listWhatsAppBusinessAccounts as jest.Mock).mockResolvedValue([
      { phoneNumberId: "phone_1", displayPhoneNumber: "+234 800 000 0001" },
      { phoneNumberId: "phone_2", displayPhoneNumber: "+234 800 000 0002" },
    ]);
    (prisma.integration.update as jest.Mock).mockResolvedValue({ status: "NEEDS_SETUP" });

    const result = await completeConnect("auth_code", "biz_1", "WHATSAPP_BUSINESS", secrets as any);

    expect(result.status).toBe("NEEDS_SETUP");
    expect(result.candidates).toHaveLength(2);
    // The secret is still stored so the owner's later pick doesn't require re-authenticating.
    expect(secrets.setSecret).toHaveBeenCalled();
  });

  it("marks ERROR when no connectable account is found at all", async () => {
    (metaOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue({ accessToken: "short_lived" });
    (metaOAuthClient.exchangeForLongLivedToken as jest.Mock).mockResolvedValue({ accessToken: "long_lived_token" });
    (metaOAuthClient.listWhatsAppBusinessAccounts as jest.Mock).mockResolvedValue([]);

    const result = await completeConnect("auth_code", "biz_1", "WHATSAPP_BUSINESS", secrets as any);

    expect(result.status).toBe("ERROR");
    expect(prisma.integration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ERROR" }) })
    );
  });

  it("marks ERROR and re-throws when the token exchange itself fails", async () => {
    (metaOAuthClient.exchangeCodeForToken as jest.Mock).mockRejectedValue(new Error("invalid_grant"));

    await expect(completeConnect("bad_code", "biz_1", "WHATSAPP_BUSINESS", secrets as any)).rejects.toThrow("invalid_grant");
    expect(prisma.integration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ERROR", lastError: "invalid_grant" }) })
    );
  });
});

describe("selectAccount", () => {
  it("rejects finalizing when there's no pending connection (no secretRef on file)", async () => {
    (prisma.integration.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "int_1", secretRef: null });

    await expect(selectAccount("biz_1", "WHATSAPP_BUSINESS", "phone_1", "owner_1")).rejects.toThrow(/start the connect flow again/i);
  });

  it("finalizes the connection with the chosen account and audits it", async () => {
    (prisma.integration.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "int_1", secretRef: "integration:biz_1:WHATSAPP_BUSINESS" });
    (prisma.integration.update as jest.Mock).mockResolvedValue({ status: "CONNECTED" });

    await selectAccount("biz_1", "WHATSAPP_BUSINESS", "phone_2", "owner_1");

    expect(prisma.integration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CONNECTED", externalId: "phone_2" }) })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "connect" }));
  });
});

describe("listCandidateAccounts", () => {
  it("re-derives the list live from the stored token rather than persisting it separately", async () => {
    (prisma.integration.findUniqueOrThrow as jest.Mock).mockResolvedValue({ secretRef: "integration:biz_1:INSTAGRAM" });
    secrets.getSecret.mockResolvedValue("long_lived_token");
    (metaOAuthClient.listInstagramAccounts as jest.Mock).mockResolvedValue([{ igAccountId: "ig_1", username: "big_kitchen_hair" }]);

    const result = await listCandidateAccounts("biz_1", "INSTAGRAM", secrets as any);

    expect(result).toEqual([{ id: "ig_1", label: "big_kitchen_hair" }]);
  });
});

describe("disconnectIntegration", () => {
  it("clears the secret and external id, sets DISCONNECTED, and notifies via the event bus", async () => {
    (prisma.integration.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "int_1", secretRef: "integration:biz_1:WHATSAPP_BUSINESS" });
    (prisma.integration.update as jest.Mock).mockResolvedValue({ status: "DISCONNECTED" });

    await disconnectIntegration("biz_1", "WHATSAPP_BUSINESS", "owner_1", secrets as any);

    expect(secrets.deleteSecret).toHaveBeenCalledWith("integration:biz_1:WHATSAPP_BUSINESS");
    expect(prisma.integration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DISCONNECTED", externalId: null, secretRef: null }) })
    );
    expect(eventBus.emit).toHaveBeenCalledWith("integration.disconnected", "biz_1", { provider: "WHATSAPP_BUSINESS" });
  });

  it("still disconnects even if deleting the secret fails (best-effort)", async () => {
    (prisma.integration.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "int_1", secretRef: "integration:biz_1:WHATSAPP_BUSINESS" });
    secrets.deleteSecret.mockRejectedValue(new Error("secrets store unreachable"));
    (prisma.integration.update as jest.Mock).mockResolvedValue({ status: "DISCONNECTED" });

    await expect(disconnectIntegration("biz_1", "WHATSAPP_BUSINESS", "owner_1", secrets as any)).resolves.toBeDefined();
  });
});
