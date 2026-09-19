import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { PageHeader } from "@/components/ui-shell";
import { IncidentRegisterSection } from "@/pages/admin/ui/incident-register-section";

/**
 * Every member of staff can report a data breach from here; the register with
 * the 72-hour decision stays with CEO and IT admin.
 */
export function IncidentReportPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const canManage = user?.role === "ceo" || user?.role === "it_admin";

  return (
    <div className="space-y-4">
      <PageHeader title={l("incidents_page_title")} description={l("incidents_page_subtitle")} />
      <IncidentRegisterSection canManage={canManage} />
    </div>
  );
}
