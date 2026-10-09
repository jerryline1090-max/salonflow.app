import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appointmentsApi, staffApi } from "@/api/resources";
import type { AppointmentStatus, LocationType } from "@/types";

export function useCalendarContext() {
  return useQuery({ queryKey: ["appointments", "calendar-context"], queryFn: ({ signal }) => appointmentsApi.calendarContext(signal), staleTime: 60_000 });
}

export function useAppointmentRange(range?: { from: string; to: string }) {
  return useQuery({
    queryKey: ["appointments", "complete-range", range],
    queryFn: ({ signal }) => appointmentsApi.range(range!, signal),
    enabled: Boolean(range),
    staleTime: 10_000,
  });
}

export function useCalendarStaff(enabled: boolean) {
  return useQuery({ queryKey: ["staff", "calendar-directory"], queryFn: ({ signal }) => staffApi.calendar(signal), enabled, staleTime: 60_000 });
}

export function useAppointments(filters?: { from?: string; to?: string; status?: AppointmentStatus; needsAttention?: boolean; clientId?: string; page?: number; limit?: number }, enabled = true) {
  return useQuery({
    queryKey: ["appointments", filters],
    queryFn: () => appointmentsApi.list(filters),
    enabled,
    placeholderData: (previousData) => previousData,
    staleTime: 10_000,
  });
}

export function useAppointment(id: string | null) {
  return useQuery({
    queryKey: ["appointments", id],
    queryFn: () => appointmentsApi.get(id!),
    enabled: Boolean(id),
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      clientId: string;
      serviceId: string;
      staffId: string;
      startsAt: string;
      locationType: LocationType;
      homeAddress?: string;
      notes?: string;
    }) => appointmentsApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
}

export function useChangeAppointmentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, newStatus, reason }: { id: string; newStatus: AppointmentStatus; reason?: string }) =>
      appointmentsApi.changeStatus(id, newStatus, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
}

export function useRescheduleAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, newStartsAt }: { id: string; newStartsAt: string }) => appointmentsApi.reschedule(id, newStartsAt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
}

export function useReassignAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, newStaffId, reason }: { id: string; newStaffId: string; reason?: string }) =>
      appointmentsApi.reassign(id, newStaffId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
}
