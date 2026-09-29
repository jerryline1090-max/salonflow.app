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
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/register" element={<RegisterRoute />} />
          <Route path="/onboarding" element={<OnboardingRoute />} />
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
      </AuthProvider>
    </BrowserRouter>
  );
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
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
