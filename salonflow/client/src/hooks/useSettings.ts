import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi, teamApi } from "@/api/resources";
import type { Business, BusinessHoursEntry } from "@/types";

export function useTeam() {
  return useQuery({ queryKey: ["team"], queryFn: teamApi.list });
}

export function useInviteTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: teamApi.invite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team"] }),
  });
}

export function useUpdateBusinessSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: Partial<Business>) => settingsApi.update(updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
}

export function useSetWorkingHours() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hours: BusinessHoursEntry[]) => settingsApi.setWorkingHours(hours),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
}
