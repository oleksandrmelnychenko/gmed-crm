import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { AuthProvider } from "@/lib/auth";
import { RealtimeProvider } from "@/lib/realtime";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout";
import { LoginPage } from "@/pages/login";
import { useLang } from "@/lib/i18n";

const DashboardPage = lazy(() =>
  import("@/pages/dashboard").then((module) => ({
    default: module.DashboardPage,
  })),
);

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

const InterpretersPage = lazy(() =>
  import("@/pages/interpreters").then((module) => ({
    default: module.InterpretersPage,
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

const PatientRecommendationsPage = lazy(() =>
  import("@/pages/patients/portal-recommendations-page").then((module) => ({
    default: module.PatientRecommendationsPage,
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

const FinanceCatalogPage = lazy(() =>
  import("@/pages/finance-catalog").then((module) => ({
    default: module.FinanceCatalogPage,
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

const PrivacyPage = lazy(() =>
  import("@/pages/privacy").then((module) => ({
    default: module.PrivacyPage,
  })),
);

const ServicesPage = lazy(() =>
  import("@/pages/services").then((module) => ({
    default: module.ServicesPage,
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
  import("@/pages/patients/detail-entry").then((module) => ({
    default: module.PatientDetailPage,
  })),
);

const ProviderDetailPage = lazy(() =>
  import("@/pages/providers/detail-entry").then((module) => ({
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

function NotFoundPage() {
  const { t } = useLang();

  return (
    <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center px-6">
      <div className="max-w-lg rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          404
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">
          {t.app_not_found_title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {t.app_not_found_body}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <BrowserRouter>
        <AuthProvider>
          <RealtimeProvider>
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
                    <Route path="recommendations" element={<PatientRecommendationsPage />} />
                    <Route path="providers" element={<ProvidersPage />} />
                    <Route path="providers/:id" element={<ProviderDetailPage />} />
                    <Route path="orders" element={<OrdersPage />} />
                    <Route path="orders/:orderId" element={<OrdersPage />} />
                    <Route path="contracts" element={<ContractsPage />} />
                    <Route path="invoices" element={<InvoicesPage />} />
                    <Route path="finance-catalog" element={<FinanceCatalogPage />} />
                    <Route path="documents" element={<DocumentsPage />} />
                    <Route path="documents/intake" element={<DocumentsPage />} />
                    <Route path="documents/translation-requests" element={<DocumentsPage />} />
                    <Route path="documents/:documentId" element={<DocumentsPage />} />
                    <Route path="services" element={<ServicesPage />} />
                    <Route path="feedback" element={<FeedbackPage />} />
                    <Route path="privacy" element={<PrivacyPage />} />
                    <Route path="cases" element={<CasesPage />} />
                    <Route path="cases/:caseId" element={<CaseWorkspacePage />} />
                    <Route path="appointments" element={<AppointmentsPage />} />
                    <Route path="interpreters" element={<InterpretersPage />} />
                    <Route path="interpreters/:interpreterId" element={<InterpretersPage />} />
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
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Routes>
              </Suspense>
            </TooltipProvider>
          </RealtimeProvider>
        </AuthProvider>
      </BrowserRouter>
    </LocalizationProvider>
  );
}
