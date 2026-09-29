import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clientsApi, notificationsApi, servicesApi, settingsApi, staffApi } from "@/api/resources";

export function useClients(page = 1, limit = 25, search?: string) {
  return useQuery({ queryKey: ["clients", page, limit, search ?? ""], queryFn: () => clientsApi.list(page, limit, search), placeholderData: (previousData) => previousData, staleTime: 60_000 });
}

export function useClientCount() {
  return useQuery({ queryKey: ["clients", "count"], queryFn: clientsApi.count, staleTime: 30_000 });
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
  return useQuery({ queryKey: ["services"], queryFn: servicesApi.list, staleTime: 5 * 60_000, refetchOnWindowFocus: false });
}

export function useStaff(page = 1, limit = 25) {
  return useQuery({ queryKey: ["staff", page, limit], queryFn: () => staffApi.list(page, limit), placeholderData: (previousData) => previousData, staleTime: 60_000 });
}

export function useBusiness() {
  return useQuery({ queryKey: ["settings"], queryFn: settingsApi.get, staleTime: 5 * 60_000, refetchOnWindowFocus: false });
}

export function useNotifications(filters?: { unreadOnly?: boolean; limit?: number }) {
  return useQuery({
    queryKey: ["notifications", filters],
    queryFn: () => notificationsApi.list(filters),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
