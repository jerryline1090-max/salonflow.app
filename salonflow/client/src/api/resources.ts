import { api } from "./client";
import type {
  Appointment,
  AppointmentStatus,
  Business,
  BusinessHoursEntry,
  Client,
  ClientRetentionReport,
  ClientStats,
  Integration,
  IntegrationCandidate,
  LocationType,
  NotificationItem,
  OutcomeReport,
  OutstandingBalance,
  Payment,
  PaymentMethod,
  PopularServiceEntry,
  RevenueReport,
  Service,
  StaffMember,
  StaffPerformanceEntry,
  StaffScheduleEntry,
  StaffStatusChangeResult,
  TeamMember,
  User,
  SubscriptionDetails,
  PaginatedResult,
} from "@/types";

export const authApi = {
  login: (email: string, password: string) => api.post<{ token: string; user: User }>("/auth/login", { email, password }),
  register: (input: { businessName: string; ownerName: string; email: string; password: string; phone: string; referralCode?: string }) =>
    api.post<{ token: string; user: Pick<User, "id" | "name" | "email" | "role" | "businessId">; business: Pick<Business, "id" | "name"> }>("/auth/register", input),
  me: () => api.get<User>("/auth/me"),
};

export const subscriptionApi = {
  get: () => api.get<SubscriptionDetails>("/subscription"),
  checkout: (planCode: "STARTER" | "GROWTH" | "PRO") => api.post<{ authorizationUrl: string; accessCode: string; reference: string }>("/subscription/checkout", { planCode }),
  history: () => api.get<Array<{ id: string; amount: number; currency: string; status: string; paidAt: string | null; occurredAt: string }>>("/subscription/history"),
  cancel: () => api.post<{ cancelAtPeriodEnd: boolean; currentPeriodEndsAt: string | null }>("/subscription/cancel"),
  undoCancel: () => api.post<{ cancelAtPeriodEnd: boolean; currentPeriodEndsAt: string | null }>("/subscription/cancel/undo"),
};

export interface ReferralSummary {
  referralCode: string;
  referralLink: string;
  counts: { attributed: number; rewarded: number };
  creditBalance: number;
  referrals: Array<{ id: string; status: "ATTRIBUTED" | "REWARDED" | "REVERSED"; referralCode: string; createdAt: string; rewardedAt: string | null }>;
  credits: Array<{ id: string; amount: number; direction: "CREDIT" | "DEBIT"; reason: string; createdAt: string }>;
}

export const referralsApi = {
  get: () => api.get<ReferralSummary>("/referrals"),
};

