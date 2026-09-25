import { useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import {
  useIntegrations,
  useConnectIntegration,
  useIntegrationCandidates,
  useSelectIntegrationAccount,
  useDisconnectIntegration,
} from "@/hooks/useIntegrations";
import { ApiError } from "@/api/client";
import type { Integration, IntegrationStatus } from "@/types";

const PROVIDERS: { slug: "whatsapp" | "instagram"; label: string; backendKey: "WHATSAPP_BUSINESS" | "INSTAGRAM" }[] = [
  { slug: "whatsapp", label: "WhatsApp Business", backendKey: "WHATSAPP_BUSINESS" },
  { slug: "instagram", label: "Instagram", backendKey: "INSTAGRAM" },
];

const STATUS_LABELS: Record<IntegrationStatus, string> = {
  NOT_CONNECTED: "Not connected",
  CONNECTING: "Connecting…",
  CONNECTED: "Connected",
  NEEDS_SETUP: "Needs setup",
  NEEDS_REAUTHORIZATION: "Needs reauthorization",
  DISCONNECTED: "Disconnected",
  ERROR: "Error",
};

const STATUS_COLORS: Record<IntegrationStatus, string> = {
  NOT_CONNECTED: "text-ink-muted",
  CONNECTING: "text-info",
  CONNECTED: "text-success",
  NEEDS_SETUP: "text-warning",
  NEEDS_REAUTHORIZATION: "text-warning",
  DISCONNECTED: "text-ink-muted",
  ERROR: "text-danger",
};

export function SettingsIntegrations() {
  const { data: integrations } = useIntegrations();
  const connect = useConnectIntegration();
  const disconnect = useDisconnectIntegration();
  const [error, setError] = useState<string | null>(null);

  function findIntegration(backendKey: string): Integration | undefined {
    return integrations?.find((i) => i.provider === backendKey);
  }

  async function handleConnect(slug: "whatsapp" | "instagram") {
    setError(null);
    try {
      const { authorizationUrl } = await connect.mutateAsync(slug);
      window.location.href = authorizationUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the connection.");
    }
  }

  async function handleDisconnect(slug: "whatsapp" | "instagram") {
    setError(null);
    try {
      await disconnect.mutateAsync(slug);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't disconnect.");
    }
  }

  return (
    <Card className="p-6">
      <p className="mb-1 font-display text-lg text-ink">Integrations</p>
      <p className="mb-4 text-sm text-ink-muted">
        Connects the AI Receptionist to your salon's own WhatsApp Business number and Instagram account — through Meta's own login,
        never a password typed into SalonFlow.
      </p>

      {error && (
        <p className="mb-4 text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {PROVIDERS.map((provider) => {
          const integration = findIntegration(provider.backendKey);
          const status = integration?.status ?? "NOT_CONNECTED";

          return (
            <div key={provider.slug} className="rounded border border-line p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">{provider.label}</p>
                  <p className={`text-xs ${STATUS_COLORS[status]}`}>{STATUS_LABELS[status]}</p>
                </div>
                {status === "CONNECTED" || status === "NEEDS_REAUTHORIZATION" ? (
                  <Button size="sm" variant="secondary" loading={disconnect.isPending} onClick={() => handleDisconnect(provider.slug)}>
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" loading={connect.isPending} onClick={() => handleConnect(provider.slug)}>
                    Connect
                  </Button>
                )}
              </div>

              {status === "NEEDS_SETUP" && <NeedsSetupPanel slug={provider.slug} />}
              {integration?.lastError && <p className="mt-2 text-xs text-danger">{integration.lastError}</p>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function NeedsSetupPanel({ slug }: { slug: "whatsapp" | "instagram" }) {
  const { data: candidates, isLoading } = useIntegrationCandidates(slug, true);
  const selectAccount = useSelectIntegrationAccount();
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(externalId: string) {
    setError(null);
    try {
      await selectAccount.mutateAsync({ provider: slug, externalId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't finish setup.");
    }
  }

  return (
    <div className="mt-3 rounded bg-warning-bg px-3 py-2.5">
      <p className="text-xs text-warning">Multiple accounts were found — pick the one to use:</p>
      {isLoading ? (
        <p className="mt-1.5 text-xs text-ink-muted">Loading…</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {candidates?.map((c) => (
            <Button key={c.id} size="sm" variant="secondary" loading={selectAccount.isPending} onClick={() => handleSelect(c.id)}>
              {c.label}
            </Button>
          ))}
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
