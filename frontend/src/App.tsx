import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
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

const ContractsPage = lazy(() =>
  import("@/pages/contracts").then((module) => ({
    default: module.ContractsPage,
  })),
);

const InvoicesPage = lazy(() =>
  import("@/pages/invoices").then((module) => ({
    default: module.InvoicesPage,
  })),
);

const CasesPage = lazy(() =>
  import("@/pages/cases").then((module) => ({
    default: module.CasesPage,
  })),
);

const CaseWorkspacePage = lazy(() =>
  import("@/pages/case-workspace").then((module) => ({
    default: module.CaseWorkspacePage,
  })),
);

const DocumentsPage = lazy(() =>
  import("@/pages/documents").then((module) => ({
    default: module.DocumentsPage,
  })),
);

const PatientPrivacyPage = lazy(() =>
  import("@/pages/patient-privacy").then((module) => ({
    default: module.PatientPrivacyPage,
  })),
);

const PatientServicesPage = lazy(() =>
  import("@/pages/patient-services").then((module) => ({
    default: module.PatientServicesPage,
  })),
);

const FeedbackPage = lazy(() =>
  import("@/pages/feedback").then((module) => ({
    default: module.FeedbackPage,
  })),
);

const ReportsPage = lazy(() =>
  import("@/pages/reports").then((module) => ({
    default: module.ReportsPage,
  })),
);

const SopsPage = lazy(() =>
  import("@/pages/sops").then((module) => ({
    default: module.SopsPage,
  })),
);

const PatientDetailPage = lazy(() =>
  import("@/pages/patient-detail").then((module) => ({
    default: module.PatientDetailPage,
  })),
);

const ProviderDetailPage = lazy(() =>
  import("@/pages/provider-detail").then((module) => ({
    default: module.ProviderDetailPage,
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
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <Suspense fallback={<div className="min-h-screen bg-background" />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<AppLayout />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="chat" element={<ChatPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="sops" element={<SopsPage />} />
                  <Route path="leads" element={<LeadsPage />} />
                  <Route path="patients" element={<PatientsPage />} />
                  <Route path="patients/:id" element={<PatientDetailPage />} />
                  <Route path="providers" element={<ProvidersPage />} />
                  <Route path="providers/:id" element={<ProviderDetailPage />} />
                  <Route path="orders" element={<OrdersPage />} />
                  <Route path="contracts" element={<ContractsPage />} />
                  <Route path="invoices" element={<InvoicesPage />} />
                  <Route path="documents" element={<DocumentsPage />} />
                  <Route path="services" element={<PatientServicesPage />} />
                  <Route path="feedback" element={<FeedbackPage />} />
                  <Route path="privacy" element={<PatientPrivacyPage />} />
                  <Route path="cases" element={<CasesPage />} />
                  <Route path="cases/:caseId" element={<CaseWorkspacePage />} />
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
    </LocalizationProvider>
  );
}
