import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, ScanText, ShieldAlert, ShieldCheck } from "lucide-react";

import { checkboxClass } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiRequestError } from "@/lib/api";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import { recognizeIdentityDocument } from "../data/identity-recognition-api";
import {
  defaultRecognitionSelection,
  recognitionDocumentPatch,
  recognitionDocumentRows,
  recognitionErrorText,
  recognitionFailedChecks,
  recognitionHolderPatch,
  recognitionHolderRows,
  type IdentityRecognition,
  type RecognitionHolderCurrent,
  type RecognitionHolderPatch,
  type RecognitionRow,
  type RecognizedDocumentField,
  type RecognizedHolderField,
} from "../model/identity-recognition";
import type { IdentityDocumentDraft } from "../model/lead-identity-document-data";
import type { Tx } from "../model/lead-payer";

const ATTEMPTED_KEY = "gmed.identity-recognition.attempted";
const APPLIED_KEY = "gmed.identity-recognition.applied";

/** One file of the person's identity document, as the list above the form names it. */
export type RecognitionScan = { id: string; name: string };

/** Every state but `idle` names the one file it is about. */
type RunState =
  | { kind: "idle" }
  | { kind: "running"; scanId: string }
  | { kind: "error"; scanId: string; message: string }
  | { kind: "not_found"; scanId: string }
  | { kind: "result"; scanId: string; result: IdentityRecognition }
  | { kind: "applied"; scanId: string };

/**
 * A form of GMED itself that was uploaded among the identity files (DEV
 * 2026-11-10: the sheet «Durchführung verstärkter Sorgfaltspflichten» of
 * another lead): it has no machine readable zone and is never offered.
 */
export function looksLikeInternalForm(name: string): boolean {
  return /sorgfaltspflicht|dokumentationsbogen|selbstauskunft|(^|[^a-z])gwg([^a-z]|$)/i.test(name);
}