export interface OnboardingState { onboardingStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED"; onboardingStep: "BUSINESS_DETAILS" | "SERVICES" | "BUSINESS_HOURS" | "TEAM" | "INTEGRATIONS" | "REVIEW" | null; onboardingCompletedAt?: string | null; }
export interface OnboardingReview { business: { name: string; phone?: string | null; timezone: string }; workingHours: BusinessHoursEntry[]; activeServiceCount: number; teamAccountCount: number; integrations: Integration[]; }
export const onboardingApi = {
  state: () => api.get<OnboardingState>("/onboarding"),
  advance: () => api.post<OnboardingState>("/onboarding/advance"),
  skip: () => api.post<OnboardingState>("/onboarding/skip"),
  review: () => api.get<OnboardingReview>("/onboarding/review"),
  complete: () => api.post<OnboardingState>("/onboarding/complete"),
  createService: (input: { name: string; category?: string; price: number; durationMinutes: number }) => api.post<Service>("/onboarding/service", input),
  saveBusinessHours: (hours: BusinessHoursEntry[]) => api.post<OnboardingState>("/onboarding/business-hours", { hours }),
};

export const settingsApi = {
  get: () => api.get<Business>("/settings"),
  update: (updates: Partial<Business>) => api.put<Business>("/settings", updates),
  setWorkingHours: (hours: BusinessHoursEntry[]) => api.put<{ success: true }>("/settings/working-hours", { hours }),
};

export const appointmentsApi = {
  list: (filters?: { from?: string; to?: string; status?: AppointmentStatus; needsAttention?: boolean; clientId?: string; page?: number; limit?: number }) =>
    api.get<PaginatedResult<Appointment>>("/appointments", filters),
  get: (id: string) => api.get<Appointment>(`/appointments/${id}`),
  create: (input: {
    clientId: string;
    serviceId: string;
    staffId: string;
    startsAt: string;
    locationType: LocationType;
    homeAddress?: string;
    notes?: string;
  }) => api.post<Appointment>("/appointments", input),
  changeStatus: (id: string, newStatus: AppointmentStatus, reason?: string) =>
    api.post<Appointment>(`/appointments/${id}/status`, { newStatus, reason }),
  reschedule: (id: string, newStartsAt: string) => api.post<Appointment>(`/appointments/${id}/reschedule`, { newStartsAt }),
  reassign: (id: string, newStaffId: string, reason?: string) =>
    api.post<Appointment>(`/appointments/${id}/reassign`, { newStaffId, reason }),
};

export const clientsApi = {
  list: (page = 1, limit = 25, q?: string) => api.get<PaginatedResult<Client>>("/clients", { page, limit, ...(q ? { q } : {}) }),
  count: () => api.get<{ count: number }>("/clients/count"),
  get: (id: string) => api.get<Client>(`/clients/${id}`),
  stats: (id: string) => api.get<ClientStats>(`/clients/${id}/stats`),
  create: (input: { name: string; phone?: string; email?: string; address?: string; notes?: string }) =>
    api.post<Client>("/clients", input),
  update: (id: string, updates: Partial<{ name: string; phone: string; email: string; address: string; notes: string }>) =>
    api.put<Client>(`/clients/${id}`, updates),
};

export const servicesApi = {
  list: () => api.get<Service[]>("/services"),
  get: (id: string) => api.get<Service>(`/services/${id}`),
  create: (input: {
    name: string;
    description?: string;
    category?: string;
    price: number;
    durationMinutes: number;
    bufferMinutes?: number;
    availableAtSalon?: boolean;
    availableAtHome?: boolean;
    homeTravelBufferMins?: number;
    requiredSkills?: string[];
  }) => api.post<Service>("/services", input),
  update: (id: string, updates: Partial<Omit<Service, "id" | "requiredSkills">> & { requiredSkills?: string[] }) =>
    api.put<Service>(`/services/${id}`, updates),
  deactivate: (id: string) => api.del<Service>(`/services/${id}`),
};

export const staffApi = {
  list: (page = 1, limit = 25) => api.get<PaginatedResult<StaffMember>>("/staff", { page, limit }),
  get: (id: string) => api.get<StaffMember>(`/staff/${id}`),
  create: (input: {
    name: string;
    phone?: string;
    skills?: string[];
    homeServiceEligible?: boolean;
    commissionPercent?: number;
    serviceIds?: string[];
  }) => api.post<StaffMember>("/staff", input),
  update: (id: string, updates: Partial<{ name: string; phone: string; skills: string[]; homeServiceEligible: boolean; commissionPercent: number }>) =>
    api.put<StaffMember>(`/staff/${id}`, updates),
  setSchedule: (id: string, schedule: StaffScheduleEntry[]) => api.put<StaffScheduleEntry[]>(`/staff/${id}/schedule`, { schedule }),
  setServices: (id: string, serviceIds: string[]) => api.put(`/staff/${id}/services`, { serviceIds }),
  setStatus: (id: string, newStatus: "ACTIVE" | "INACTIVE" | "REMOVED") =>
    api.post<StaffStatusChangeResult>(`/staff/${id}/status`, { newStatus }),
};

export type ReportRangeInput = { days: number } | { period: "today" | "current-month" };

function reportQuery(range: ReportRangeInput) {
  return "days" in range ? { days: String(range.days) } : { period: range.period };
}

export const reportsApi = {
  revenue: (range: ReportRangeInput) => api.get<RevenueReport>("/reports/revenue", reportQuery(range)),
  outcomes: (range: ReportRangeInput) => api.get<OutcomeReport>("/reports/outcomes", reportQuery(range)),
  popularServices: (range: ReportRangeInput) => api.get<PopularServiceEntry[]>("/reports/popular-services", reportQuery(range)),
  staffPerformance: (range: ReportRangeInput) => api.get<StaffPerformanceEntry[]>("/reports/staff-performance", reportQuery(range)),
  clientRetention: () => api.get<ClientRetentionReport>("/reports/client-retention"),
};

export const paymentsApi = {
  list: (page = 1, limit = 25) => api.get<PaginatedResult<Payment>>("/payments", { page, limit }),
  record: (input: { appointmentId?: string; clientId: string; amount: number; method: PaymentMethod }) =>
    api.post<Payment>("/payments", input),
  outstanding: (appointmentId: string) => api.get<OutstandingBalance>(`/payments/appointments/${appointmentId}/outstanding`),
};

export const integrationsApi = {
  list: () => api.get<Integration[]>("/integrations"),
  connect: (provider: "whatsapp" | "instagram") => api.post<{ authorizationUrl: string }>(`/integrations/${provider}/connect`),
  candidates: (provider: "whatsapp" | "instagram") => api.get<IntegrationCandidate[]>(`/integrations/${provider}/candidates`),
  selectAccount: (provider: "whatsapp" | "instagram", externalId: string) =>
    api.post<{ success: true }>(`/integrations/${provider}/select-account`, { externalId }),
  disconnect: (provider: "whatsapp" | "instagram") => api.post<Integration>(`/integrations/${provider}/disconnect`),
};

export const teamApi = {
  list: () => api.get<TeamMember[]>("/auth/team"),
  invite: (input: { name: string; email: string; password: string; role: "MANAGER" | "STAFF" }) =>
    api.post<TeamMember>("/auth/team", input),
};

export const notificationsApi = {
  list: (filters?: { unreadOnly?: boolean; limit?: number }) => api.get<NotificationItem[]>("/notifications", filters),
  markRead: (id: string) => api.post<NotificationItem>(`/notifications/${id}/read`),
};

export const assistantApi = {
  ask: (message: string, currentPage: string) => api.post<{ reply: string }>("/assistant/ask", { message, currentPage }),
};
