import { Router } from "express";
import { requireMetaMessaging } from "../middleware/publicMessaging";
import { verifyOAuthState, InvalidOAuthStateError } from "../core/oauthState";
import { completeConnect } from "../modules/integrations/integrationService";
import { resolveProviderSlug } from "../modules/integrations/providerSlug";
import { secretsProvider } from "../modules/ai/secretsProvider";

export const integrationsCallbackRouter = Router();

/**
 * This is a full browser navigation (Meta redirects the owner's browser
 * here, it isn't a fetch() call from a frontend app), so it responds with
 * a minimal HTML page rather than JSON. Swap `renderResultPage` for a
 * redirect to the real frontend's Settings → Integrations page once one
 * exists — this endpoint's job (verify state, exchange the code, update
 * the Integration row) doesn't change either way.
 */
integrationsCallbackRouter.get("/:provider/callback", requireMetaMessaging, async (req, res) => {
  try {
    const provider = resolveProviderSlug(req.params.provider);
    const { code, state, error, error_description } = req.query as Record<string, string>;

    if (error) {
      return res.status(400).send(renderResultPage("error", `Meta reported: ${error_description ?? error}`));
    }
    if (!code || !state) {
      return res.status(400).send(renderResultPage("error", "Missing code or state parameter"));
    }

    const statePayload = verifyOAuthState(state);
    if (statePayload.provider !== provider) {
      return res.status(400).send(renderResultPage("error", "Provider mismatch — please restart the connection"));
    }

    const result = await completeConnect(code, statePayload.businessId, provider, secretsProvider);

    if (result.status === "CONNECTED") {
      return res.send(renderResultPage("success", "Connected! You can close this window and return to SalonFlow."));
    }
    if (result.status === "NEEDS_SETUP") {
      const list = (result.candidates ?? []).map((c) => `${c.label} (${c.id})`).join(", ");
      return res.send(
        renderResultPage("needs_setup", `Multiple accounts were found: ${list}. Return to SalonFlow's Integrations settings to pick one.`)
      );
    }
    return res.status(400).send(renderResultPage("error", "No connectable WhatsApp/Instagram account was found for that login."));
  } catch (err: any) {
    const message = err instanceof InvalidOAuthStateError ? err.message : "Something went wrong connecting this account.";
    res.status(400).send(renderResultPage("error", message));
  }
});

function renderResultPage(kind: "success" | "error" | "needs_setup", message: string): string {
  const title = kind === "success" ? "Connected" : kind === "needs_setup" ? "Almost done" : "Connection failed";
  return `<!DOCTYPE html><html><body style="font-family: -apple-system, sans-serif; padding: 2rem; max-width: 480px; margin: auto;">
    <h2>${title}</h2>
    <p>${message}</p>
  </body></html>`;
}
