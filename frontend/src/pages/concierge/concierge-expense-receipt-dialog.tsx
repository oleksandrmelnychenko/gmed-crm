import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Download,
  FileText,
  History,
  LoaderCircle,
  ReceiptText,
  Upload,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  calculateConciergeExpenseGross,
  conciergeExpenseConsequencePreview,
  moneyStringToMinorUnits,
  validateConciergeExpenseReceiptFile,
  type ConciergeExpenseContext,
  type ConciergeExpenseItem,
  type ConciergeExpenseMutationResponse,
  type ConciergeExpensePaidBy,
  type ConciergeExpenseSubmitInput,
  type ReceiptFileValidationError,
} from "./expense-receipt-model";
import type { ConciergeService } from "./model";
import {
  ConciergeDialogBody,
  ConciergeDialogFooter,
  ConciergeDialogHeader,
  ConciergeDialogSection,
  ConciergeField,
  conciergeDialogContentClassName,
} from "./dialog-layout";

const copy = {
  de: {
    title: "Ausgabe und Beleg erfassen",
    description: "Der Beleg wird intern zur Finanzprüfung eingereicht. Erst die Freigabe durch CEO oder Abrechnung verändert Salden.",
    context: "Kunde",
    patient: "Kunde",
    receipt: "Beleg",
    camera: "Foto aufnehmen",
    chooseFile: "Foto oder PDF wählen",
    fileHint: "PDF, JPEG, PNG oder WEBP · maximal 25 MB",
    fileRequired: "Bitte einen Beleg auswählen.",
    fileTooLarge: "Die Datei ist leer oder größer als 25 MB.",
    fileUnsupported: "Nur PDF-, JPEG-, PNG- oder WEBP-Dateien sind erlaubt.",
    expense: "Ausgabedaten",
    vendor: "Partner oder Leistungserbringer",
    expenseDate: "Belegdatum",
    net: "Netto",
    vat: "MwSt.",
    gross: "Brutto",
    currency: "Währung",
    paidBy: "Bezahlt von",
    paidPatient: "Patient",
    paidAgency: "GMED / Agentur",
    unpaid: "Noch nicht bezahlt",
    serviceDelivered: "Leistung wurde erbracht",
    note: "Notiz (optional)",
    notePlaceholder: "Operative Angaben zum Beleg oder zur Leistung",
    consequence: "Voraussichtliche Auswirkung nach Finanzfreigabe",
    pendingWarning: "Die Einreichung bleibt bis zur Prüfung im Status „Ausstehend“. Es wird jetzt noch kein Saldo verändert.",
    patientReceivable: "Forderung an Patient",
    providerLiability: "Verbindlichkeit gegenüber Partner",
    companyPaid: "Zahlung / Ausgabe GMED",
    missingProvider: "Für GMED-bezahlte oder unbezahlte Ausgaben muss vor der Freigabe ein nicht-medizinischer Partner mit dem Service verknüpft sein.",
    submit: "Zur Prüfung einreichen",
    submitting: "Beleg wird hochgeladen",
    cancel: "Schließen",
    success: "Ausgabe wurde zur Finanzprüfung eingereicht.",
    history: "Verlauf",
    historyEmpty: "Für diesen Service wurden noch keine Ausgaben eingereicht.",
    pending_review: "Ausstehend",
    posted: "Freigegeben",
    rejected: "Abgelehnt",
    reversed: "Storniert",
    download: "Beleg herunterladen",
    submittedBy: "Eingereicht von {name}",
    loading: "Kundendaten werden geladen",
  },
  ru: {
    title: "Расход и подтверждение",
    description: "Документ отправляется на внутреннюю финансовую проверку. Баланс изменится только после подтверждения CEO или бухгалтерией.",
    context: "Клиент",
    patient: "Клиент",
    receipt: "Подтверждение расхода",
    camera: "Сфотографировать",
    chooseFile: "Выбрать фото или PDF",
    fileHint: "PDF, JPEG, PNG или WEBP · не более 25 МБ",
    fileRequired: "Выберите подтверждающий документ.",
    fileTooLarge: "Файл пустой или превышает 25 МБ.",
    fileUnsupported: "Разрешены только PDF, JPEG, PNG и WEBP.",
    expense: "Данные расхода",
    vendor: "Партнёр или исполнитель",
    expenseDate: "Дата документа",
    net: "Нетто",
    vat: "НДС",
    gross: "Брутто",
    currency: "Валюта",
    paidBy: "Кто оплатил",
    paidPatient: "Пациент",
    paidAgency: "GMED / агентство",
    unpaid: "Ещё не оплачено",
    serviceDelivered: "Услуга уже оказана",
    note: "Комментарий (необязательно)",
    notePlaceholder: "Рабочие данные о документе или оказанной услуге",
    consequence: "Ожидаемое влияние после финансового подтверждения",
    pendingWarning: "Заявка останется в статусе «На проверке». Сейчас баланс не изменяется.",
    patientReceivable: "К оплате пациентом",
    providerLiability: "Обязательство перед партнёром",
    companyPaid: "Оплата / расход GMED",
    missingProvider: "Для расхода, оплаченного GMED, или неоплаченного расхода перед подтверждением к услуге должен быть привязан немедицинский партнёр.",
    submit: "Отправить на проверку",
    submitting: "Загрузка документа",
    cancel: "Закрыть",
    success: "Расход отправлен на финансовую проверку.",
    history: "История",
    historyEmpty: "Для этой услуги расходы ещё не отправлялись.",
    pending_review: "На проверке",
    posted: "Подтверждено",
    rejected: "Отклонено",
    reversed: "Отменено",
    download: "Скачать документ",
    submittedBy: "Отправил(а): {name}",
    loading: "Загрузка данных клиента",
  },
} as const;

