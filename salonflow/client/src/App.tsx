import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { AppointmentsPage } from "@/pages/AppointmentsPage";
import { CalendarPage } from "@/pages/CalendarPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { ServicesPage } from "@/pages/ServicesPage";
import { StaffPage } from "@/pages/StaffPage";
import { PaymentsPage } from "@/pages/PaymentsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { requiresOnboarding } from "@/onboardingRouting";
import { Button } from "@/components/Button";
import { SubscriptionRecoveryPage } from "@/pages/SubscriptionRecoveryPage";

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to={requiresOnboarding(user) ? "/onboarding" : "/"} replace />;
  return <LoginPage />;
}

function RegisterRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to={requiresOnboarding(user) ? "/onboarding" : "/"} replace />;
  return <RegisterPage />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthBootstrapGate />
      </AuthProvider>
    </BrowserRouter>
  );
}

function AuthBootstrapGate() {
  const { loading, bootstrapError, retryBootstrap, logout } = useAuth();
  if (loading) return <AuthLoadingState />;
  if (bootstrapError) return <AuthUnavailableState onRetry={retryBootstrap} onSignOut={logout} />;
  return (
    <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/register" element={<RegisterRoute />} />
          <Route path="/onboarding" element={<OnboardingRoute />} />
          <Route path="/settings/billing" element={<BillingRecoveryRoute />} />
          <Route
            path="/"
            element={
              <OnboardingAppRoute>
                <DashboardPage />
              </OnboardingAppRoute>
            }
          />
          <Route
            path="/appointments"
            element={
              <OnboardingAppRoute>
                <AppointmentsPage />
              </OnboardingAppRoute>
            }
          />
          <Route
            path="/calendar"
            element={
              <OnboardingAppRoute>
                <CalendarPage />
              </OnboardingAppRoute>
            }
          />
          <Route
            path="/clients"
            element={
              <OnboardingAppRoute>
                <ClientsPage />
              </OnboardingAppRoute>
            }
          />
          <Route
            path="/services"
            element={
              <OnboardingAppRoute>
                <ServicesPage />
              </OnboardingAppRoute>
            }
          />
          <Route
            path="/staff"
            element={
              <OnboardingAppRoute>
                <StaffPage />
              </OnboardingAppRoute>
            }
          />
          <Route
            path="/payments"
            element={
              <OnboardingAppRoute>
                <PaymentsPage />
              </OnboardingAppRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <OnboardingAppRoute>
                <ReportsPage />
              </OnboardingAppRoute>
            }
          />
          <Route
            path="/notifications"
            element={
              <OnboardingAppRoute>
                <NotificationsPage />
              </OnboardingAppRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <OnboardingAppRoute>
                <SettingsPage />
              </OnboardingAppRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AuthLoadingState() {
  return <div className="flex min-h-screen items-center justify-center bg-workspace px-4"><div className="text-center"><p className="font-display text-2xl text-ink">SalonFlow</p><p className="mt-2 text-sm text-ink-muted">Checking your session…</p></div></div>;
}

function AuthUnavailableState({ onRetry, onSignOut }: { onRetry: () => Promise<void>; onSignOut: () => void }) {
  const retry = () => { void onRetry(); };
  return <div className="flex min-h-screen items-center justify-center bg-workspace px-4"><div className="w-full max-w-sm rounded-lg border border-line bg-paper-raised p-6 text-center shadow-card"><p className="font-display text-2xl text-ink">SalonFlow</p><h1 className="mt-5 text-lg font-medium text-ink">SalonFlow is temporarily unavailable</h1><p className="mt-2 text-sm text-ink-muted">Your session is preserved. Please try again shortly.</p><div className="mt-5 flex justify-center gap-3"><Button onClick={retry}>Retry</Button><Button variant="secondary" onClick={onSignOut}>Sign out</Button></div></div></div>;
}

function OnboardingRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!requiresOnboarding(user)) return <Navigate to="/" replace />;
  return <OnboardingPage />;
}
function OnboardingAppRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (requiresOnboarding(user)) return <Navigate to="/onboarding" replace />;
  if (!user.subscription?.accessAllowed) return <SubscriptionRecoveryPage />;
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

function BillingRecoveryRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (requiresOnboarding(user)) return <Navigate to="/onboarding" replace />;
  if (user.subscription?.accessAllowed) return <Navigate to="/settings" replace />;
  return <SubscriptionRecoveryPage />;
}
