import { useQuery } from "@tanstack/react-query";
import { reportsApi } from "@/api/resources";
import type { ReportRangeInput } from "@/api/resources";

export function useRevenueReport(range: ReportRangeInput) {
  return useQuery({ queryKey: ["reports", "revenue", range], queryFn: () => reportsApi.revenue(range) });
}

export function useOutcomeReport(range: ReportRangeInput) {
  return useQuery({ queryKey: ["reports", "outcomes", range], queryFn: () => reportsApi.outcomes(range) });
}

export function usePopularServicesReport(range: ReportRangeInput) {
  return useQuery({ queryKey: ["reports", "popular-services", range], queryFn: () => reportsApi.popularServices(range) });
}

export function useStaffPerformanceReport(range: ReportRangeInput) {
  return useQuery({ queryKey: ["reports", "staff-performance", range], queryFn: () => reportsApi.staffPerformance(range) });
}

export function useClientRetentionReport() {
  return useQuery({ queryKey: ["reports", "client-retention"], queryFn: reportsApi.clientRetention });
}
