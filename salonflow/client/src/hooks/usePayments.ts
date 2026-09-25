import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { paymentsApi } from "@/api/resources";

export function usePayments() {
  return useQuery({ queryKey: ["payments"], queryFn: paymentsApi.list });
}

export function useOutstandingBalance(appointmentId: string | null) {
  return useQuery({
    queryKey: ["payments", "outstanding", appointmentId],
    queryFn: () => paymentsApi.outstanding(appointmentId!),
    enabled: Boolean(appointmentId),
  });
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: paymentsApi.record,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}
