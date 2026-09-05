import { useState } from "react";
import { Check, Download, FileText, Minus, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui-shell";
import { DATEV_DEMO_ORDERS, DATEV_DEMO_PATIENTS, datevDate, datevMoney, demoDocumentUrl, isValidDemoBinding, suggestDemoPatient, type DatevDemoBinding, type DatevDemoInvoice } from "./model";
import { useDatevText } from "./text";

export function DatevInvoiceDialog({ invoice, binding, onClose, onSave }: {
  invoice: DatevDemoInvoice; binding?: DatevDemoBinding; onClose: () => void; onSave: (binding: DatevDemoBinding) => void;
}) {
  const { text, lang } = useDatevText();
  const suggestedId = suggestDemoPatient(invoice);
  const [patientId, setPatientId] = useState(binding?.patientId ?? suggestedId);
  const [orderId, setOrderId] = useState(binding?.orderId ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [showText, setShowText] = useState(false);
  const [imageError, setImageError] = useState(false);
  const dirty = patientId !== (binding?.patientId ?? suggestedId) || orderId !== (binding?.orderId ?? "") || confirmed;
  const ready = confirmed && isValidDemoBinding(invoice.id, { patientId, orderId });
  return <Dialog open dirty={dirty} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="left-1/2 right-auto top-1/2 bottom-auto flex h-[min(920px,calc(100dvh-24px))] max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1380px] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100vw-48px)] sm:max-w-[1380px] sm:pb-0">
      <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
        <DialogTitle className="flex flex-wrap items-center gap-2">{text.review}<Badge variant="secondary">{text.demo}</Badge></DialogTitle>
        <DialogDescription>{text.reviewHint}</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:overflow-hidden">
        <section aria-label={text.original} className="flex min-h-0 flex-col border-b bg-muted/30 lg:border-r lg:border-b-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-medium"><FileText className="size-4" />{invoice.number}.pdf</div>
            <a href={demoDocumentUrl(invoice, "pdf")} download={`${invoice.number}.pdf`} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Download className="size-3.5" />{text.download}</a>
          </div>
          <div className="flex shrink-0 items-center justify-center gap-1 border-b bg-card/60 px-3 py-1">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={text.zoomOut} disabled={zoom <= 75} onClick={() => setZoom((value) => Math.max(75, value - 25))}><Minus className="size-3.5" /></Button>
            <span className="w-12 text-center text-xs tabular-nums">{zoom}%</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={text.zoomIn} disabled={zoom >= 175} onClick={() => setZoom((value) => Math.min(175, value + 25))}><Plus className="size-3.5" /></Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setZoom(100)}>{text.fit}</Button>
          </div>
          <div className="min-h-0 overflow-auto p-4 lg:flex-1">
            {imageError ? <p role="alert" className="p-5 text-sm text-muted-foreground">{text.imageError}</p> : <img src={demoDocumentUrl(invoice, "png")} alt={`${text.original}: ${invoice.number}`} onError={() => setImageError(true)} style={{ width: `${zoom}%`, maxWidth: "none" }} className="mx-auto block h-auto border bg-white shadow-sm" />}
          </div>
        </section>
        <section aria-label={text.fields} className="space-y-5 p-5 lg:overflow-y-auto">
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">{text.demoNotice}</p>
          <div className="space-y-3 rounded-xl border p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4" />{text.binding}</h3>
            {!binding ? <p className="text-xs leading-5 text-muted-foreground">{suggestedId ? text.autoHint : text.manualHint}</p> : null}
            <Field label={text.client}><NativeComboboxSelect aria-label={text.client} value={patientId} onChange={(event) => { setPatientId(event.target.value); setOrderId(""); setConfirmed(false); }}>
              <option value="">{text.chooseClient}</option>{DATEV_DEMO_PATIENTS.map((patient) => <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name} · {patient.patient_id}</option>)}
            </NativeComboboxSelect></Field>
            <Field label={text.order}><NativeComboboxSelect aria-label={text.order} value={orderId} disabled={!patientId} onChange={(event) => { setOrderId(event.target.value); setConfirmed(false); }}>
              <option value="">{text.chooseOrder}</option>{DATEV_DEMO_ORDERS.filter((order) => order.patient_id === patientId).map((order) => <option key={order.id} value={order.id}>{order.order_number}</option>)}
            </NativeComboboxSelect></Field>
            <p className="text-xs leading-5 text-muted-foreground">{text.bindingNote}</p>
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{text.fields}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {[[text.number, invoice.number], [text.supplier, invoice.supplier], [text.recipient, invoice.recipient], [text.date, datevDate(invoice.date, lang)], [text.due, datevDate(invoice.dueDate, lang)], [text.currency, invoice.currency], [text.net, datevMoney(invoice.netCents, lang)], [text.vat, datevMoney(invoice.vatCents, lang)]].map(([label, value]) => <Field key={label} label={label}><Input aria-label={label} value={value} readOnly /></Field>)}
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3 font-semibold"><span className="text-sm">{text.total}</span><span className="text-lg tabular-nums">{datevMoney(invoice.grossCents, lang)}</span></div>
            <p className="flex justify-between text-xs text-muted-foreground"><span>{text.paymentStatus}</span><span>{text.unavailable}</span></p>
          </div>
          <div className="space-y-2"><h3 className="text-sm font-semibold">{text.lines}</h3><div className="divide-y rounded-lg border">{invoice.lines.map((line) => <div key={line.description} className="flex justify-between gap-3 p-3 text-xs"><span>{line.description} × {line.quantity}</span><span className="whitespace-nowrap tabular-nums">{datevMoney(line.unitCents * line.quantity, lang)}</span></div>)}</div></div>
          <div><Button type="button" variant="ghost" size="sm" onClick={() => setShowText(!showText)}>{showText ? text.hideText : text.showText}</Button>{showText ? <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/30 p-3 text-xs">{invoice.text}</pre> : null}</div>
          <dl className="space-y-1 border-t pt-3 text-xs text-muted-foreground"><div className="flex justify-between gap-3"><dt>{text.source}</dt><dd className="text-right">{text.sampleSource}</dd></div><div className="flex justify-between gap-3"><dt>{text.sourceId}</dt><dd>{invoice.id}</dd></div></dl>
          <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={confirmed} disabled={!isValidDemoBinding(invoice.id, { patientId, orderId })} onChange={(event) => setConfirmed(event.target.checked)} />{text.confirm}</label>
        </section>
      </div>
      <footer className="flex shrink-0 justify-end border-t bg-card px-5 py-3"><Button type="button" disabled={!ready} onClick={() => { if (ready) onSave({ patientId, orderId }); }}><Check className="size-4" />{text.save}</Button></footer>
    </DialogContent>
  </Dialog>;
}