/** Which file the values in the form were taken from, and when (this browser's note; no value of the document). */
function appliedMarks(): Record<string, string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(APPLIED_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function rememberApplied(scanId: string, at: string) {
  try {
    const entries = Object.entries(appliedMarks()).filter(([id]) => id !== scanId).slice(-199);
    window.localStorage.setItem(APPLIED_KEY, JSON.stringify(Object.fromEntries([...entries, [scanId, at]])));
  } catch {
    // Without storage the note lives until the form is closed.
  }
}

/** The file the form's values were last taken from, among the files still listed. */
function lastApplied(scans: readonly RecognitionScan[]): { scan: RecognitionScan; at: string } | null {
  const marks = appliedMarks();
  let found: { scan: RecognitionScan; at: string } | null = null;
  for (const scan of scans) {
    const at = marks[scan.id];
    if (typeof at === "string" && (!found || at > found.at)) found = { scan, at };
  }
  return found;
}

/** The scan sets a reading already started for by itself in this tab: it starts once, not at every opening. */
function attempted(key: string): boolean {
  try {
    return (window.sessionStorage.getItem(ATTEMPTED_KEY) ?? "").split("\n").includes(key);
  } catch {
    return false;
  }
}

function rememberAttempt(key: string) {
  try {
    const keys = (window.sessionStorage.getItem(ATTEMPTED_KEY) ?? "").split("\n").filter(Boolean);
    if (!keys.includes(key)) window.sessionStorage.setItem(ATTEMPTED_KEY, [...keys.slice(-50), key].join("\n"));
  } catch {
    // Without storage the reading simply starts again at the next opening.
  }
}

function Rows<Field extends string>({
  rows,
  selected,
  selectable,
  onToggle,
  tx,
  testId,
}: {
  rows: readonly RecognitionRow<Field>[];
  selected: ReadonlySet<Field>;
  selectable: boolean;
  onToggle: (field: Field) => void;
  tx: Tx;
  testId: string;
}) {
  return (
    <ul className="space-y-1">
      {rows.map((row) => {
        const takeable = selectable && row.state !== "same";
        return (
          <li key={row.field} data-testid={`${testId}-${row.field}`} data-state={row.state}>
            <label className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm", takeable && "cursor-pointer")}>
              {takeable ? (
                <input
                  type="checkbox"
                  className={cn(checkboxClass, "translate-y-0.5")}
                  checked={selected.has(row.field)}
                  onChange={() => onToggle(row.field)}
                  aria-label={`${row.label}: ${row.proposed}`}
                />
              ) : (
                <span aria-hidden="true" className="inline-block w-4" />
              )}
              <span className="text-muted-foreground">{row.label}:</span>
              <span className="font-medium text-foreground [overflow-wrap:anywhere]">{row.proposed}</span>
              {row.state === "same" ? (
                <span className="text-xs text-emerald-700 dark:text-emerald-300">{tx("совпадает", "stimmt überein")}</span>
              ) : row.state === "differs" ? (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                  {tx("сейчас в форме", "im Formular")}: {row.current}
                </span>
              ) : null}
              {!row.verified && row.state !== "same" ? (
                <span className="text-xs text-amber-700 dark:text-amber-300">{tx("не подтверждено контрольной цифрой", "nicht durch Prüfziffer bestätigt")}</span>
              ) : null}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * «Распознать со скана» of one person's identity document: the server reads
 * the machine readable zone of the uploaded scan and this panel shows the
 * values as a proposal. Nothing reaches the form before staff press
 * «Подставить»; a field that already holds another value is never ticked by
 * itself.
 *
 * One file is read at a time and every line names it (owner 2026-11-10: with
 * two files nobody could tell which one was read): with several files staff
 * choose the file; the reading starts by itself only when there is exactly one
 * file and the document fields are still empty.
 */
export function LeadIdentityRecognition({
  scans,
  draft,
  onApply,
  holder,
  onApplyHolder,
  tx,
  lang,
  disabled = false,
  testId,
}: {
  /** The files of this person's identity document, in the order of the list above the form. */
  scans: readonly RecognitionScan[];
  draft: IdentityDocumentDraft;
  /** Puts the ticked document values into the form (the form's own save stores them). */
  onApply: (patch: Partial<IdentityDocumentDraft>) => void;
  /** The person's data in the form, to show what the document says differently. */
  holder?: RecognitionHolderCurrent;
  /** Takes the ticked data of the person; without it they are only compared. */
  onApplyHolder?: (patch: RecognitionHolderPatch) => void;
  tx: Tx;
  lang: string;
  disabled?: boolean;
  testId: string;
}) {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const [documentSelection, setDocumentSelection] = useState<ReadonlySet<RecognizedDocumentField>>(() => new Set());
  const [holderSelection, setHolderSelection] = useState<ReadonlySet<RecognizedHolderField>>(() => new Set());
  const runRef = useRef(0);
  const mountedRef = useRef(true);
  const txRef = useRef(tx);
  txRef.current = tx;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const holderRef = useRef(holder);
  holderRef.current = holder;
  const langRef = useRef(lang);
  langRef.current = lang;
  const scanKey = scans.map((scan) => scan.id).join(",");
  const readable = useMemo(() => scans.filter((scan) => !looksLikeInternalForm(scan.name)), [scans]);
  const skipped = useMemo(() => scans.filter((scan) => looksLikeInternalForm(scan.name)), [scans]);
  const onlyScanId = readable.length === 1 ? readable[0].id : "";
  const [appliedFrom, setAppliedFrom] = useState(() => lastApplied(scans));
  useEffect(() => {
    setAppliedFrom(lastApplied(scans));
    // Only another set of files changes the note.
  }, [scanKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (scanId: string) => {
    const token = ++runRef.current;
    const current = () => mountedRef.current && runRef.current === token;
    setState({ kind: "running", scanId });
    try {
      const result = await recognizeIdentityDocument(scanId);
      if (!current()) return;
      if (!result || result.status === "not_found") {
        setState({ kind: "not_found", scanId });
        return;
      }
      setDocumentSelection(new Set(defaultRecognitionSelection(recognitionDocumentRows(result, draftRef.current, txRef.current, langRef.current))));
      // The person's data are never ticked by themselves: they are entered elsewhere.
      setHolderSelection(new Set());
      setState({ kind: "result", scanId, result });
    } catch (error) {
      if (!current()) return;
      const code = error instanceof ApiRequestError ? error.code ?? (error.body as { code?: string } | null)?.code : null;
      setState({ kind: "error", scanId, message: recognitionErrorText(code, txRef.current) });
    }
  }, []);

  // Once per set of scans, while nothing of the document is entered yet, and
  // only with one file: among several, staff say which one to read.
  const empty = !draft.type && !draft.number.trim() && !draft.country && !draft.validUntil && !draft.unreadable;
  useEffect(() => {
    if (!onlyScanId || disabled || !empty || attempted(scanKey)) return;
    rememberAttempt(scanKey);
    void run(onlyScanId);
    // Only a new set of scans starts a reading; typing into the form does not.
  }, [scanKey, onlyScanId, disabled]);

  const result = state.kind === "result" ? state.result : null;
  const documentRows = useMemo(() => (result ? recognitionDocumentRows(result, draft, tx, lang) : []), [result, draft, tx, lang]);
  const holderRows = useMemo(() => (result ? recognitionHolderRows(result, holder ?? {}, tx, lang) : []), [result, holder, tx, lang]);

  if (scans.length === 0) return null;

  const fileName = (scanId: string) => scans.find((scan) => scan.id === scanId)?.name || tx("файл без имени", "Datei ohne Namen");
  const stateFile = state.kind === "idle" ? "" : fileName(state.scanId);
  const running = state.kind === "running";

  const toggle = <Field extends string>(set: (update: (current: ReadonlySet<Field>) => ReadonlySet<Field>) => void) => (field: Field) =>
    set((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  const documentPatch = recognitionDocumentPatch(documentRows, documentSelection);
  const holderPatch = onApplyHolder ? recognitionHolderPatch(holderRows, holderSelection) : {};
  const nothingTicked = Object.keys(documentPatch).length === 0 && Object.keys(holderPatch).length === 0;
  const failedChecks = result && result.status === "unverified" ? recognitionFailedChecks(result, tx) : [];
  const holderDiffers = holderRows.some((row) => row.state === "differs");

  const apply = () => {
    if (state.kind !== "result") return;
    if (Object.keys(documentPatch).length > 0) onApply(documentPatch);
    if (onApplyHolder && Object.keys(holderPatch).length > 0) onApplyHolder(holderPatch);
    const at = new Date().toISOString();
    rememberApplied(state.scanId, at);
    const scan = scans.find((item) => item.id === state.scanId);
    if (scan) setAppliedFrom({ scan, at });
    setState({ kind: "applied", scanId: state.scanId });
  };

  return (
    <div className="space-y-2" data-testid={testId} data-state={state.kind}>
      {appliedFrom ? (
        <p className="text-xs leading-5 text-muted-foreground" data-testid={`${testId}-source`}>
          {tx("Данные подставлены из файла", "Daten übernommen aus der Datei")}{" "}
          <span className="font-medium text-foreground [overflow-wrap:anywhere]">«{fileName(appliedFrom.scan.id)}»</span>
          {" · "}
          {formatAppDateTime(appliedFrom.at)}
        </p>
      ) : null}
      {readable.length === 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            // As «Добавить файл» and «Подтвердить документ» of the same block (owner 2026-11-10).
            variant="default"
            className="h-8 rounded-lg"
            aria-busy={running}
            disabled={disabled || running}
            onClick={() => void run(onlyScanId)}
            data-testid={`${testId}-run`}
          >
            {running ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <ScanText aria-hidden="true" className="size-3.5" />}
            {running
              ? tx("Распознаём…", "Wird gelesen…")
              : state.kind === "idle"
                ? tx("Распознать со скана", "Aus dem Scan lesen")
                : tx("Распознать ещё раз", "Erneut lesen")}
          </Button>
          <span className="min-w-0 text-xs text-muted-foreground" data-testid={`${testId}-file`}>
            {tx("Файл", "Datei")}: <span className="font-medium text-foreground [overflow-wrap:anywhere]">{fileName(onlyScanId)}</span>
          </span>
        </div>
      ) : readable.length > 1 ? (
        <div className="space-y-1.5" data-testid={`${testId}-files`}>
          <span className="block text-xs font-medium text-foreground">
            {tx("Файлов несколько — выберите, из какого прочитать данные документа:", "Mehrere Dateien – bitte wählen, aus welcher die Ausweisdaten gelesen werden:")}
          </span>
          <ul className="space-y-1">
            {readable.map((scan) => {
              const active = state.kind !== "idle" && state.scanId === scan.id;
              return (
                <li key={scan.id} className="flex flex-wrap items-center gap-2" data-active={active ? "true" : undefined}>
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    className="h-8 shrink-0 rounded-lg"
                    aria-busy={running && active}
                    disabled={disabled || running}
                    onClick={() => void run(scan.id)}
                    aria-label={`${tx("Прочитать файл", "Datei lesen")} ${fileName(scan.id)}`}
                    data-testid={`${testId}-run-${scan.id}`}
                  >
                    {running && active ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <ScanText aria-hidden="true" className="size-3.5" />}
                    {running && active
                      ? tx("Распознаём…", "Wird gelesen…")
                      : active
                        ? tx("Прочитать ещё раз", "Erneut lesen")
                        : tx("Прочитать", "Lesen")}
                  </Button>
                  <span className={cn("min-w-0 text-xs [overflow-wrap:anywhere]", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {fileName(scan.id)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {skipped.length > 0 ? (
        <p className="text-xs leading-5 text-amber-700 dark:text-amber-300" data-testid={`${testId}-skipped`}>
          {tx(
            "Не читается как документ личности (похоже на внутренний бланк GMED, проверьте, тот ли файл загружен):",
            "Wird nicht als Ausweis gelesen (sieht nach einem internen GMED-Formular aus, bitte prüfen, ob die richtige Datei hochgeladen wurde):",
          )}{" "}
          <span className="font-medium [overflow-wrap:anywhere]">{skipped.map((scan) => scan.name).join(", ")}</span>
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground" aria-live="polite" data-testid={`${testId}-progress`}>
        {state.kind === "running"
          ? `${tx("Читаем машиночитаемую зону файла", "Die maschinenlesbare Zone wird gelesen, Datei")} «${stateFile}»…`
          : state.kind === "applied"
            ? `${tx("Подставлено из файла", "Übernommen aus der Datei")} «${stateFile}». ${tx("Проверьте поля и дополните «Кем выдан».", "Bitte prüfen und die Behörde ergänzen.")}`
            : state.kind === "idle" && readable.length > 0
              ? tx("Заполняет поля из машиночитаемой зоны; ничего не сохраняется без вашего подтверждения.", "Füllt die Felder aus der maschinenlesbaren Zone; nichts wird ohne Ihre Bestätigung gespeichert.")
              : null}
      </p>
      {state.kind === "error" ? (
        <p role="alert" className="text-xs font-medium text-destructive" data-testid={`${testId}-error`}>
          {tx("Файл", "Datei")} «{stateFile}»: {state.message}
        </p>
      ) : null}
      {state.kind === "not_found" ? (
        <p role="status" className="text-xs font-medium text-amber-700 dark:text-amber-300" data-testid={`${testId}-not-found`}>
          {tx("В файле", "In der Datei")} «{stateFile}»{" "}
          {tx(
            "машиночитаемая зона не найдена. Выберите другой файл или введите данные вручную. Лучше всего читается ровный скан страницы с фото целиком, без бликов.",
            "wurde keine maschinenlesbare Zone gefunden. Bitte eine andere Datei wählen oder manuell eingeben. Am besten lesbar ist ein gerader Scan der ganzen Datenseite ohne Reflexionen.",
          )}
        </p>
      ) : null}
      {result ? (
        <div className="space-y-2.5 rounded-xl border border-border bg-muted/20 p-3" data-testid={`${testId}-proposal`} data-status={result.status}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground" data-testid={`${testId}-proposal-file`}>
              {tx("Распознано из файла", "Gelesen aus der Datei")} <span className="[overflow-wrap:anywhere]">«{stateFile}»</span>
            </span>
            {result.status === "verified" ? (
              <StatusChip tone="success" className="whitespace-normal">
                <ShieldCheck aria-hidden="true" />
                {tx("Контрольные цифры совпали", "Prüfziffern stimmen")}
              </StatusChip>
            ) : (
              <StatusChip tone="warning" className="whitespace-normal">
                <ShieldAlert aria-hidden="true" />
                {tx("Контрольные цифры не совпали", "Prüfziffern stimmen nicht")}
              </StatusChip>
            )}
          </div>
          {result.status === "unverified" ? (
            <p role="alert" className="text-xs font-medium leading-5 text-amber-700 dark:text-amber-300" data-testid={`${testId}-unverified`}>
              {tx(
                `Скан прочитан с ошибками (${failedChecks.join(", ")}). Значения ниже могут быть неверными: ничего не отмечено, сверьте каждое по скану или введите вручную.`,
                `Der Scan wurde fehlerhaft gelesen (${failedChecks.join(", ")}). Die Werte unten können falsch sein: nichts ist angekreuzt, bitte jeden Wert mit dem Scan vergleichen oder manuell eingeben.`,
              )}
            </p>
          ) : null}
          {documentRows.length > 0 ? (
            <Rows rows={documentRows} selected={documentSelection} selectable onToggle={toggle(setDocumentSelection)} tx={tx} testId={`${testId}-document`} />
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">
            {tx(
              "«Кем выдан» и дата выдачи в машиночитаемой зоне отсутствуют — внесите их со скана.",
              "Ausstellende Behörde und Ausstellungsdatum stehen nicht in der maschinenlesbaren Zone – bitte vom Scan übernehmen.",
            )}
          </p>
          {holderRows.length > 0 ? (
            <div className="space-y-1.5 border-t border-border/60 pt-2.5">
              <span className="block text-xs font-semibold text-foreground">{tx("Владелец документа", "Inhaber des Dokuments")}</span>
              <Rows
                rows={holderRows}
                selected={holderSelection}
                selectable={Boolean(onApplyHolder)}
                onToggle={toggle(setHolderSelection)}
                tx={tx}
                testId={`${testId}-holder`}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {tx(
                  "Имя в документе записано латиницей без диакритики и дефисов.",
                  "Der Name steht im Dokument in lateinischer Umschrift ohne Sonderzeichen und Bindestriche.",
                )}
                {result.namesTruncated ? ` ${tx("Длинное имя в зоне обрезано.", "Ein langer Name ist in der Zone gekürzt.")}` : ""}
              </p>
              {holderDiffers ? (
                <p role="alert" className="text-xs font-medium leading-5 text-amber-700 dark:text-amber-300" data-testid={`${testId}-holder-differs`}>
                  {onApplyHolder
                    ? tx("Данные человека в форме отличаются от документа. Проверьте, тот ли это документ; отметьте, что взять из документа.", "Die Personendaten im Formular weichen vom Dokument ab. Bitte prüfen, ob es das richtige Dokument ist; ankreuzen, was übernommen werden soll.")
                    : tx("Данные человека в форме отличаются от документа. Проверьте, тот ли это документ, и при необходимости исправьте данные человека.", "Die Personendaten im Formular weichen vom Dokument ab. Bitte prüfen, ob es das richtige Dokument ist, und die Personendaten ggf. korrigieren.")}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="h-8 rounded-lg" disabled={disabled || nothingTicked} onClick={apply} data-testid={`${testId}-apply`}>
              {tx("Подставить отмеченное", "Angekreuztes übernehmen")}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 rounded-lg" onClick={() => setState({ kind: "idle" })} data-testid={`${testId}-dismiss`}>
              {tx("Скрыть", "Ausblenden")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
