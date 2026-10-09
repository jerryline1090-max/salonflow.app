import { Router } from "express";
import { requireMetaMessaging } from "../middleware/publicMessaging";
import { requirePermission } from "../middleware/authorize";
import { resolveProviderSlug } from "../modules/integrations/providerSlug";
import { secretsProvider } from "../modules/ai/secretsProvider";
import {
  listIntegrations,
  beginConnect,
  listCandidateAccounts,
  selectAccount,
  disconnectIntegration,
} from "../modules/integrations/integrationService";

export const integrationsRouter = Router();

integrationsRouter.get("/", requirePermission("integrations", "view"), async (req, res) => {
  const integrations = await listIntegrations(req.actor!.businessId!);
  res.json(integrations);
});

// Starts Meta's official OAuth flow (section 19). The frontend redirects
// the owner's browser to the returned URL — SalonFlow itself never
// collects a WhatsApp/Facebook/Instagram password.
integrationsRouter.post("/:provider/connect", requireMetaMessaging, requirePermission("integrations", "edit"), async (req, res) => {
  try {
    const provider = resolveProviderSlug(req.params.provider);
    const authorizationUrl = await beginConnect(req.actor!.businessId!, provider, req.actor!.userId);
    res.json({ authorizationUrl });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// While status is NEEDS_SETUP (multiple WhatsApp numbers / Instagram
// accounts available to the connected login), lists them so the owner can pick.
integrationsRouter.get("/:provider/candidates", requireMetaMessaging, requirePermission("integrations", "view"), async (req, res) => {
  try {
    const provider = resolveProviderSlug(req.params.provider);
    const candidates = await listCandidateAccounts(req.actor!.businessId!, provider, secretsProvider);
    res.json(candidates);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

integrationsRouter.post("/:provider/select-account", requireMetaMessaging, requirePermission("integrations", "edit"), async (req, res) => {
  try {
    const provider = resolveProviderSlug(req.params.provider);
    await selectAccount(req.actor!.businessId!, provider, req.body.externalId, req.actor!.userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

integrationsRouter.post("/:provider/disconnect", requirePermission("integrations", "edit"), async (req, res) => {
  try {
    const provider = resolveProviderSlug(req.params.provider);
    const updated = await disconnectIntegration(req.actor!.businessId!, provider, req.actor!.userId, secretsProvider);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
