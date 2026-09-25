import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { staffApi } from "@/api/resources";
import type { StaffScheduleEntry } from "@/types";

// The base list query (useStaff) lives in hooks/useAppData.ts — this file
// adds the single-record query and every mutation.

export function useStaffMember(id: string | null) {
  return useQuery({ queryKey: ["staff", id], queryFn: () => staffApi.get(id!), enabled: Boolean(id) });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: staffApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof staffApi.update>[1] }) => staffApi.update(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useSetStaffSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, schedule }: { id: string; schedule: StaffScheduleEntry[] }) => staffApi.setSchedule(id, schedule),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useSetStaffServices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, serviceIds }: { id: string; serviceIds: string[] }) => staffApi.setServices(id, serviceIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useSetStaffStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: "ACTIVE" | "INACTIVE" | "REMOVED" }) => staffApi.setStatus(id, newStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
}
