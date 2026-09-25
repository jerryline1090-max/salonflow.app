import { useQuery } from "@tanstack/react-query";
import { reportsApi } from "@/api/resources";

export function useRevenueReport(from: string, to: string) {
  return useQuery({ queryKey: ["reports", "revenue", from, to], queryFn: () => reportsApi.revenue(from, to) });
}

export function useOutcomeReport(from: string, to: string) {
  return useQuery({ queryKey: ["reports", "outcomes", from, to], queryFn: () => reportsApi.outcomes(from, to) });
}

export function usePopularServicesReport(from: string, to: string) {
  return useQuery({ queryKey: ["reports", "popular-services", from, to], queryFn: () => reportsApi.popularServices(from, to) });
}

export function useStaffPerformanceReport(from: string, to: string) {
  return useQuery({ queryKey: ["reports", "staff-performance", from, to], queryFn: () => reportsApi.staffPerformance(from, to) });
}

export function useClientRetentionReport() {
  return useQuery({ queryKey: ["reports", "client-retention"], queryFn: reportsApi.clientRetention });
}
