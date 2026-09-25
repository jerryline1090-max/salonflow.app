import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clientsApi, notificationsApi, servicesApi, settingsApi, staffApi } from "@/api/resources";

export function useClients() {
  return useQuery({ queryKey: ["clients"], queryFn: clientsApi.list });
}

export function useClient(id: string | null) {
  return useQuery({ queryKey: ["clients", id], queryFn: () => clientsApi.get(id!), enabled: Boolean(id) });
}

export function useClientStats(id: string | null) {
  return useQuery({ queryKey: ["clients", id, "stats"], queryFn: () => clientsApi.stats(id!), enabled: Boolean(id) });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clientsApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clients"] }),
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof clientsApi.update>[1] }) => clientsApi.update(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clients"] }),
  });
}

export function useServices() {
  return useQuery({ queryKey: ["services"], queryFn: servicesApi.list });
}

export function useStaff() {
  return useQuery({ queryKey: ["staff"], queryFn: staffApi.list });
}

export function useBusiness() {
  return useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
}

export function useNotifications(filters?: { unreadOnly?: boolean; limit?: number }) {
  return useQuery({
    queryKey: ["notifications", filters],
    queryFn: () => notificationsApi.list(filters),
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
