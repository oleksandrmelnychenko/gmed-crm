import { ArrowUpRight, Eye } from "lucide-react";
import { PageHeader } from "@/components/ui-shell";
import { ReadOnlyScope } from "@/components/read-only-scope";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { DatevConnectionDetails } from "@/pages/invoices/datev/connection";
import { useDatevText } from "@/pages/invoices/datev/text";
import { DatevDocumentChecks } from "@/pages/invoices/datev/document-checks";
import { DatevLiveConnection } from "@/pages/invoices/datev/live-connection";

export function AdminDatevPage() {
  const { text } = useDatevText();
  const { user } = useAuth();
  const { staffGo, canStaffPath } = useStaffNavigate();
  // Billing (`datev.read`) sees the connection, reads DATEV data and the
  // history; connecting, keys and the company profile stay with `datev.admin`.
  const canAdmin = hasCapability(user, "datev.admin");
  return <div className="min-w-0 space-y-4" data-testid="admin-datev-page">
    <PageHeader title={text.connection} description={text.systemName} actions={canStaffPath("/invoices") ? <>
      <Button type="button" variant="outline" onClick={() => staffGo("/invoices?source=datev")}><ArrowUpRight className="size-4" /><span className="sm:hidden">{text.fromDatev}</span><span className="hidden sm:inline">{text.openInvoices}</span></Button>
      <Button type="button" onClick={() => staffGo("/invoices?source=datev&datev_mode=demo")}><Eye className="size-4" />{text.openDemo}</Button>
    </> : undefined} />
    <DatevLiveConnection canAdmin={canAdmin} />
    <ReadOnlyScope active={!canAdmin}>
      <DatevConnectionDetails />
    </ReadOnlyScope>
    <DatevDocumentChecks />
  </div>;
}
