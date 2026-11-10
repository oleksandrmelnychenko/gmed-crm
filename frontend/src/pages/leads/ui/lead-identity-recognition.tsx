import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, ScanText, ShieldAlert, ShieldCheck } from "lucide-react";

import { checkboxClass } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiRequestError } from "@/lib/api";
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

/** The scans tried in one run, newest first: the data page is among the last uploads. */
const MAX_SCANS_PER_RUN = 3;
const ATTEMPTED_KEY = "gmed.identity-recognition.attempted";

type RunState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; message: string }
  | { kind: "not_found" }
  | { kind: "result"; result: IdentityRecognition }
  | { kind: "applied" };

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

const better = (next: IdentityRecognition, best: IdentityRecognition | null) =>
  !best || (best.status === "not_found" && next.status !== "not_found") || (best.status !== "verified" && next.status === "verified");

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
 * itself. The reading starts by itself once, while the document fields are
 * still empty.
 */
export function LeadIdentityRecognition({
  scanIds,
  draft,
  onApply,
  holder,
  onApplyHolder,
  tx,
  lang,
  disabled = false,
  testId,
}: {
  /** The ids of this person's identity scans, oldest first. */
  scanIds: readonly string[];
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
  const scanKey = scanIds.join(",");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const ids = scanKey ? scanKey.split(",").reverse().slice(0, MAX_SCANS_PER_RUN) : [];
    if (ids.length === 0) return;
    const token = ++runRef.current;
    const current = () => mountedRef.current && runRef.current === token;
    setState({ kind: "running" });
    let best: IdentityRecognition | null = null;
    let failure: unknown = null;
    for (const id of ids) {
      try {
        const result = await recognizeIdentityDocument(id);
        if (!current()) return;
        if (result && better(result, best)) best = result;
        if (best?.status === "verified") break;
      } catch (error) {
        if (!current()) return;
        failure = error;
      }
    }
    if (!best || best.status === "not_found") {
      if (failure && !best) {
        const code = failure instanceof ApiRequestError ? failure.code ?? (failure.body as { code?: string } | null)?.code : null;
        setState({ kind: "error", message: recognitionErrorText(code, txRef.current) });
      } else {
        setState({ kind: "not_found" });
      }
      return;
    }
    setDocumentSelection(new Set(defaultRecognitionSelection(recognitionDocumentRows(best, draftRef.current, txRef.current, langRef.current))));
    // The person's data are never ticked by themselves: they are entered elsewhere.
    setHolderSelection(new Set());
    setState({ kind: "result", result: best });
  }, [scanKey]);

  // Once per set of scans, while nothing of the document is entered yet.
  const empty = !draft.type && !draft.number.trim() && !draft.country && !draft.validUntil && !draft.unreadable;
  useEffect(() => {
    if (!scanKey || disabled || !empty || attempted(scanKey)) return;
    rememberAttempt(scanKey);
    void run();
    // Only a new set of scans starts a reading; typing into the form does not.
  }, [scanKey, disabled]);

  const result = state.kind === "result" ? state.result : null;
  const documentRows = useMemo(() => (result ? recognitionDocumentRows(result, draft, tx, lang) : []), [result, draft, tx, lang]);
  const holderRows = useMemo(() => (result ? recognitionHolderRows(result, holder ?? {}, tx, lang) : []), [result, holder, tx, lang]);

  if (scanIds.length === 0) return null;

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
    if (Object.keys(documentPatch).length > 0) onApply(documentPatch);
    if (onApplyHolder && Object.keys(holderPatch).length > 0) onApplyHolder(holderPatch);
    setState({ kind: "applied" });
  };

  return (
    <div className="space-y-2" data-testid={testId} data-state={state.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-lg"
          disabled={disabled || state.kind === "running"}
          onClick={() => void run()}
          data-testid={`${testId}-run`}
        >
          {state.kind === "running" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <ScanText aria-hidden="true" className="size-3.5" />}
          {state.kind === "idle" ? tx("Распознать со скана", "Aus dem Scan lesen") : tx("Распознать ещё раз", "Erneut lesen")}
        </Button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {state.kind === "running"
            ? tx("Читаем машиночитаемую зону документа…", "Die maschinenlesbare Zone wird gelesen…")
            : state.kind === "applied"
              ? tx("Подставлено из скана. Проверьте поля и дополните «Кем выдан».", "Aus dem Scan übernommen. Bitte prüfen und die Behörde ergänzen.")
              : state.kind === "idle"
                ? tx("Заполняет поля из машиночитаемой зоны; ничего не сохраняется без вашего подтверждения.", "Füllt die Felder aus der maschinenlesbaren Zone; nichts wird ohne Ihre Bestätigung gespeichert.")
                : null}
        </span>
      </div>
      {state.kind === "error" ? (
        <p role="alert" className="text-xs font-medium text-destructive" data-testid={`${testId}-error`}>
          {state.message}
        </p>
      ) : null}
      {state.kind === "not_found" ? (
        <p role="status" className="text-xs font-medium text-amber-700 dark:text-amber-300" data-testid={`${testId}-not-found`}>
          {tx(
            "Машиночитаемая зона на скане не найдена. Введите данные вручную. Лучше всего читается ровный скан страницы с фото целиком, без бликов.",
            "Auf dem Scan wurde keine maschinenlesbare Zone gefunden. Bitte manuell eingeben. Am besten lesbar ist ein gerader Scan der ganzen Datenseite ohne Reflexionen.",
          )}
        </p>
      ) : null}
      {result ? (
        <div className="space-y-2.5 rounded-xl border border-border bg-muted/20 p-3" data-testid={`${testId}-proposal`} data-status={result.status}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{tx("Распознано со скана", "Aus dem Scan gelesen")}</span>
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
