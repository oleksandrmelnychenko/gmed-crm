import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";

const ChatPage = lazy(() =>
  import("@/pages/chat").then((module) => ({
    default: module.ChatPage,
  })),
);

const AppointmentsPage = lazy(() =>
  import("@/pages/appointments").then((module) => ({
    default: module.AppointmentsPage,
  })),
);

const ProvidersPage = lazy(() =>
  import("@/pages/providers").then((module) => ({
    default: module.ProvidersPage,
  })),
);

const PatientsPage = lazy(() =>
  import("@/pages/patients").then((module) => ({
    default: module.PatientsPage,
  })),
);

const LeadsPage = lazy(() =>
  import("@/pages/leads").then((module) => ({
    default: module.LeadsPage,
  })),
);

const OrdersPage = lazy(() =>
  import("@/pages/orders").then((module) => ({
    default: module.OrdersPage,
  })),
);

const CasesPage = lazy(() =>
  import("@/pages/cases").then((module) => ({
    default: module.CasesPage,
  })),
);

const AdminUsersPage = lazy(() =>
  import("@/pages/admin-users").then((module) => ({
    default: module.AdminUsersPage,
  })),
);

const AdminAccessPage = lazy(() =>
  import("@/pages/admin-access").then((module) => ({
    default: module.AdminAccessPage,
  })),
);

const AdminSettingsPage = lazy(() =>
  import("@/pages/admin-settings").then((module) => ({
    default: module.AdminSettingsPage,
  })),
);

const AdminActivityPage = lazy(() =>
  import("@/pages/admin-activity").then((module) => ({
    default: module.AdminActivityPage,
  })),
);

const AdminSecurityPage = lazy(() =>
  import("@/pages/admin-security").then((module) => ({
    default: module.AdminSecurityPage,
  })),
);

const AdminHealthPage = lazy(() =>
  import("@/pages/admin-health").then((module) => ({
    default: module.AdminHealthPage,
  })),
);

const AdminCompliancePage = lazy(() =>
  import("@/pages/admin-compliance").then((module) => ({
    default: module.AdminCompliancePage,
  })),
);

const AdminNotificationsPage = lazy(() =>
  import("@/pages/admin-notifications").then((module) => ({
    default: module.AdminNotificationsPage,
  })),
);

const AdminCustomFieldsPage = lazy(() =>
  import("@/pages/admin-custom-fields").then((module) => ({
    default: module.AdminCustomFieldsPage,
  })),
);

const AdminAnnouncementsPage = lazy(() =>
  import("@/pages/admin-announcements").then((module) => ({
    default: module.AdminAnnouncementsPage,
  })),
);

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider>
          <Suspense fallback={<div className="min-h-screen bg-background" />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="chat" element={<ChatPage />} />
                <Route path="leads" element={<LeadsPage />} />
                <Route path="patients" element={<PatientsPage />} />
                <Route path="providers" element={<ProvidersPage />} />
                <Route path="orders" element={<OrdersPage />} />
                <Route path="cases" element={<CasesPage />} />
                <Route path="appointments" element={<AppointmentsPage />} />
                <Route path="admin/users" element={<AdminUsersPage />} />
                <Route path="admin/access" element={<AdminAccessPage />} />
                <Route path="admin/settings" element={<AdminSettingsPage />} />
                <Route path="admin/activity" element={<AdminActivityPage />} />
                <Route path="admin/security" element={<AdminSecurityPage />} />
                <Route path="admin/health" element={<AdminHealthPage />} />
                <Route path="admin/compliance" element={<AdminCompliancePage />} />
                <Route path="admin/notifications" element={<AdminNotificationsPage />} />
                <Route path="admin/custom-fields" element={<AdminCustomFieldsPage />} />
                <Route path="admin/announcements" element={<AdminAnnouncementsPage />} />
              </Route>
            </Routes>
          </Suspense>
        </TooltipProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
