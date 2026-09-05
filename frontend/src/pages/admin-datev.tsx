import { ArrowUpRight, Eye } from "lucide-react";
import { PageHeader } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { DatevConnectionDetails } from "@/pages/invoices/datev/connection";
import { useDatevText } from "@/pages/invoices/datev/text";

export function AdminDatevPage() {
  const { text } = useDatevText();
  const { staffGo, canStaffPath } = useStaffNavigate();
  return <div className="space-y-5" data-testid="admin-datev-page">
    <PageHeader title={text.connection} description={text.systemName} actions={canStaffPath("/invoices") ? <>
      <Button type="button" variant="outline" onClick={() => staffGo("/invoices?source=datev")}><ArrowUpRight className="size-4" /><span className="sm:hidden">{text.fromDatev}</span><span className="hidden sm:inline">{text.openInvoices}</span></Button>
      <Button type="button" onClick={() => staffGo("/invoices?source=datev&datev_mode=demo")}><Eye className="size-4" />{text.openDemo}</Button>
    </> : undefined} />
    <DatevConnectionDetails />
  </div>;
}
