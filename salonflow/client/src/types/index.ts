export type Role = "OWNER" | "MANAGER" | "STAFF";
export type PlanCode = "STARTER" | "GROWTH" | "PRO";
export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "GRACE_PERIOD" | "SUSPENDED" | "CANCELLED";
export type SubscriptionAccessState = "FULL_ACCESS" | "RECOVERY" | "SUSPENDED";

export type AppointmentStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
export type LocationType = "SALON" | "HOME";
export type BookingChannel = "DASHBOARD" | "CALENDAR" | "STAFF_APP" | "WEBSITE" | "WHATSAPP" | "INSTAGRAM" | "AI_RECEPTIONIST";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  businessId: string;
  onboarding?: { onboardingStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED"; onboardingStep?: "BUSINESS_DETAILS" | "SERVICES" | "BUSINESS_HOURS" | "TEAM" | "INTEGRATIONS" | "REVIEW" | null };
  subscription?: {
    planCode: PlanCode;
    status: SubscriptionStatus;
    trialEndsAt: string | null;
    graceEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    accessState: SubscriptionAccessState;
    accessAllowed: boolean;
    warning: "PAST_DUE" | "GRACE_PERIOD" | "TRIAL_ENDING" | null;
    trialDaysRemaining: number | null;
  };
}

export interface SubscriptionDetails extends NonNullable<User["subscription"]> {
  displayName?: string;
  currency?: "NGN";
  monthlyPriceMinor?: number;
}

export interface BusinessHoursEntry {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface Business {
  id: string;
  name: string;
  logoUrl?: string | null;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  timezone: string;
  mode: "SALON_ONLY" | "HOME_ONLY" | "BOTH";
  defaultBufferMinutes: number;
  minBookingNoticeMins: number;
  maxBookingHorizonDays: number;
  homeServiceRadiusKm?: number | null;
  homeServiceTravelBufferMins: number;
  reputationEnabled: boolean;
  reputationRequestDelayHours: number;
  reputationHappyThreshold: number;
  googleReviewUrl?: string | null;
  workingHours?: BusinessHoursEntry[];
}

export interface Client {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface Service {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  price: number;
  durationMinutes: number;
  bufferMinutes: number;
  isActive: boolean;
  availableAtSalon: boolean;
  availableAtHome: boolean;
  homeTravelBufferMins?: number | null;
  requiredSkills: string[];
}

export interface StaffScheduleEntry {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isOff: boolean;
}

export interface StaffMember {
  id: string;
  name: string;
  phone?: string | null;
  photoUrl?: string | null;
  skills: string[];
  status: "ACTIVE" | "INACTIVE" | "REMOVED";
  homeServiceEligible: boolean;
  services?: { serviceId: string; service?: Service }[];
  schedule?: StaffScheduleEntry[];
}

export interface AppointmentEvent {
  id: string;
  type: string;
  previousValue?: string | null;
  newValue?: string | null;
  reason?: string | null;
  actorType: string;
  createdAt: string;
}

export interface Appointment {
  id: string;
  status: AppointmentStatus;
  locationType: LocationType;
  homeAddress?: string | null;
  startsAt: string;
  endsAt: string;
  bookingChannel: BookingChannel;
  priceSnapshot: number;
  durationSnapshot: number;
  needsAttention: boolean;
  attentionReason?: string | null;
  notes?: string | null;
  clientId: string;
  serviceId: string;
  staffId: string;
  client?: Client;
  service?: Service;
  staff?: StaffMember;
  events?: AppointmentEvent[];
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  title: string;
  body: string;
  isRead: boolean;
  actionRequired: boolean;
  appointmentId?: string | null;
  createdAt: string;
}

export interface RevenueReport {
  totalRevenue: number;
  paidTransactionCount: number;
  outstandingAmount: number;
}

export interface OutcomeReport {
  completed: number;
  cancelled: number;
  noShow: number;
  needsAttentionCount: number;
}

export interface ClientStats {
  totalVisits: number;
  cancelledCount: number;
  noShowCount: number;
  upcomingCount: number;
  lastVisitAt: string | null;
  totalSpent: number;
}

export interface StaffStatusChangeResult {
  staff: StaffMember;
  affectedAppointments: Appointment[];
}

export type PaymentMethod = "CASH" | "CARD" | "TRANSFER" | "WALLET" | "OTHER";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";

export interface Payment {
  id: string;
  appointmentId?: string | null;
  clientId: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt?: string | null;
  createdAt: string;
  client?: Client;
  appointment?: { service?: Service } | null;
}

export interface OutstandingBalance {
  priceSnapshot: number;
  paidAmount: number;
  outstanding: number;
}

export interface PopularServiceEntry {
  service?: Service;
  completedCount: number;
}

export interface StaffPerformanceEntry {
  staff?: StaffMember;
  completedAppointments: number;
  completedServiceValue: number;
}

export interface ClientRetentionReport {
  totalClients: number;
  returning: number;
  oneTime: number;
  never: number;
}

export type IntegrationProvider = "WHATSAPP_BUSINESS" | "INSTAGRAM";
export type IntegrationStatus =
  | "NOT_CONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "NEEDS_SETUP"
  | "NEEDS_REAUTHORIZATION"
  | "DISCONNECTED"
  | "ERROR";

export interface Integration {
  id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  externalId?: string | null;
  lastError?: string | null;
}

export interface IntegrationCandidate {
  id: string;
  label: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface ApiErrorBody {
  error: string;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