const selectClass = "h-9 w-full rounded-md border border-input bg-field px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";

function todayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMoney(value: string, currency: string, lang: Lang) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency}`;
  return new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "de-DE", {
    style: "currency",
    currency: currency || "EUR",
  }).format(amount);
}

function formatDate(value: string, lang: Lang) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusTone(status: ConciergeExpenseItem["status"]) {
  if (status === "posted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "reversed") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function fileErrorText(error: ReceiptFileValidationError | null, labels: (typeof copy)[Lang]) {
  if (error === "required") return labels.fileRequired;
  if (error === "too_large") return labels.fileTooLarge;
  if (error === "unsupported_type") return labels.fileUnsupported;
  return "";
}

export function ConciergeExpenseReceiptDialog({
  service,
  lang,
  open,
  context,
  expenses,
  loading,
  error,
  submitting,
  progress,
  onOpenChange,
  onSubmit,
  onDownload,
}: {
  service: ConciergeService | null;
  lang: Lang;
  open: boolean;
  context: ConciergeExpenseContext | null;
  expenses: ConciergeExpenseItem[];
  loading: boolean;
  error: string;
  submitting: boolean;
  progress: number;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ConciergeExpenseSubmitInput) => Promise<ConciergeExpenseMutationResponse>;
  onDownload: (item: ConciergeExpenseItem) => Promise<void>;
}) {
  const labels = copy[lang];
  const requestIdRef = useRef<string | null>(null);
  const activeServiceIdRef = useRef<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<ReceiptFileValidationError | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [vendor, setVendor] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayInputValue);
  const [amountNet, setAmountNet] = useState("");
  const [amountVat, setAmountVat] = useState("");
  const [paidBy, setPaidBy] = useState<ConciergeExpensePaidBy>("unpaid");
  const [serviceDelivered, setServiceDelivered] = useState(false);
  const [note, setNote] = useState("");
  const [success, setSuccess] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const amountGross = calculateConciergeExpenseGross(amountNet, amountVat);
  const consequence = conciergeExpenseConsequencePreview(paidBy, serviceDelivered, amountGross);
  const currency = context?.service.currency || service?.currency || "EUR";
  const providerMissing = paidBy !== "patient" && !context?.service.provider_id;
  const validMoney = moneyStringToMinorUnits(amountGross) !== null && (moneyStringToMinorUnits(amountGross) ?? 0) > 0;
  const canSubmit = Boolean(
      service &&
      context &&
      vendor.trim() &&
      expenseDate &&
      file &&
      !validateConciergeExpenseReceiptFile(file) &&
      validMoney &&
      !submitting,
  );

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!open || !service) {
      requestIdRef.current = null;
      activeServiceIdRef.current = null;
      return;
    }
    if (activeServiceIdRef.current === service.id) return;
    activeServiceIdRef.current = service.id;
    requestIdRef.current = crypto.randomUUID();
    setFile(null);
    setFileError(null);
    setVendor(service.provider_name || service.vendor_name || "");
    setExpenseDate(todayInputValue());
    setAmountNet("");
    setAmountVat("");
    setPaidBy("unpaid");
    setServiceDelivered(service.status === "completed");
    setNote("");
    setSuccess("");
  }, [open, service]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    const validation = validateConciergeExpenseReceiptFile(next);
    setFileError(validation);
    setFile(validation ? null : next);
    setSuccess("");
  }

  function resetFileInputs() {
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validateConciergeExpenseReceiptFile(file);
    if (validation || !service || !file || !context || !canSubmit) {
      setFileError(validation);
      return;
    }
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    try {
      await onSubmit({
        requestId,
        orderId: null,
        orderLeistungId: null,
        vendor: vendor.trim(),
        expenseDate,
        amountNet: amountNet.replace(",", "."),
        amountVat: amountVat.replace(",", "."),
        amountGross,
        currency,
        paidBy,
        serviceDelivered,
        note: note.trim() || null,
        file,
      });
      requestIdRef.current = crypto.randomUUID();
      setFile(null);
      resetFileInputs();
      setAmountNet("");
      setAmountVat("");
      setNote("");
      setSuccess(labels.success);
    } catch {
      // Parent owns the API error. Keep every value and request_id for a safe retry.
    }
  }

  async function download(item: ConciergeExpenseItem) {
    setDownloadingId(item.id);
    try {
      await onDownload(item);
    } finally {
      setDownloadingId(null);
    }
  }

  if (!service) return null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!submitting) onOpenChange(nextOpen);
    }}>
      <DialogContent className={conciergeDialogContentClassName}>
        <ConciergeDialogHeader
          icon={ReceiptText}
          tone="orange"
          title={labels.title}
          description={labels.description}
          meta={<Badge variant="outline" className="rounded-full font-mono text-[10px]">{service.patient_pid}</Badge>}
        />

        <form className="flex min-h-0 flex-col" onSubmit={(event) => void submit(event)}>
          <ConciergeDialogBody>
            {loading ? (
              <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />{labels.loading}
              </div>
            ) : (
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.86fr)]">
                <div className="space-y-4">
                  <ConciergeDialogSection title={labels.context} icon={WalletCards}>
                    <div className="grid gap-3">
                      <ConciergeField label={labels.patient}>
                        <Input readOnly value={context ? `${context.patient.display_name} · ${context.patient.pid}` : service.patient_name} />
                      </ConciergeField>
                    </div>
                  </ConciergeDialogSection>

                  <ConciergeDialogSection title={labels.receipt} icon={FileText}>
                    <input ref={cameraInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={chooseFile} />
                    <input ref={fileInputRef} className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" onChange={chooseFile} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button type="button" variant="outline" className="h-10" onClick={() => cameraInputRef.current?.click()}><Camera />{labels.camera}</Button>
                      <Button type="button" variant="outline" className="h-10" onClick={() => fileInputRef.current?.click()}><Upload />{labels.chooseFile}</Button>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">{labels.fileHint}</p>
                    {file && previewUrl ? (
                      <div className="mt-3 overflow-hidden rounded-lg border border-border/70 bg-muted/20">
                        {file.type.startsWith("image/") ? (
                          <img src={previewUrl} alt={file.name} className="max-h-60 w-full object-contain" />
                        ) : (
                          <div className="flex min-h-28 items-center justify-center"><FileText className="size-10 text-rose-500" /></div>
                        )}
                        <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-card px-3 py-2">
                          <span className="min-w-0 truncate text-xs font-medium">{file.name}</span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>
                    ) : null}
                    {fileError ? <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-destructive"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{fileErrorText(fileError, labels)}</p> : null}
                    {submitting ? (
                      <div className="mt-3 space-y-1.5">
                        <div className="flex justify-between text-[11px] text-muted-foreground"><span>{labels.submitting}</span><span>{progress}%</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    ) : null}
                  </ConciergeDialogSection>

                  <ConciergeDialogSection title={labels.history} icon={History}>
                    {expenses.length === 0 ? <p className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">{labels.historyEmpty}</p> : (
                      <ol className="space-y-2">
                        {expenses.map((item) => (
                          <li key={item.id} className="rounded-lg border border-border/70 bg-muted/15 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2"><Badge variant="outline" className={cn("rounded-full text-[10px]", statusTone(item.status))}>{labels[item.status]}</Badge><span className="text-xs font-medium">{item.vendor}</span></div>
                              <span className="font-mono text-xs font-semibold">{formatMoney(item.amount_gross, item.currency, lang)}</span>
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">{context?.patient.display_name || service.patient_name} · {formatDate(item.submitted_at, lang)}</p>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[10px] text-muted-foreground">{labels.submittedBy.replace("{name}", item.submitted_by.display_name)}</p>
                              <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" disabled={downloadingId === item.id} onClick={() => void download(item)}>
                                {downloadingId === item.id ? <LoaderCircle className="animate-spin" /> : <Download />}{labels.download}
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </ConciergeDialogSection>
                </div>

                <div className="space-y-4 lg:sticky lg:top-0">
                  <ConciergeDialogSection title={labels.expense} icon={ReceiptText}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ConciergeField label={labels.vendor} className="sm:col-span-2"><Input value={vendor} maxLength={255} required onChange={(event) => setVendor(event.target.value)} /></ConciergeField>
                      <ConciergeField label={labels.expenseDate}><Input type="date" value={expenseDate} max={todayInputValue()} required onChange={(event) => setExpenseDate(event.target.value)} /></ConciergeField>
                      <ConciergeField label={labels.currency}><Input readOnly value={currency} /></ConciergeField>
                      <ConciergeField label={labels.net}><Input inputMode="decimal" placeholder="0.00" value={amountNet} required onChange={(event) => setAmountNet(event.target.value)} /></ConciergeField>
                      <ConciergeField label={labels.vat}><Input inputMode="decimal" placeholder="0.00" value={amountVat} required onChange={(event) => setAmountVat(event.target.value)} /></ConciergeField>
                      <ConciergeField label={labels.gross} className="sm:col-span-2"><Input readOnly value={amountGross} placeholder="0.00" /></ConciergeField>
                      <ConciergeField label={labels.paidBy} className="sm:col-span-2">
                        <select className={selectClass} value={paidBy} onChange={(event) => setPaidBy(event.target.value as ConciergeExpensePaidBy)}>
                          <option value="patient">{labels.paidPatient}</option>
                          <option value="agency">{labels.paidAgency}</option>
                          <option value="unpaid">{labels.unpaid}</option>
                        </select>
                      </ConciergeField>
                      <label className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2.5 text-xs font-medium sm:col-span-2">
                        <input type="checkbox" className="size-4 accent-primary" checked={serviceDelivered} onChange={(event) => setServiceDelivered(event.target.checked)} />
                        {labels.serviceDelivered}
                      </label>
                      <ConciergeField label={labels.note} className="sm:col-span-2"><textarea className="min-h-24 w-full resize-y rounded-md border border-input bg-field px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" value={note} maxLength={2000} placeholder={labels.notePlaceholder} onChange={(event) => setNote(event.target.value)} /></ConciergeField>
                    </div>
                  </ConciergeDialogSection>

                  <ConciergeDialogSection title={labels.consequence} icon={WalletCards}>
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">{labels.pendingWarning}</p>
                    <dl className="mt-3 grid gap-2">
                      {([
                        [labels.patientReceivable, consequence.patientReceivableGross],
                        [labels.providerLiability, consequence.providerLiabilityGross],
                        [labels.companyPaid, consequence.companyPaidGross],
                      ] as const).map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-mono text-xs font-semibold">{formatMoney(value, currency, lang)}</dd></div>
                      ))}
                    </dl>
                    {providerMissing ? <p className="mt-3 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-800"><AlertCircle className="mt-0.5 size-4 shrink-0" />{labels.missingProvider}</p> : null}
                  </ConciergeDialogSection>

                  {success ? <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"><CheckCircle2 className="size-4 shrink-0" />{success}</p> : null}
                  {error ? <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"><AlertCircle className="size-4 shrink-0" />{error}</p> : null}
                </div>
              </div>
            )}
          </ConciergeDialogBody>
          <ConciergeDialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>{labels.cancel}</Button>
            <Button type="submit" disabled={!canSubmit}>{submitting ? <LoaderCircle className="animate-spin" /> : <Upload />}{submitting ? labels.submitting : labels.submit}</Button>
          </ConciergeDialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
