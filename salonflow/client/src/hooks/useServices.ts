import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { servicesApi } from "@/api/resources";

// The base list query (useServices) lives in hooks/useAppData.ts, already
// used by CreateAppointmentModal — this file only adds the single-record
// query and the mutations, so there's exactly one place each hook is defined.

export function useService(id: string | null) {
  return useQuery({ queryKey: ["services", id], queryFn: () => servicesApi.get(id!), enabled: Boolean(id) });
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: servicesApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["services"] }),
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof servicesApi.update>[1] }) => servicesApi.update(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["services"] }),
  });
}

export function useDeactivateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => servicesApi.deactivate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["services"] }),
  });
}
