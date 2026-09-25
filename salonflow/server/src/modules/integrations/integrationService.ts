import { IntegrationProvider, IntegrationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../core/auditLog";
import { eventBus } from "../../core/eventBus";
import { signOAuthState } from "../../core/oauthState";
import { SecretsProvider } from "../ai/secretsProvider";
import {
  metaCredentialsFromEnv,
  WHATSAPP_SCOPES,
  INSTAGRAM_SCOPES,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listWhatsAppBusinessAccounts,
  listInstagramAccounts,
} from "./metaOAuthClient";

/**
 * Section 19–20 (master spec): "Integration states should include: Not
 * connected, Connecting, Connected, Needs setup, Needs reauthorization,
 * Disconnected, Error." This file is the state machine that actually
 * drives `Integration.status` through those states — every function here
 * is a legitimate transition; nothing else in the codebase writes to this
 * table.
 */

export function buildSecretRef(businessId: string, provider: IntegrationProvider): string {
  return `integration:${businessId}:${provider}`;
}

export async function listIntegrations(businessId: string) {
  return prisma.integration.findMany({ where: { businessId } });
}

/** Section 19: kicks off Meta's official OAuth flow. Returns the URL the owner's browser should be sent to — SalonFlow never sees a password. */
export async function beginConnect(businessId: string, provider: IntegrationProvider, actorUserId: string): Promise<string> {
  const creds = metaCredentialsFromEnv();
  const scopes = provider === "WHATSAPP_BUSINESS" ? WHATSAPP_SCOPES : INSTAGRAM_SCOPES;
  const state = signOAuthState({ businessId, provider, actorUserId });

  await prisma.integration.upsert({
    where: { businessId_provider: { businessId, provider } },
    create: { businessId, provider, status: "CONNECTING" },
    update: { status: "CONNECTING", lastError: null },
  });

  return buildAuthorizationUrl(creds, scopes, state);
}

export interface CompleteConnectResult {
  status: IntegrationStatus;
  candidates?: { id: string; label: string }[];
}

/**
 * Handles Meta's redirect back with an authorization code. Three outcomes:
 *   - No connectable account found → ERROR (something about the Meta-side
 *     setup is incomplete — e.g. no WhatsApp number registered yet)
 *   - Exactly one candidate → auto-selected, CONNECTED immediately
 *   - Multiple candidates (a business with several numbers/pages) →
 *     NEEDS_SETUP, owner picks via `selectAccount` below
 */
export async function completeConnect(
  code: string,
  businessId: string,
  provider: IntegrationProvider,
  secrets: SecretsProvider
): Promise<CompleteConnectResult> {
  const creds = metaCredentialsFromEnv();

  try {
    const shortLived = await exchangeCodeForToken(creds, code);
    const longLived = await exchangeForLongLivedToken(creds, shortLived.accessToken);
    const secretRef = buildSecretRef(businessId, provider);
    await secrets.setSecret(secretRef, longLived.accessToken);

    const candidates =
      provider === "WHATSAPP_BUSINESS"
        ? (await listWhatsAppBusinessAccounts(longLived.accessToken)).map((a) => ({ id: a.phoneNumberId, label: a.displayPhoneNumber }))
        : (await listInstagramAccounts(longLived.accessToken)).map((a) => ({ id: a.igAccountId, label: a.username }));

    if (candidates.length === 0) {
      await prisma.integration.update({
        where: { businessId_provider: { businessId, provider } },
        data: { status: "ERROR", lastError: "No connectable WhatsApp/Instagram account was found for this login" },
      });
      return { status: "ERROR" };
    }

    if (candidates.length === 1) {
      await finalizeConnect(businessId, provider, candidates[0].id, secretRef);
      return { status: "CONNECTED" };
    }

    await prisma.integration.update({
      where: { businessId_provider: { businessId, provider } },
      data: { status: "NEEDS_SETUP", secretRef, lastError: null },
    });
    return { status: "NEEDS_SETUP", candidates };
  } catch (err: any) {
    await prisma.integration.update({
      where: { businessId_provider: { businessId, provider } },
      data: { status: "ERROR", lastError: err.message },
    });
    throw err;
  }
}

async function finalizeConnect(businessId: string, provider: IntegrationProvider, externalId: string, secretRef: string) {
  await prisma.integration.update({
    where: { businessId_provider: { businessId, provider } },
    data: { status: "CONNECTED", externalId, secretRef, lastSyncedAt: new Date(), lastError: null },
  });
}

/** Re-derives the candidate list live from the token already on file — nothing extra needs to be persisted while NEEDS_SETUP. */
export async function listCandidateAccounts(businessId: string, provider: IntegrationProvider, secrets: SecretsProvider) {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { businessId_provider: { businessId, provider } } });
  if (!integration.secretRef) {
    throw new Error("No pending connection to finish setting up — start the connect flow again");
  }
  const token = await secrets.getSecret(integration.secretRef);
  return provider === "WHATSAPP_BUSINESS"
    ? (await listWhatsAppBusinessAccounts(token)).map((a) => ({ id: a.phoneNumberId, label: a.displayPhoneNumber }))
    : (await listInstagramAccounts(token)).map((a) => ({ id: a.igAccountId, label: a.username }));
}

/** The owner's pick when NEEDS_SETUP presented multiple candidates. */
export async function selectAccount(businessId: string, provider: IntegrationProvider, externalId: string, actorUserId: string) {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { businessId_provider: { businessId, provider } } });
  if (!integration.secretRef) {
    throw new Error("No pending connection to finalize — start the connect flow again");
  }

  await finalizeConnect(businessId, provider, externalId, integration.secretRef);

  await writeAuditLog({
    businessId,
    actorUserId,
    resource: "integration",
    resourceId: integration.id,
    action: "connect",
    newValue: { externalId },
  });
}

/** Section 19/20: disconnect never happens silently — it's audited, and any inbound webhook to a now-disconnected integration is ignored by the webhook route's own CONNECTED-only lookup. */
export async function disconnectIntegration(
  businessId: string,
  provider: IntegrationProvider,
  actorUserId: string,
  secrets: SecretsProvider
) {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { businessId_provider: { businessId, provider } } });

  if (integration.secretRef) {
    // Best-effort: don't let a secrets-store hiccup block the owner from disconnecting.
    await secrets.deleteSecret(integration.secretRef).catch(() => {});
  }

  const updated = await prisma.integration.update({
    where: { businessId_provider: { businessId, provider } },
    data: { status: "DISCONNECTED", externalId: null, secretRef: null, lastError: null },
  });

  await writeAuditLog({ businessId, actorUserId, resource: "integration", resourceId: integration.id, action: "disconnect" });
  await eventBus.emit("integration.disconnected", businessId, { provider });

  return updated;
}
