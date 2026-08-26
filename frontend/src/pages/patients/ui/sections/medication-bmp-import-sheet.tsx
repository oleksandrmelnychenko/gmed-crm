import {
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  CheckCircle2,
  FileUp,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api";
import {
  confirmMedicationBmpImport,
  previewMedicationBmpImport,
  type ConfirmMedicationBmpImportResult,
  type MedicationBmpImportPreview,
  type MedicationBmpIssue,
  type MedicationBmpMedication,
} from "@/lib/api/medication-bmp-import";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type Language = "ru" | "de";
export type BmpImportOperation =
  | "idle"
  | "previewing"
  | "confirming"
  | "stale"
  | "identity_mismatch"
  | "idempotency_conflict"
  | "file_too_large"
  | "error";

type Bilingual = (ru: string, de: string) => string;

export const MEDICATION_BMP_MAX_BYTES = 128 * 1024;

export function decodeMedicationBmpCarrierBytes(bytes: ArrayBuffer): string {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    decoded = new TextDecoder("iso-8859-1", { fatal: false }).decode(bytes);
  }
  return decoded.replace(/^\uFEFF/, "");
}

function randomIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `bmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function resolveMedicationBmpIdempotencyKey(
  current: string | null,
  create: () => string = randomIdempotencyKey,
): string {
  return current || create();
}

function errorCode(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "";
  const bodyCode = error.body?.code;
  return typeof bodyCode === "string" ? bodyCode : (error.code ?? "");
}

export function medicationBmpOperationForError(error: unknown): BmpImportOperation {
  const code = errorCode(error);
  if (code === "bmp_preview_stale") return "stale";
  if (code === "bmp_patient_identity_mismatch") return "identity_mismatch";
  if (code === "bmp_idempotency_conflict") return "idempotency_conflict";
  return "error";
}

export function canConfirmMedicationBmpPreview(
  preview: MedicationBmpImportPreview,
): boolean {
  const medications = preview.sections.flatMap((section) => section.medications);
  return preview.permissions.can_confirm
    && preview.identity_match.status === "matched"
    && preview.summary.blocked_medications === 0
    && medications.length > 0
    && medications.every((item) => item.importable && item.substances.length > 0);
}

function issueText(issue: MedicationBmpIssue, language: Language): string {
  const localized = language === "de" ? issue.message_de : issue.message_ru;
  if (localized.trim()) return localized;
  return language === "de"
    ? "Dieser Punkt muss vor dem Import geprüft werden."
    : "Этот пункт необходимо проверить перед импортом.";
}

function IssueChips({
  issues,
  language,
}: {
  issues: MedicationBmpIssue[];
  language: Language;
}) {
  if (issues.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {issues.map((issue, index) => (
        <span
          key={`${issue.code}:${issue.path}:${index}`}
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] leading-4",
            issue.blocking
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-amber-200 bg-amber-50 text-amber-800",
          )}
        >
          <span aria-hidden className={cn(
            "size-1.5 shrink-0 rounded-full",
            issue.blocking ? "bg-rose-500" : "bg-amber-500",
          )} />
          <span className="break-words">{issueText(issue, language)}</span>
        </span>
      ))}
    </div>
  );
}

function doseText(item: MedicationBmpMedication, tx: Bilingual): string {
  const parts = [
    item.dose.morning,
    item.dose.noon,
    item.dose.evening,
    item.dose.night,
  ];
  const schedule = parts.some(Boolean)
    ? `${parts.map((value) => value ?? "–").join(" · ")}${item.unit?.value ? ` ${item.unit.value}` : ""}`
    : item.dose.free_text;
  const weekday = item.dose.weekly_day !== null
    ? tx(`День недели: ${item.dose.weekly_day}`, `Wochentag: ${item.dose.weekly_day}`)
    : null;
  return [schedule, weekday].filter(Boolean).join(" · ") || "—";
}

function MedicationRow({
  item,
  language,
}: {
  item: MedicationBmpMedication;
  language: Language;
}) {
  const tx: Bilingual = (ru, de) => (language === "de" ? de : ru);
  const substance = item.substances.length > 0
    ? item.substances
      .map((entry) => [entry.name, entry.strength].filter(Boolean).join(" "))
      .join(", ")
    : null;
  return (
    <article className={cn(
      "rounded-lg border bg-white px-3 py-2.5",
      item.importable ? "border-border" : "border-rose-200",
    )}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="break-words text-sm font-semibold text-foreground">
              {item.trade_name || substance || tx("Без торгового названия", "Ohne Handelsname")}
            </p>
            {item.pzn ? (
              <Badge variant="outline" className="rounded-full font-mono text-[10px] font-normal">
                PZN {item.pzn}
              </Badge>
            ) : null}
          </div>
          {substance ? (
            <p className="mt-0.5 break-words text-xs text-muted-foreground">{substance}</p>
          ) : (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-rose-700">
              <span aria-hidden className="size-1.5 rounded-full bg-rose-500" />
              {tx("Требуется уточнить: не указано действующее вещество", "Wirkstoff fehlt: Klärung erforderlich")}
            </p>
          )}
        </div>
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]",
          item.importable
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-rose-200 bg-rose-50 text-rose-700",
        )}>
          <span aria-hidden className={cn(
            "size-1.5 rounded-full",
            item.importable ? "bg-emerald-500" : "bg-rose-500",
          )} />
          {item.importable ? tx("Готово к импорту", "Importierbar") : tx("Заблокировано", "Blockiert")}
        </span>
      </div>
      <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{tx("Форма", "Form")}</dt>
          <dd className="mt-0.5 break-words text-foreground">{item.form?.value || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{tx("Схема приёма", "Einnahmeschema")}</dt>
          <dd className="mt-0.5 break-words text-foreground">{doseText(item, tx)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{tx("Указание / причина", "Hinweis / Grund")}</dt>
          <dd className="mt-0.5 break-words text-foreground">
            {[item.instructions, item.reason, item.additional_text].filter(Boolean).join(" · ") || "—"}
          </dd>
        </div>
      </dl>
      <div className="mt-2">
        <IssueChips issues={item.blocking_reasons} language={language} />
      </div>
    </article>
  );
}

function IdentityReview({
  preview,
  language,
}: {
  preview: MedicationBmpImportPreview;
  language: Language;
}) {
  const tx: Bilingual = (ru, de) => (language === "de" ? de : ru);
  const status = preview.identity_match.status;
  const matched = status === "matched";
  const mismatch = status === "mismatch";
  const fieldLabels: Record<string, string> = {
    given_name: tx("Имя", "Vorname"),
    family_name: tx("Фамилия", "Nachname"),
    birth_date: tx("Дата рождения", "Geburtsdatum"),
  };
  return (
    <section
      aria-label={tx("Проверка пациента", "Patientenabgleich")}
      className={cn(
        "rounded-xl border p-3",
        matched
          ? "border-emerald-200 bg-emerald-50/60"
          : mismatch
            ? "border-rose-300 bg-rose-50"
            : "border-amber-200 bg-amber-50/70",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className={cn(
            "size-2 rounded-full",
            matched ? "bg-emerald-500" : mismatch ? "bg-rose-500" : "bg-amber-500",
          )} />
          <h3 className="text-sm font-semibold text-foreground">
            {matched
              ? tx("Пациент подтверждён", "Patient stimmt überein")
              : mismatch
                ? tx("Данные пациента не совпадают", "Patientendaten stimmen nicht überein")
                : tx("Недостаточно данных для сопоставления", "Nicht genügend Daten für den Abgleich")}
          </h3>
        </div>
        {!matched ? (
          <Badge variant="outline" className={cn(
            "rounded-full text-[10px]",
            mismatch ? "border-rose-200 text-rose-700" : "border-amber-200 text-amber-800",
          )}>
            {tx("Импорт заблокирован", "Import blockiert")}
          </Badge>
        ) : null}
      </div>
      {!matched ? (
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {tx(
            "BMP нельзя применить к этому профилю, пока идентичность пациента не будет однозначно подтверждена.",
            "Der BMP kann diesem Profil nicht zugeordnet werden, solange die Patientenidentität nicht eindeutig bestätigt ist.",
          )}
        </p>
      ) : null}
      {preview.identity_match.fields.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-lg border bg-white">
          <div className="grid grid-cols-[minmax(90px,.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{tx("Поле", "Feld")}</span>
            <span>{tx("В BMP", "Im BMP")}</span>
            <span>{tx("В профиле", "Im Profil")}</span>
          </div>
          {preview.identity_match.fields.map((field) => (
            <div
              key={field.field}
              className="grid grid-cols-[minmax(90px,.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b px-3 py-2 text-xs last:border-b-0"
            >
              <span className="text-muted-foreground">{fieldLabels[field.field]}</span>
              <span className={cn("break-words", !field.matches && "font-medium text-rose-700")}>{field.carrier_value || "—"}</span>
              <span className={cn("break-words", !field.matches && "font-medium text-rose-700")}>{field.patient_value || "—"}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2">
        <IssueChips issues={preview.identity_match.blocking_reasons} language={language} />
      </div>
    </section>
  );
}

export function MedicationBmpImportPreviewContent({
  preview,
  language,
}: {
  preview: MedicationBmpImportPreview;
  language: Language;
}) {
  const tx: Bilingual = (ru, de) => (language === "de" ? de : ru);
  const address = [
    preview.issuer.street,
    [preview.issuer.postal_code, preview.issuer.city].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-xl border bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tx("План", "Plan")}
          </p>
          <p className="mt-1 break-words text-sm font-semibold text-foreground">
            BMP {preview.plan.version} · {preview.plan.printed_at || "—"}
          </p>
          <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
            {preview.plan.instance_id || "—"}
          </p>
        </section>
        <section className="rounded-xl border bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tx("Автор плана", "Aussteller")}
          </p>
          <p className="mt-1 break-words text-sm font-semibold text-foreground">
            {preview.issuer.name || "—"}
          </p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            {address || tx("Адрес не указан", "Adresse nicht angegeben")}
          </p>
        </section>
      </div>

      <IdentityReview preview={preview} language={language} />

      {preview.warnings.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <h3 className="text-sm font-semibold text-foreground">{tx("Предупреждения BMP", "BMP-Hinweise")}</h3>
          <div className="mt-2">
            <IssueChips issues={preview.warnings} language={language} />
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border bg-slate-50/50">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full bg-[var(--brand)]" />
            <h3 className="text-sm font-semibold text-foreground">{tx("Медикаменты в BMP", "Medikamente im BMP")}</h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="rounded-full text-[10px]">
              {tx("Всего", "Gesamt")}: {preview.summary.medications_total}
            </Badge>
            {preview.summary.blocked_medications > 0 ? (
              <Badge variant="outline" className="rounded-full border-rose-200 bg-rose-50 text-[10px] text-rose-700">
                {tx("Заблокировано", "Blockiert")}: {preview.summary.blocked_medications}
              </Badge>
            ) : null}
          </div>
        </header>
        <div className="space-y-3 p-3">
          {preview.sections.map((section) => (
            <div key={`${section.index}:${section.code ?? section.title ?? "section"}`} className="space-y-1.5">
              <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.title || (
                  section.category === "besondere"
                    ? tx("По особым показаниям", "Zu besonderen Zeiten")
                    : section.category === "selbst"
                      ? tx("Самолечение", "Selbstmedikation")
                      : tx("Постоянная терапия", "Dauermedikation")
                )}
              </p>
              {section.medications.map((item) => (
                <MedicationRow key={`${section.index}:${item.index}`} item={item} language={language} />
              ))}
            </div>
          ))}
          {preview.summary.medications_total === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {tx("В BMP нет медикаментов для импорта.", "Der BMP enthält keine importierbaren Medikamente.")}
            </p>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-xs leading-5 text-amber-900">
        <p className="font-semibold">{tx("Замена текущего плана", "Aktuellen Plan ersetzen")}</p>
        <p>
          {tx(
            `После подтверждения все ${preview.summary.current_medications_replaced} текущих записей будут заменены данными из BMP. Частичный импорт невозможен.`,
            `Nach der Bestätigung werden alle ${preview.summary.current_medications_replaced} aktuellen Einträge durch die BMP-Daten ersetzt. Ein Teilimport ist nicht möglich.`,
          )}
        </p>
      </section>
    </div>
  );
}

export function medicationBmpOperationMessage(
  operation: BmpImportOperation,
  language: Language,
): string {
  const tx: Bilingual = (ru, de) => (language === "de" ? de : ru);
  if (operation === "stale") {
    return tx(
      "Предпросмотр устарел: план пациента изменился. Создайте новый предпросмотр перед подтверждением.",
      "Die Vorschau ist veraltet: Der Medikationsplan wurde geändert. Erstellen Sie vor der Bestätigung eine neue Vorschau.",
    );
  }
  if (operation === "identity_mismatch") {
    return tx(
      "Сервер повторно обнаружил несовпадение пациента. Обновите предпросмотр и проверьте профиль.",
      "Der Server hat erneut abweichende Patientendaten erkannt. Aktualisieren Sie die Vorschau und prüfen Sie das Profil.",
    );
  }
  if (operation === "idempotency_conflict") {
    return tx(
      "Эта попытка подтверждения относится к другому предпросмотру. Создайте новый предпросмотр.",
      "Dieser Bestätigungsversuch gehört zu einer anderen Vorschau. Erstellen Sie eine neue Vorschau.",
    );
  }
  if (operation === "file_too_large") {
    return tx(
      "Файл BMP превышает допустимый размер 128 КиБ. Выберите исходный XML носителя BMP.",
      "Die BMP-Datei überschreitet die zulässigen 128 KiB. Wählen Sie das ursprüngliche XML des BMP-Datenträgers.",
    );
  }
  return tx(
    "Не удалось обработать BMP. Проверьте XML и повторите попытку.",
    "Der BMP konnte nicht verarbeitet werden. Prüfen Sie das XML und versuchen Sie es erneut.",
  );
}

export function MedicationBmpImportAction({
  patientId,
  disabled = false,
  onImported,
}: {
  patientId: string;
  disabled?: boolean;
  onImported?: (result: ConfirmMedicationBmpImportResult) => void;
}) {
  const { lang } = useLang();
  const language: Language = lang === "de" ? "de" : "ru";
  const tx: Bilingual = (ru, de) => (language === "de" ? de : ru);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [carrierXml, setCarrierXml] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<MedicationBmpImportPreview | null>(null);
  const [result, setResult] = useState<ConfirmMedicationBmpImportResult | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [operation, setOperation] = useState<BmpImportOperation>("idle");

  const busy = operation === "previewing" || operation === "confirming";
  const confirmable = preview ? canConfirmMedicationBmpPreview(preview) : false;

  function resetPreview(nextXml = carrierXml) {
    setCarrierXml(nextXml);
    setPreview(null);
    setResult(null);
    setAcknowledged(false);
    setOperation("idle");
    idempotencyKeyRef.current = null;
  }

  function closeSheet() {
    if (busy) return;
    setOpen(false);
    setCarrierXml("");
    setFileName("");
    setPreview(null);
    setResult(null);
    setAcknowledged(false);
    setOperation("idle");
    idempotencyKeyRef.current = null;
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MEDICATION_BMP_MAX_BYTES) {
      setFileName(file.name);
      resetPreview("");
      setOperation("file_too_large");
      return;
    }
    try {
      const text = decodeMedicationBmpCarrierBytes(await file.arrayBuffer());
      setFileName(file.name);
      resetPreview(text);
    } catch {
      setOperation("error");
    }
  }

  async function createPreview() {
    if (!carrierXml.trim()) return;
    setOperation("previewing");
    setResult(null);
    setAcknowledged(false);
    idempotencyKeyRef.current = null;
    try {
      const response = await previewMedicationBmpImport(patientId, carrierXml.trim());
      setPreview(response);
      setOperation("idle");
    } catch (error) {
      setPreview(null);
      setOperation(medicationBmpOperationForError(error));
    }
  }

  async function confirmImport() {
    if (!preview || !acknowledged || !canConfirmMedicationBmpPreview(preview)) return;
    const idempotencyKey = resolveMedicationBmpIdempotencyKey(idempotencyKeyRef.current);
    idempotencyKeyRef.current = idempotencyKey;
    setOperation("confirming");
    try {
      const response = await confirmMedicationBmpImport(patientId, {
        carrier_xml: carrierXml.trim(),
        preview_fingerprint: preview.preview_fingerprint,
        idempotency_key: idempotencyKey,
        staff_acknowledged: true,
      });
      setResult(response);
      setOperation("idle");
      onImported?.(response);
    } catch (error) {
      setOperation(medicationBmpOperationForError(error));
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 rounded-lg"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <FileUp className="size-3.5" />
        {tx("Импорт BMP-XML", "BMP-XML importieren")}
      </Button>

      <PatientSheetScaffold
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setOpen(true);
          else closeSheet();
        }}
        width="detail-wide"
        title={tx("Импорт плана медикаментов BMP", "BMP-Medikationsplan importieren")}
        description={tx(
          "Вставьте или загрузите уже декодированный XML из носителя BMP. Камера и декодирование DataMatrix пока не выполняются.",
          "Fügen Sie bereits dekodiertes XML aus dem BMP-Datenträger ein oder laden Sie es hoch. Kamera- und DataMatrix-Dekodierung sind noch nicht enthalten.",
        )}
        footer={result ? (
          <Button type="button" size="sm" className="h-8 rounded-lg" onClick={closeSheet}>
            {tx("Готово", "Fertig")}
          </Button>
        ) : (
          <>
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg" disabled={busy} onClick={closeSheet}>
              {tx("Отмена", "Abbrechen")}
            </Button>
            {preview ? (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg"
                disabled={busy || !acknowledged || !confirmable}
                onClick={() => void confirmImport()}
              >
                {operation === "confirming" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {tx("Подтвердить импорт", "Import bestätigen")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg"
                disabled={busy || !carrierXml.trim()}
                onClick={() => void createPreview()}
              >
                {operation === "previewing" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {tx("Проверить BMP", "BMP prüfen")}
              </Button>
            )}
          </>
        )}
      >
        {result ? (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4" role="status">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">{tx("BMP импортирован", "BMP importiert")}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {tx(
                    `Импортировано: ${result.imported_medications}. Заменено текущих записей: ${result.superseded_medications}.`,
                    `Importiert: ${result.imported_medications}. Ersetzte aktuelle Einträge: ${result.superseded_medications}.`,
                  )}
                </p>
                {result.idempotent_replay ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {tx("Показан результат безопасного повторного запроса.", "Ergebnis einer sicheren Wiederholung.")}
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="rounded-xl border bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{tx("Декодированный XML", "Dekodiertes XML")}</h3>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {tx(
                      "XML анализируется на сервере. Сам план не применяется до отдельного подтверждения.",
                      "Das XML wird serverseitig geprüft. Der Plan wird erst nach einer separaten Bestätigung übernommen.",
                    )}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                  <FileUp className="size-3.5" />
                  {tx("Загрузить XML", "XML laden")}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  className="sr-only"
                  aria-label={tx("Загрузить XML BMP", "BMP-XML laden")}
                  onChange={(event) => void handleFile(event)}
                />
              </div>
              {fileName ? (
                <p className="mt-2 break-all text-[11px] text-muted-foreground">{fileName}</p>
              ) : null}
              <textarea
                value={carrierXml}
                disabled={busy}
                spellCheck={false}
                aria-label={tx("XML носителя BMP", "XML des BMP-Datenträgers")}
                placeholder={'<MP v="028" ...>…</MP>'}
                className="mt-3 min-h-36 w-full resize-y rounded-lg border border-border bg-field px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                onChange={(event) => {
                  setFileName("");
                  resetPreview(event.target.value);
                }}
              />
            </section>

            {operation === "stale"
              || operation === "identity_mismatch"
              || operation === "idempotency_conflict"
              || operation === "file_too_large"
              || operation === "error" ? (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-800">
                  <p>{medicationBmpOperationMessage(operation, language)}</p>
                  {preview && operation !== "error" ? (
                    <Button type="button" size="sm" variant="outline" className="mt-2 h-8 rounded-lg border-rose-200 bg-white" onClick={() => void createPreview()}>
                      <RefreshCw className="size-3.5" />
                      {tx("Обновить предпросмотр", "Vorschau aktualisieren")}
                    </Button>
                  ) : null}
                </div>
              ) : null}

            {preview ? (
              <>
                <MedicationBmpImportPreviewContent preview={preview} language={language} />
                <label className={cn(
                  "flex items-start gap-2.5 rounded-xl border px-3 py-3 text-xs leading-5",
                  confirmable ? "border-border bg-white" : "border-muted bg-muted/25 text-muted-foreground",
                )}>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
                    checked={acknowledged}
                    disabled={!confirmable || busy}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  <span>
                    {tx(
                      "Я проверил(а) пациента, автора и все строки BMP. Я понимаю, что импорт полностью заменит текущий план медикаментов и не является рекомендацией по лечению.",
                      "Ich habe Patient, Aussteller und alle BMP-Zeilen geprüft. Mir ist bewusst, dass der Import den aktuellen Medikationsplan vollständig ersetzt und keine Behandlungsempfehlung darstellt.",
                    )}
                  </span>
                </label>
                {!confirmable ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {tx(
                      "Подтверждение станет доступно только после устранения всех блокирующих пунктов. Торговое название или PZN не заменяют отсутствующее действующее вещество.",
                      "Die Bestätigung wird erst möglich, wenn alle blockierenden Punkte geklärt sind. Handelsname oder PZN ersetzen keinen fehlenden Wirkstoff.",
                    )}
                  </p>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </PatientSheetScaffold>
    </>
  );
}
