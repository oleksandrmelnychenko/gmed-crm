import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Building2, Check, FileUp, LoaderCircle, RotateCcw, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Banner, Field } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { ApiRequestError } from "@/lib/api";
import type { OrderOption, PatientOption } from "../model/types";
import { blankImportFields, importFieldsFromPreview, importTotalsMatch, invoiceSourceCanSave, isInvoiceXml, normalizeInvoiceFile, type InvoiceImportFields, type InvoiceImportPreview, type InvoiceImportScope } from "../model/import-model";
import { confirmCompanyInvoiceImport, confirmInvoiceImport, discardInvoiceImportSource, parseInvoiceFile, uploadInvoiceSource } from "../data/invoice-import-api";
import { matchInvoicePatient, matchInvoiceRecipient } from "../model/patient-match";
import { XmlInvoiceOriginal } from "./xml-invoice-original";
import { StructuredInvoiceDetails } from "./structured-invoice-details";

type Props = {
  patients: PatientOption[];
  orders: OrderOption[];
  initialPatientId?: string;
  initialOrderId?: string;
  optionsError?: string | null;
  onClose: () => void;
  onCreated: (result: { id: string; scope: InvoiceImportScope; orderId?: string }) => void;
};

export function InvoiceImportSheet({ patients, orders, initialPatientId = "", initialOrderId = "", optionsError, onClose, onCreated }: Props) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [scope, setScope] = useState<InvoiceImportScope>(
    initialPatientId || initialOrderId ? "patient_order" : "company",
  );
  // null allows OCR matching; an empty string is an explicit manual clear.
  const [manualPatientId, setManualPatientId] = useState<string | null>(initialPatientId || orders.find((order) => order.id === initialOrderId)?.patient_id || null);
  const [orderId, setOrderId] = useState(initialOrderId);
  const [fields, setFields] = useState(blankImportFields);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [preview, setPreview] = useState<InvoiceImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [parseError, setParseError] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmedBinding, setConfirmedBinding] = useState<{ scope: InvoiceImportScope; patientId: string; orderId: string } | null>(null);
  const [showText, setShowText] = useState(false);
  const [originalPage, setOriginalPage] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentUrl = useRef("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const saveInProgress = useRef(false);

  useEffect(() => () => {
    generation.current += 1;
    request.current?.abort();
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
  }, []);

  const patientMatch = useMemo(() => preview ? preview.structured
    ? matchInvoiceRecipient(preview.recipient?.name, patients) : matchInvoicePatient(preview.text, patients) : null, [preview, patients]);
  const patientId = manualPatientId ?? patientMatch?.patientId ?? "";
  const bindingPatientId = scope === "patient_order" ? patientId : "";
  const bindingOrderId = scope === "patient_order" ? orderId : "";
  const confirmed = confirmedBinding?.scope === scope
    && confirmedBinding.patientId === bindingPatientId
    && confirmedBinding.orderId === bindingOrderId;
  const selectedPatient = patients.find((patient) => patient.id === patientId);
  const patientOrders = orders.filter((order) => order.patient_id === patientId);
  const selectedOrder = patientOrders.find((order) => order.id === orderId);
  const totalsValid = importTotalsMatch(fields);
  const contextReady = scope === "company"
    ? Boolean(fields.supplier_name.trim())
    : Boolean(selectedPatient && selectedOrder);
  const ready = Boolean(invoiceSourceCanSave(file, preview) && contextReady
    && fields.external_invoice_number.trim() && fields.invoice_date
    && /^[A-Z]{3}$/.test(fields.currency.trim().toUpperCase()) && totalsValid && confirmed);

  function setConfirmed(value: boolean) {
    setConfirmedBinding(value ? { scope, patientId: bindingPatientId, orderId: bindingOrderId } : null);
  }

  function updateField(key: keyof InvoiceImportFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setConfirmed(false);
  }

  async function recognize(nextFile: File) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++generation.current;
    setParsing(true);
    setParseError("");
    setPreview(null);
    setConfirmed(false);
    try {
      const result = await parseInvoiceFile(nextFile, controller.signal);
      if (version !== generation.current) return;
      setPreview(result);
      setFields(importFieldsFromPreview(result));
      setConfirmed(false);
    } catch (error) {
      if (version !== generation.current || controller.signal.aborted) return;
      const status = error instanceof ApiRequestError ? error.status : undefined;
      setParseError(isInvoiceXml(nextFile)
        ? tx("Не удалось проверить XML инвойса. Нужен читаемый XML UBL или CII; повторите проверку либо выберите другой файл. Сохранение XML доступно после успешной проверки.", "Rechnungs-XML konnte nicht geprüft werden. Eine lesbare UBL- oder CII-Datei ist erforderlich; Prüfung wiederholen oder andere Datei wählen. XML kann erst nach erfolgreicher Prüfung gespeichert werden.")
        : status === 429
        ? tx("Сервис распознавания занят. Повторите через несколько секунд или заполните поля вручную.", "Die Erkennung ist ausgelastet. In einigen Sekunden erneut versuchen oder Angaben manuell eintragen.")
        : status === 503 || status === 404
          ? tx("Не удалось распознать счёт: сервис временно недоступен. Можно повторить или заполнить поля по оригиналу.", "Rechnung konnte nicht erkannt werden: Der Dienst ist vorübergehend nicht verfügbar. Erneut versuchen oder Angaben aus dem Original eintragen.")
          : tx("Не удалось распознать счёт. Можно повторить или заполнить поля по оригиналу.", "Rechnung konnte nicht erkannt werden. Erneut versuchen oder Angaben aus dem Original eintragen."));
    } finally {
      if (version === generation.current) setParsing(false);
    }
  }

  async function selectFile(nextFile?: File) {
    if (!nextFile || saving) return;
    nextFile = normalizeInvoiceFile(nextFile);
    const xml = isInvoiceXml(nextFile);
    if (!(["application/pdf", "image/png", "image/jpeg"].includes(nextFile.type) || xml) || nextFile.size === 0 || nextFile.size > (xml ? 5 : 25) * 1024 * 1024) {
      setError(tx("Выберите PDF, PNG или JPG до 25 МБ либо XML UBL/CII до 5 МБ.", "PDF, PNG oder JPG bis 25 MB oder UBL/CII-XML bis 5 MB auswählen."));
      return;
    }
    if (documentId) {
      saveInProgress.current = true;
      setSaving(true);
      setError("");
      try {
        await discardInvoiceImportSource(documentId);
        setDocumentId("");
      } catch {
        setError(tx("Не удалось заменить оригинал. Обновите список счетов и повторите.", "Das Original konnte nicht ersetzt werden. Rechnungsliste aktualisieren und erneut versuchen."));
        return;
      } finally {
        saveInProgress.current = false;
        setSaving(false);
      }
    }
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = URL.createObjectURL(nextFile);
    setPreviewUrl(currentUrl.current);
    setFile(nextFile);
    if (manualPatientId === null) setOrderId("");
    setFields(blankImportFields());
    setPreview(null);
    setNotes("");
    setConfirmed(false);
    setError("");
    setShowText(false);
    setOriginalPage(1);
    void recognize(nextFile);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!ready || !file || parsing || saveInProgress.current) return;
    saveInProgress.current = true;
    if (scope === "patient_order") setManualPatientId(patientId);
    setSaving(true);
    setError("");
    try {
      let sourceId = documentId;
      if (!sourceId) {
        const uploaded = await uploadInvoiceSource(file, scope, patientId, orderId, fields);
        sourceId = uploaded.id;
        setDocumentId(sourceId);
      }
      const created = scope === "company"
        ? await confirmCompanyInvoiceImport(sourceId, fields, notes)
        : await confirmInvoiceImport(sourceId, patientId, orderId, fields, notes);
      onCreated({ id: created.id, scope, orderId: scope === "patient_order" ? orderId : undefined });
    } catch (failure) {
      setError(failure instanceof ApiRequestError && failure.status === 409
        ? tx("Такой счёт уже добавлен. Проверьте номер и оригинал документа.", "Diese Rechnung wurde bereits erfasst. Nummer und Originaldokument prüfen.")
        : scope === "company"
          ? tx("Не удалось сохранить счёт компании. Проверьте реквизиты и повторите.", "Unternehmensrechnung konnte nicht gespeichert werden. Angaben prüfen und erneut versuchen.")
          : tx("Не удалось сохранить счёт. Проверьте поля, валюту заказа и повторите.", "Rechnung konnte nicht gespeichert werden. Angaben und Auftragswährung prüfen und erneut versuchen."));
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  }

  const labels: Record<keyof InvoiceImportFields, string> = {
    supplier_name: tx("Поставщик / клиника", "Lieferant / Klinik"),
    external_invoice_number: tx("Номер инвойса", "Rechnungsnummer"),
    invoice_date: tx("Дата инвойса", "Rechnungsdatum"), due_date: tx("Оплатить до", "Fällig am"),
    amount_net: tx("Без НДС", "Nettobetrag"), amount_vat: tx("НДС", "Umsatzsteuer"),
    amount_gross: tx("Итого", "Bruttobetrag"), currency: tx("Валюта", "Währung"),
  };
  const missingFields = (Object.keys(labels) as (keyof InvoiceImportFields)[])
    .filter((key) => key !== "due_date"
      && !(key === "supplier_name" && scope !== "company")
      && !fields[key].trim());
  const saveHint = !file
    ? tx("Выберите файл инвойса", "Rechnungsdatei auswählen")
    : parsing
      ? tx("Дождитесь завершения распознавания", "Erkennung abwarten")
      : !invoiceSourceCanSave(file, preview)
        ? tx("Сначала успешно распознайте документ", "Dokument zuerst erfolgreich erkennen")
        : missingFields.length > 0
          ? `${tx("Заполните поля", "Bitte ergänzen")}: ${missingFields.map((key) => labels[key]).join(", ")}`
          : !totalsValid
            ? tx("Проверьте суммы: без НДС + НДС = итого", "Beträge prüfen: Netto + Umsatzsteuer = Brutto")
            : scope === "patient_order" && !selectedPatient
              ? tx("Выберите клиента", "Patient auswählen")
              : scope === "patient_order" && !selectedOrder
                ? tx("Выберите заказ клиента", "Auftrag des Patienten auswählen")
                : !confirmed
                  ? tx("Подтвердите проверку реквизитов", "Prüfung der Angaben bestätigen")
                  : tx("Инвойс готов к сохранению", "Rechnung kann gespeichert werden");
  const recognitionMessage = preview?.warnings.includes("no_readable_text")
    ? tx("Не удалось прочитать текст документа. Заполните поля по оригиналу.", "Der Dokumenttext konnte nicht gelesen werden. Angaben aus dem Original eintragen.")
    : !preview?.extraction_complete
    ? tx("Не весь документ удалось прочитать. Проверьте данные по оригиналу.", "Das Dokument konnte nicht vollständig gelesen werden. Angaben mit dem Original abgleichen.")
    : preview.warnings.includes("low_ocr_confidence")
      ? tx("Часть текста распознана с низкой уверенностью. Проверьте данные по оригиналу.", "Ein Teil des Textes wurde unsicher erkannt. Angaben mit dem Original abgleichen.")
      : tx("Распознавание завершено. Сверьте реквизиты с оригиналом перед сохранением.", "Erkennung abgeschlossen. Angaben vor dem Speichern mit dem Original abgleichen.");

  return (
    <Dialog open dirty={Boolean(file)} onOpenChange={(open) => { if (!open && !saveInProgress.current) onClose(); }}>
      <DialogContent className="left-1/2 right-auto top-1/2 bottom-auto flex h-[min(940px,calc(100dvh-16px))] max-h-[calc(100dvh-16px)] w-[calc(100vw-16px)] max-w-[1480px] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-xl border-border/70 bg-card p-0 shadow-2xl sm:h-[min(92dvh,940px)] sm:w-[min(96vw,1480px)] sm:max-w-[1480px] sm:pb-0">
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" aria-label={tx("Импорт инвойса", "Rechnungsimport")}>
          <DialogHeader className="shrink-0 gap-0 border-b border-border/70 bg-muted/20 px-5 py-4 pr-14 sm:px-6">
            <DialogTitle>{tx("Проверка входящего инвойса", "Eingangsrechnung prüfen")}</DialogTitle>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.08fr)_minmax(28rem,0.92fr)] lg:overflow-hidden">
            <section aria-label={tx("Оригинал инвойса", "Originalrechnung")} className="flex min-h-[32rem] flex-col border-b bg-muted/15 lg:min-h-0 lg:border-r lg:border-b-0">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-card px-4 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-orange-500" /><span className="truncate">{file?.name || tx("Оригинал документа", "Originaldokument")}</span></div>
                <Button type="button" size="sm" disabled={saving} onClick={() => { if (fileInput.current) { fileInput.current.value = ""; fileInput.current.click(); } }}><FileUp className="size-4" />{file ? tx("Заменить", "Ersetzen") : tx("Выбрать файл", "Datei wählen")}</Button>
              </div>
              <input ref={fileInput} type="file" className="sr-only" aria-label={tx("Файл инвойса", "Rechnungsdatei")} accept="application/pdf,image/png,image/jpeg,application/xml,text/xml,.xml" onChange={(event) => { void selectFile(event.target.files?.[0]); event.target.value = ""; }} />
              {previewUrl ? (
                file && isInvoiceXml(file) ? <XmlInvoiceOriginal file={file} url={previewUrl} /> : file?.type === "application/pdf"
                  ? <div className="m-3 flex min-h-[420px] flex-1 overflow-hidden rounded-lg border border-border/70 bg-white shadow-sm lg:min-h-0"><iframe key={`${previewUrl}:${originalPage}`} title={tx("Оригинал инвойса", "Originalrechnung")} src={`${previewUrl}#toolbar=1&page=${originalPage}`} className="h-full min-h-[420px] w-full flex-1 bg-white lg:min-h-0" /></div>
                  : <div className="m-3 flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-lg border border-border/70 bg-card p-4 shadow-sm"><img src={previewUrl} alt={tx("Оригинал инвойса", "Originalrechnung")} className="h-auto max-w-full object-contain" /></div>
              ) : (
                <button type="button" className="m-5 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center hover:bg-muted/50" onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void selectFile(event.dataTransfer.files[0]); }}>
                  <FileUp className="size-9 text-muted-foreground" /><span className="text-sm font-medium">{tx("Перетащите инвойс или выберите файл", "Rechnung hier ablegen oder Datei wählen")}</span><span className="text-xs text-muted-foreground">PDF · PNG · JPG · 25 MB / XML · 5 MB</span>
                </button>
              )}
            </section>
            <section aria-label={tx("Данные и клиент", "Angaben und Patient")} className="space-y-4 bg-muted/10 p-4 sm:p-5 lg:overflow-y-auto">
              <div className="space-y-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-orange-500" />{tx("К чему относится входящий счёт", "Zuordnung der Eingangsrechnung")}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant={scope === "company" ? "default" : "outline"}
                    className="h-auto min-h-16 justify-start whitespace-normal px-3 py-2 text-left"
                    disabled={saving || Boolean(documentId)}
                    onClick={() => { setScope("company"); setConfirmed(false); }}
                  >
                    <Building2 className="size-4 shrink-0" />
                    <span><span className="block font-semibold">{tx("Расход компании", "Unternehmensausgabe")}</span><span className="block text-xs font-normal opacity-80">{tx("Счёт выставлен непосредственно GMed", "Rechnung direkt an GMed")}</span></span>
                  </Button>
                  <Button
                    type="button"
                    variant={scope === "patient_order" ? "default" : "outline"}
                    className="h-auto min-h-16 justify-start whitespace-normal px-3 py-2 text-left"
                    disabled={saving || Boolean(documentId)}
                    onClick={() => { setScope("patient_order"); setConfirmed(false); }}
                  >
                    <Users className="size-4 shrink-0" />
                    <span><span className="block font-semibold">{tx("Расход по заказу", "Auftragsbezogene Ausgabe")}</span><span className="block text-xs font-normal opacity-80">{tx("Счёт относится к клиенту и его заказу", "Rechnung gehört zu Patient und Auftrag")}</span></span>
                  </Button>
                </div>
              </div>
              {scope === "patient_order" && optionsError ? <Banner tone="error" withIcon>{tx("Не удалось загрузить клиентов и заказы. Обновите страницу.", "Patienten und Aufträge konnten nicht geladen werden. Seite neu laden.")}</Banner> : null}
              {error ? <Banner tone="error" withIcon>{error}</Banner> : null}
              {documentId && error ? <p className="text-xs text-muted-foreground">{scope === "company"
                ? tx("Оригинал уже сохранён в документах компании. Повторная попытка использует тот же документ.", "Das Original ist bereits in den Unternehmensdokumenten gespeichert. Beim erneuten Versuch wird dasselbe Dokument verwendet.")
                : tx("Оригинал уже сохранён у выбранного клиента. Повторная попытка использует тот же документ.", "Das Original ist beim gewählten Patienten gespeichert. Beim erneuten Versuch wird dasselbe Dokument verwendet.")}</p> : null}
              {scope === "patient_order" ? <div className="space-y-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-orange-500" /><Users className="size-4 text-muted-foreground" />{tx("Привязка к клиенту", "Patientenzuordnung")}</h3>
                {manualPatientId === null && patientMatch && !parsing ? <p className="text-xs text-muted-foreground" role="status">{patientMatch.status === "matched"
                  ? tx("Клиент подставлен из документа. Проверьте привязку и выберите его заказ.", "Patient aus dem Dokument zugeordnet. Zuordnung prüfen und Auftrag auswählen.")
                  : patientMatch.status === "ambiguous"
                    ? tx("Данные подходят нескольким клиентам или противоречат друг другу. Выберите клиента вручную.", "Die Angaben passen zu mehreren Patienten oder widersprechen sich. Patienten manuell auswählen.")
                    : tx("Не удалось определить клиента по документу. Выберите его вручную.", "Patient konnte nicht anhand des Dokuments zugeordnet werden. Bitte manuell auswählen.")}</p> : null}
                <Field label={tx("Клиент", "Patient")}><NativeComboboxSelect aria-label={tx("Клиент", "Patient")} value={patientId} disabled={saving || Boolean(documentId)} onChange={(event) => { setManualPatientId(event.target.value); setOrderId(""); setConfirmed(false); }}>
                  <option value="">{tx("Найти клиента по имени или ID", "Patient nach Name oder ID suchen")}</option>
                  {patients.map((patient) => <option key={patient.id} value={patient.id}>{[patient.last_name, patient.first_name, patient.patient_id].filter(Boolean).join(" · ")}</option>)}
                </NativeComboboxSelect></Field>
                <Field label={tx("Заказ клиента", "Auftrag des Patienten")}><NativeComboboxSelect aria-label={tx("Заказ клиента", "Auftrag des Patienten")} value={selectedOrder ? orderId : ""} disabled={!patientId || saving || Boolean(documentId)} onChange={(event) => { setOrderId(event.target.value); setConfirmed(false); }}>
                  <option value="">{tx("Выбрать заказ", "Auftrag auswählen")}</option>
                  {patientOrders.map((order) => <option key={order.id} value={order.id}>{order.order_number}</option>)}
                </NativeComboboxSelect></Field>
                {patientId && !patientOrders.length ? <p className="text-xs text-amber-700">{tx("У клиента ещё нет доступного заказа. Создайте заказ перед сохранением инвойса.", "Für diesen Patienten ist kein Auftrag verfügbar. Vor dem Speichern einen Auftrag anlegen.")}</p> : null}
              </div> : null}
              <div className="space-y-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-orange-500" />{tx("Реквизиты инвойса", "Rechnungsangaben")}</h3>
                  {file && !documentId && !saving ? <Button type="button" size="sm" variant="ghost" disabled={parsing} onClick={() => void recognize(file)}><RotateCcw className="size-3.5" />{tx("Распознать", "Erkennen")}</Button> : null}
                </div>
                {parsing ? <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 p-3 text-xs" role="status"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />{tx("Распознаём документ…", "Dokument wird erkannt…")}</span><Button variant="ghost" size="sm" type="button" onClick={() => { generation.current += 1; request.current?.abort(); setParsing(false); }}>{tx("Заполнить вручную", "Manuell ausfüllen")}</Button></div> : null}
                {parseError ? <Banner tone="warning" withIcon>{parseError}</Banner> : null}
                {preview && !parsing && !preview.structured ? <div className="rounded-lg border bg-muted/30 p-3 text-xs" role="status">{recognitionMessage}</div> : null}
                {preview && !parsing ? <StructuredInvoiceDetails preview={preview} labels={labels} /> : null}
                {preview && !parsing && missingFields.length > 0 ? <Banner tone="warning" withIcon>{tx("Заполните поля", "Bitte ergänzen")}: {missingFields.map((key) => labels[key]).join(", ")}.</Banner> : null}
                {preview?.warnings.includes("tax_treatment_requires_review") ? <Banner tone="warning" withIcon>{preview.structured
                  ? tx("Reverse Charge: суммы и НДС прочитаны из XML. Налоговый режим для бухгалтерского учёта требует проверки.", "Reverse Charge: Beträge und Umsatzsteuer wurden aus XML gelesen. Die steuerliche Behandlung in der Buchhaltung ist zu prüfen.")
                  : preview.warnings.includes("invoice_vat_explicitly_not_charged")
                  ? tx("Reverse Charge: в самом счёте НДС не начислен. Суммы подставлены по документу; налоговый режим для бухгалтерского учёта требует проверки.", "Reverse Charge: Die Rechnung weist keine Umsatzsteuer aus. Beträge wurden aus dem Dokument übernommen; die steuerliche Behandlung in der Buchhaltung ist zu prüfen.")
                  : tx("В документе указан Reverse Charge. Проверьте нетто и НДС вручную; налоговый режим автоматически не определяется.", "Das Dokument nennt Reverse Charge. Netto und Umsatzsteuer manuell prüfen; die steuerliche Behandlung wird nicht automatisch bestimmt.")}</Banner> : null}
                {preview?.warnings.includes("conflicting_tax_statement") ? <Banner tone="warning" withIcon>{tx("Текст о НДС противоречит суммам в документе. Проверьте налоговые суммы вручную.", "Der Steuerhinweis widerspricht den Beträgen im Dokument. Steuerbeträge manuell prüfen.")}</Banner> : null}
                {preview?.warnings.includes("amount_net_derived_from_totals") ? <p className="text-xs text-muted-foreground">{tx("Сумма без НДС рассчитана как итог минус указанный НДС. Сверьте её с оригиналом.", "Netto wurde aus Brutto abzüglich der ausgewiesenen Umsatzsteuer berechnet. Mit dem Original abgleichen.")}</p> : null}
                <fieldset disabled={parsing || saving} className="grid gap-3 sm:grid-cols-2">
                  {(Object.keys(labels) as (keyof InvoiceImportFields)[]).map((key) => <Field key={key} label={labels[key]}>
                    <Input aria-label={labels[key]} value={fields[key]} required={key !== "due_date" && (key !== "supplier_name" || scope === "company")} type={key.endsWith("date") ? "date" : "text"}
                      inputMode={key.startsWith("amount_") ? "decimal" : undefined} maxLength={key === "currency" ? 3 : undefined}
                      onChange={(event) => updateField(key, key === "currency" ? event.target.value.toUpperCase() : event.target.value)} />
                    {preview?.field_sources?.[key] && fields[key] === preview.fields[key] ? <p className="text-xs leading-4 text-muted-foreground" title={preview.field_sources[key].text}>
                      {preview.field_sources[key].method === "document_without_vat"
                        ? tx("По фразе в счёте: «без НДС».", "Laut Rechnung: ohne Umsatzsteuer.")
                        : tx(`Рассчитано от даты счёта: +${preview.field_sources[key].days} дней. Проверьте срок.`, `Ab Rechnungsdatum berechnet: +${preview.field_sources[key].days} Tage. Frist prüfen.`)}
                    </p> : null}
                  </Field>)}
                </fieldset>
                {!parsing && fields.amount_gross && !totalsValid ? <p className="text-xs text-amber-700">{tx("Укажите все суммы: без НДС + НДС должно равняться итогу. Если НДС нет, укажите 0.", "Alle Beträge angeben: Netto + Umsatzsteuer muss Brutto entsprechen. Ohne Umsatzsteuer 0 eintragen.")}</p> : null}
              </div>
              {preview?.payment && (preview.payment.terms?.length || preview.payment.method || preview.payment.amount_due != null) ? <div className="space-y-2 rounded-xl border border-border/70 bg-card p-4 text-xs shadow-sm">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-orange-500" />{tx("Условия оплаты из документа", "Zahlungsbedingungen laut Dokument")}</h3>
                {preview.payment.terms?.map((term, index) => <p key={index}>{term}</p>)}
                {preview.payment.amount_due != null ? <p className="font-medium">{tx("К оплате по XML", "Zahlbetrag laut XML")}: {preview.payment.amount_due} {preview.fields.currency}</p> : null}
                {preview.payment.prepaid != null ? <p>{tx("Предоплата по XML", "Vorauszahlung laut XML")}: {preview.payment.prepaid} {preview.fields.currency}</p> : null}
                {preview.payment.rounding != null ? <p>{tx("Округление", "Rundung")}: {preview.payment.rounding} {preview.fields.currency}</p> : null}
                {preview.warnings.includes("payable_differs_from_total") ? <p>{tx("К оплате и итог инвойса различаются. В инвойс переносится полная сумма; передоплата из XML не создаёт платёж автоматически.", "Zahlbetrag und Rechnungsbrutto unterscheiden sich. Übernommen wird der volle Rechnungsbetrag; eine XML-Vorauszahlung erzeugt nicht automatisch eine Zahlung.")}</p> : null}
                {preview.payment.method === "direct_debit" ? <p>{tx("Автоматическое списание", "Lastschrift")}{preview.payment.collection_date ? ` · ${preview.payment.collection_date.split("-").reverse().join(".")}` : ""}. {tx("Дата списания показана отдельно от срока оплаты.", "Das Abbuchungsdatum wird getrennt von der Fälligkeit angezeigt.")}</p> : null}
              </div> : null}
              {preview?.line_items?.length ? <div className="space-y-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm"><h3 className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-orange-500" />{tx("Позиции в документе", "Positionen im Dokument")} <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-xs font-medium tabular-nums">{preview.line_items.length}</span></h3>
                {preview.warnings.includes("line_items_total_mismatch") ? <Banner tone="warning" withIcon>{tx("Сумма распознанных позиций не совпадает с итогом. Проверьте, все ли позиции прочитаны.", "Die Summe der erkannten Positionen stimmt nicht mit dem Gesamtbetrag überein. Prüfen, ob alle Positionen erfasst wurden.")}</Banner> : null}
                <div className="divide-y rounded-lg border text-xs">{preview.line_items.map((line, index) => <div key={index} className="space-y-1.5 p-3">
                  <div className="flex justify-between gap-3"><span>{String(line.name ?? line.description ?? "")}</span><span className="shrink-0 font-mono">{String(line.price_subtotal ?? line.amount ?? "")} {preview.fields.currency}</span></div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                    {line.qty != null ? <span>{tx("Кол-во", "Menge")}: {String(line.qty)}{line.unit_price != null ? ` · ${tx("Цена", "Preis")}: ${String(line.unit_price)} ${preview.fields.currency ?? ""}` : ""}{line.price_base_quantity != null && Number(line.price_base_quantity) !== 1 ? ` ${tx("за", "je")} ${String(line.price_base_quantity)}` : ""}</span> : null}
                    {line.vat_rate != null ? <span>{tx("НДС", "USt.")}: {String(line.vat_rate)} %</span> : null}
                    {line.service_period ? <span>{String(line.service_period)}</span> : null}
                    {file?.type === "application/pdf" && typeof line.page === "number" && Number.isInteger(line.page) && line.page > 0 ? <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setOriginalPage(line.page as number)}>{tx("Стр.", "Seite")} {line.page}</button> : null}
                  </div>
                </div>)}</div></div> : null}
              <div className="space-y-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-orange-500" />{tx("Проверка и примечание", "Prüfung und Notiz")}</h3>
                {preview?.text ? <div><Button type="button" variant="outline" size="sm" onClick={() => setShowText(!showText)}>{showText ? tx("Скрыть текст", "Text ausblenden") : tx("Показать распознанный текст", "Erkannten Text anzeigen")}</Button>{showText ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-border/70 bg-muted/30 p-3 text-xs">{preview.text}</pre> : null}</div> : null}
                <Field label={tx("Примечание", "Notiz")}><textarea aria-label={tx("Примечание", "Notiz")} value={notes} disabled={saving} onChange={(event) => setNotes(event.target.value)} rows={3} className="w-full rounded-md border bg-field px-3 py-2 text-sm" /></Field>
                <label className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/25 p-3 text-xs leading-5"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-orange-500" checked={confirmed} disabled={parsing || saving || (scope === "patient_order" && (!selectedPatient || !selectedOrder))} onChange={(event) => setConfirmed(event.target.checked)} /><span>{scope === "company"
                  ? tx("Я сверил реквизиты с оригиналом и проверил, что счёт выставлен нашей компании.", "Ich habe die Angaben mit dem Original verglichen und geprüft, dass die Rechnung an unser Unternehmen gestellt ist.")
                  : tx("Я сверил реквизиты с оригиналом и проверил, что выбран верный клиент и заказ.", "Ich habe die Angaben mit dem Original verglichen und Patient sowie Auftrag geprüft.")}</span></label>
              </div>
            </section>
          </div>
          <footer className="flex shrink-0 flex-col items-stretch gap-2 border-t border-border/70 bg-muted/20 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6">
            <span className={`min-w-0 text-xs sm:truncate ${ready ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>{saveHint}</span>
            <Button type="submit" className="w-full min-w-48 sm:ml-auto sm:w-auto" disabled={!ready || parsing || saving}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{saving ? tx("Сохраняем…", "Wird gespeichert…") : tx("Подтвердить и сохранить", "Bestätigen und speichern")}</Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
