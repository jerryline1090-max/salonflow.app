import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { integrationsApi } from "@/api/resources";

export function useIntegrations() {
  return useQuery({ queryKey: ["integrations"], queryFn: integrationsApi.list });
}

export function useIntegrationCandidates(provider: "whatsapp" | "instagram", enabled: boolean) {
  return useQuery({
    queryKey: ["integrations", provider, "candidates"],
    queryFn: () => integrationsApi.candidates(provider),
    enabled,
  });
}

export function useConnectIntegration() {
  return useMutation({ mutationFn: (provider: "whatsapp" | "instagram") => integrationsApi.connect(provider) });
}

export function useSelectIntegrationAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, externalId }: { provider: "whatsapp" | "instagram"; externalId: string }) =>
      integrationsApi.selectAccount(provider, externalId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations"] }),
  });
}

export function useDisconnectIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: "whatsapp" | "instagram") => integrationsApi.disconnect(provider),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations"] }),
  });
}
