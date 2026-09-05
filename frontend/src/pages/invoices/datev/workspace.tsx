import { useState } from "react";
import { ArrowUpRight, Building2, Check, Eye, FileText, Link2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { DatevInvoiceDialog } from "./invoice-dialog";
import { DATEV_DEMO_INVOICES, DATEV_DEMO_PATIENTS, datevDate, datevMoney, filterDemoInvoices, isValidDemoBinding, suggestDemoPatient, type DatevBindingFilter, type DatevDemoBinding, type DatevDemoInvoice } from "./model";
import { useDatevText } from "./text";

export function DatevWorkspace({ active, demo, onModeChange, onConnection }: {
  active: boolean; demo: boolean; onModeChange: (demo: boolean) => void; onConnection?: () => void;
}) {
  const { text, lang } = useDatevText();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DatevBindingFilter>("all");
  const [bindings, setBindings] = useState<Record<string, DatevDemoBinding>>({});
  const [selected, setSelected] = useState<DatevDemoInvoice | null>(null);
  const [notice, setNotice] = useState<"saved" | "refreshed" | null>(null);
  const rows = filterDemoInvoices(search, filter, bindings);
  const linkedCount = DATEV_DEMO_INVOICES.filter((invoice) => bindings[invoice.id] && isValidDemoBinding(invoice.id, bindings[invoice.id])).length;
  const columns: ColumnDef<DatevDemoInvoice>[] = [
    { id: "number", label: text.number, accessor: (row) => row.number, required: true, width: 190, sortable: true, render: (row) => <button type="button" className="inline-flex items-center gap-2 text-left font-medium text-foreground hover:underline" onClick={(event) => { event.stopPropagation(); setSelected(row); }}><FileText className="size-3.5 text-muted-foreground" />{row.number}</button> },
    { id: "supplier", label: text.supplier, accessor: (row) => row.supplier, width: 210, sortable: true },
    { id: "recipient", label: text.recipient, accessor: (row) => row.recipient, width: 170, sortable: true },
    { id: "date", label: text.date, accessor: (row) => row.date, width: 150, sortable: true, render: (row) => <span className="text-muted-foreground">{datevDate(row.date, lang)}</span> },
    { id: "total", label: text.total, accessor: (row) => row.grossCents, width: 145, sortable: true, render: (row) => <span className="font-medium tabular-nums">{datevMoney(row.grossCents, lang)}</span> },
    { id: "binding", label: text.binding, width: 200, accessor: (row) => bindings[row.id] ? text.linked : suggestDemoPatient(row) ? text.suggested : text.needsClient, render: (row) => {
      const binding = bindings[row.id];
      const patient = binding ? DATEV_DEMO_PATIENTS.find((item) => item.id === binding.patientId) : undefined;
      return patient ? <div><Badge variant="secondary"><Check className="mr-1 size-3" />{text.linked}</Badge><div className="mt-1 text-xs text-muted-foreground">{patient.first_name} {patient.last_name}</div></div> : <Badge variant="outline">{suggestDemoPatient(row) ? text.suggested : text.needsClient}</Badge>;
    } },
  ];
  return <div hidden={!active} className="space-y-4" data-testid="datev-workspace">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2"><Building2 className="size-4 text-muted-foreground" /><span className="text-sm font-medium">{demo ? text.demoCompany : text.systemName}</span><Badge variant="secondary"><Eye className="mr-1 size-3" />{text.readOnly}</Badge></div>
      <div className="flex rounded-lg border bg-muted/30 p-0.5" aria-label={text.mode}>
        {[false, true].map((isDemo) => <Button key={String(isDemo)} type="button" variant={demo === isDemo ? "secondary" : "ghost"} size="sm" aria-pressed={demo === isDemo} onClick={() => { setNotice(null); onModeChange(isDemo); }}>{isDemo ? text.demo : text.live}</Button>)}
      </div>
    </div>
    {!demo ? <section className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border bg-card px-5 py-12 text-center">
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-muted"><Link2 className="size-6 text-muted-foreground" /></div>
      <Badge variant="outline">{text.notConnected}</Badge>
      <h2 className="mt-3 text-lg font-semibold">{text.disconnectedTitle}</h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{text.disconnectedHint}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">{onConnection ? <Button type="button" variant="outline" onClick={onConnection}><Link2 className="size-4" />{text.connection}</Button> : null}<Button type="button" onClick={() => onModeChange(true)}><Eye className="size-4" />{text.openDemo}</Button></div>
      {!onConnection ? <p className="mt-4 text-xs text-muted-foreground">{text.adminConnectionHint}</p> : null}
      <p className="mt-6 text-xs text-muted-foreground">{text.lastSync}: {text.never}</p>
    </section> : <>
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><Badge variant="outline" className="shrink-0">{text.demo}</Badge><span>{text.demoNotice}</span></div>
      <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[[text.count, DATEV_DEMO_INVOICES.length], [text.linkedCount, linkedCount], [text.needsReview, DATEV_DEMO_INVOICES.length - linkedCount], [text.totalAmount, datevMoney(DATEV_DEMO_INVOICES.reduce((sum, row) => sum + row.grossCents, 0), lang)]].map(([label, value]) => <div key={label} className="rounded-xl border bg-card px-4 py-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 text-xl font-semibold tabular-nums">{value}</dd></div>)}
      </dl>
      {notice ? <p role="status" className="rounded-lg bg-muted/30 px-3 py-2 text-xs">{notice === "saved" ? text.saved : text.demoRefreshed}</p> : null}
      <DataTableSurface
        rows={rows} columns={columns} rowId={(row) => row.id} defaultDensity="comfortable" defaultFrozenColumns={["number"]}
        onRowClick={setSelected} pagination={{ pageSize: 25 }}
        toolbarStart={<>
          <div className="relative min-w-[200px] flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label={text.search} placeholder={text.search} value={search} onChange={(event) => setSearch(event.target.value)} className="h-8 pl-8 text-xs" /></div>
          <NativeComboboxSelect aria-label={text.binding} className="h-8 w-[180px] text-xs" value={filter} onChange={(event) => setFilter(event.target.value as DatevBindingFilter)}><option value="all">{text.all}</option><option value="linked">{text.linked}</option><option value="unlinked">{text.unlinked}</option></NativeComboboxSelect>
          <Button type="button" variant="outline" size="sm" onClick={() => setNotice("refreshed")}><RefreshCw className="size-3.5" />{text.reloadDemo}</Button>
        </>}
        rowActions={(row) => <Button type="button" size="icon-sm" variant="ghost" aria-label={`${text.view} ${row.number}`} onClick={() => setSelected(row)}><ArrowUpRight className="size-4" /></Button>}
        emptyState={<div className="space-y-2 py-10 text-center"><p className="font-medium">{text.empty}</p><p className="text-sm text-muted-foreground">{text.emptyHint}</p><Button type="button" variant="outline" size="sm" onClick={() => { setSearch(""); setFilter("all"); }}>{text.clear}</Button></div>}
      />
    </>}
    {active && demo && selected ? <DatevInvoiceDialog key={selected.id} invoice={selected} binding={bindings[selected.id]} onClose={() => setSelected(null)} onSave={(binding) => {
      if (!isValidDemoBinding(selected.id, binding)) return;
      setBindings((current) => ({ ...current, [selected.id]: binding }));
      setNotice("saved");
      setSelected(null);
    }} /> : null}
  </div>;
}
