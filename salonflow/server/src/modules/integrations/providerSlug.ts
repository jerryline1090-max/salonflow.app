import { IntegrationProvider } from "@prisma/client";

/** Keeps URLs readable (`/api/integrations/whatsapp/connect`) without exposing the Prisma enum's exact spelling. */
export function resolveProviderSlug(slug: string): IntegrationProvider {
  if (slug === "whatsapp") return "WHATSAPP_BUSINESS";
  if (slug === "instagram") return "INSTAGRAM";
  throw new Error(`Unknown integration provider "${slug}"`);
}
