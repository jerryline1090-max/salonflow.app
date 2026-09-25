/**
 * Section 19 (master spec): "Use Meta's official onboarding/authorization
 * process. Do not collect WhatsApp/Facebook passwords directly inside
 * SalonFlow." This file is that boundary — it only ever sees an
 * authorization `code` Meta hands back after the owner approves access on
 * Meta's own login page, never a password.
 *
 * WhatsApp Business and Instagram both run through the same Facebook OAuth
 * dialog and Graph API token endpoints, just with different scopes and a
 * different "which asset can this token manage" follow-up call.
 *
 * NOTE: not exercised against live Meta endpoints in this environment (no
 * network access here). Shapes match Meta's documented Graph API as of
 * this writing — verify against a real Meta App before production use.
 */

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";
const OAUTH_DIALOG_BASE = "https://www.facebook.com/v19.0/dialog/oauth";

export interface MetaAppCredentials {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export function metaCredentialsFromEnv(): MetaAppCredentials {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_OAUTH_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) {
    throw new Error("META_APP_ID, META_APP_SECRET, and META_OAUTH_REDIRECT_URI must all be configured to connect a channel");
  }
  return { appId, appSecret, redirectUri };
}

// whatsapp_business_management/messaging manage the WABA + send/receive;
// business_management is needed to enumerate the businesses the user can act for.
export const WHATSAPP_SCOPES = ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"];
// instagram_basic/manage_messages for reading/sending DMs; pages_show_list
// to find which Facebook Page (and therefore which IG professional account) they manage.
export const INSTAGRAM_SCOPES = ["instagram_basic", "instagram_manage_messages", "pages_show_list", "pages_manage_metadata"];

export function buildAuthorizationUrl(creds: MetaAppCredentials, scopes: string[], state: string): string {
  const params = new URLSearchParams({
    client_id: creds.appId,
    redirect_uri: creds.redirectUri,
    state,
    scope: scopes.join(","),
    response_type: "code",
  });
  return `${OAUTH_DIALOG_BASE}?${params.toString()}`;
}

export interface ExchangedToken {
  accessToken: string;
  expiresInSeconds?: number;
}

export async function exchangeCodeForToken(creds: MetaAppCredentials, code: string): Promise<ExchangedToken> {
  const params = new URLSearchParams({
    client_id: creds.appId,
    client_secret: creds.appSecret,
    redirect_uri: creds.redirectUri,
    code,
  });
  const res = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Meta token exchange failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}

/** Short-lived user tokens are only good for ~1-2 hours; integrations should run on the long-lived (~60 day) version. */
export async function exchangeForLongLivedToken(creds: MetaAppCredentials, shortLivedToken: string): Promise<ExchangedToken> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: creds.appId,
    client_secret: creds.appSecret,
    fb_exchange_token: shortLivedToken,
  });
  const res = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Meta long-lived token exchange failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}

export interface WhatsAppAccountOption {
  phoneNumberId: string;
  displayPhoneNumber: string;
}

/**
 * Which WhatsApp Business phone numbers this token can manage. In practice
 * this walks /me/businesses -> owned_whatsapp_business_accounts ->
 * phone_numbers; simplified here to the shape callers need. Most owners
 * will have exactly one, but a business with multiple numbers needs to
 * pick — see modules/integrations/integrationService.ts's NEEDS_SETUP path.
 */
export async function listWhatsAppBusinessAccounts(accessToken: string): Promise<WhatsAppAccountOption[]> {
  const res = await fetch(
    `${GRAPH_API_BASE}/me/businesses?fields=owned_whatsapp_business_accounts{phone_numbers{id,display_phone_number}}&access_token=${accessToken}`
  );
  if (!res.ok) throw new Error(`Failed to list WhatsApp Business Accounts: ${res.status} ${res.statusText}`);
  const data = await res.json();

  const options: WhatsAppAccountOption[] = [];
  for (const business of data.data ?? []) {
    for (const waba of business.owned_whatsapp_business_accounts?.data ?? []) {
      for (const phone of waba.phone_numbers?.data ?? []) {
        options.push({ phoneNumberId: phone.id, displayPhoneNumber: phone.display_phone_number });
      }
    }
  }
  return options;
}

export interface InstagramAccountOption {
  igAccountId: string;
  username: string;
}

export async function listInstagramAccounts(accessToken: string): Promise<InstagramAccountOption[]> {
  const res = await fetch(`${GRAPH_API_BASE}/me/accounts?fields=name,instagram_business_account{username}&access_token=${accessToken}`);
  if (!res.ok) throw new Error(`Failed to list Instagram accounts: ${res.status} ${res.statusText}`);
  const data = await res.json();

  return (data.data ?? [])
    .filter((page: any) => page.instagram_business_account)
    .map((page: any) => ({ igAccountId: page.instagram_business_account.id, username: page.instagram_business_account.username ?? page.name }));
}
