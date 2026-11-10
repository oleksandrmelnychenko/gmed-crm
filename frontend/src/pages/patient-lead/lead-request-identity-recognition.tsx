import { useEffect, useRef, useState } from "react";
import { LoaderCircle, ScanText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { countryLabel } from "@/components/ui/country-select";
import { formatAppDate } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { normalizeIdentityRecognition, type IdentityRecognition } from "@/pages/leads/model/identity-recognition-result";

import { recognizeLeadIdentityDocument, type LeadRequestDocument } from "./lead-request-api";
import { identificationFieldLabel, type LeadRequestText } from "./lead-request-text";

/** The copies tried in one run, newest first. */
const MAX_SCANS_PER_RUN = 3;

export type RecognitionDocumentField = "id_document_type" | "id_document_number" | "id_issuing_country" | "id_valid_until";
type DocumentField = RecognitionDocumentField;
const FIELDS: readonly DocumentField[] = ["id_document_type", "id_document_number", "id_issuing_country", "id_valid_until"];

export type RecognitionRow = {
  field: DocumentField;
  value: string;
  shown: string;
  current: string;
  state: "fill" | "same" | "differs";
  verified: boolean;
};

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "failed" }
  | { kind: "not_found" }
  | { kind: "result"; result: IdentityRecognition }
  | { kind: "applied" };

const normalNumber = (value: string) => value.trim().split(/\s+/).filter(Boolean).join(" ").toUpperCase();

/** What was read, next to what the form holds. A field the zone leaves open has no row. */
export function recognitionRows(
  result: IdentityRecognition,
  draft: Readonly<Record<DocumentField, string>>,
  text: LeadRequestText,
  lang: string,
): RecognitionRow[] {
  const all = result.status === "verified";
  const read: Record<DocumentField, string> = {
    id_document_type: result.document.type,
    id_document_number: result.document.number,
    id_issuing_country: result.document.country,
    id_valid_until: result.document.validUntil,
  };
  const verified: Record<DocumentField, boolean> = {
    id_document_type: all,
    id_issuing_country: all,
    id_document_number: result.checks.document_number,
    id_valid_until: result.checks.valid_until,
  };
  const show = (field: DocumentField, value: string) => {
    if (!value) return "";
    if (field === "id_document_type") return (text.idDocumentTypeOptions as Record<string, string>)[value] ?? value;
    if (field === "id_issuing_country") return countryLabel(value, lang) || value;
    if (field === "id_valid_until") return formatAppDate(value);
    return value;
  };
  const stored = (field: DocumentField) => {
    const value = String(draft[field] ?? "").trim();
    if (field === "id_document_number") return normalNumber(value);
    if (field === "id_issuing_country") return value.toUpperCase();
    if (field === "id_valid_until") return value.slice(0, 10);
    return value;
  };
  return FIELDS.flatMap((field) => {
    const value = read[field];
    if (!value) return [];
    const current = stored(field);
    return [
      {
        field,
        value,
        shown: show(field, value),
        current: show(field, current),
        state: !current ? "fill" : current === value ? "same" : "differs",
        verified: verified[field],
      } satisfies RecognitionRow,
    ];
  });
}

/** Ticked by itself: only an empty field, and only a value whose check digit holds. */
export function defaultRecognitionSelection(rows: readonly RecognitionRow[]): DocumentField[] {
  return rows.filter((row) => row.state === "fill" && row.verified).map((row) => row.field);
}

/**
 * «Read the data from the scan» between a copy of an identity document (the
 * lead's own or a representative's) and the document's fields: the server reads the machine readable zone of an uploaded copy and
 * the values show as a proposal. Nothing enters the form before «take over»;
 * a field that already holds another value is never ticked by itself, and
 * nothing is ticked when a check digit fails. The form's own autosave stores
 * what the person took over.
 */
export function LeadRequestIdentityRecognition({
  leadId,
  documents,
  draft,
  onTake,
  text,
  lang,
  disabled = false,
  testId = "lead-request-recognition",
}: {
  leadId: string;
  /** The copies of this person's document. */
  documents: readonly LeadRequestDocument[];
  /** What the form holds now. */
  draft: Readonly<Record<RecognitionDocumentField, string>>;
  onTake: (field: RecognitionDocumentField, value: string) => void;
  text: LeadRequestText;
  lang: string;
  disabled?: boolean;
  testId?: string;
}) {
  const words = text.recognition;
  const [state, setState] = useState<State>({ kind: "idle" });
  const [selected, setSelected] = useState<ReadonlySet<DocumentField>>(() => new Set());
  const runRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (documents.length === 0) return null;

  const run = async () => {
    const token = ++runRef.current;
    const current = () => mountedRef.current && runRef.current === token;
    setState({ kind: "running" });
    let best: IdentityRecognition | null = null;
    let failed = false;
    const newestFirst = [...documents].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
    for (const document of newestFirst.slice(0, MAX_SCANS_PER_RUN)) {
      try {
        const result = normalizeIdentityRecognition(await recognizeLeadIdentityDocument(leadId, document.id));
        if (!current()) return;
        if (result && result.status !== "not_found" && (!best || result.status === "verified")) best = result;
        if (best?.status === "verified") break;
      } catch {
        if (!current()) return;
        failed = true;
      }
    }
    if (!best) {
      setState({ kind: failed ? "failed" : "not_found" });
      return;
    }
    setSelected(new Set(defaultRecognitionSelection(recognitionRows(best, draft, text, lang))));
    setState({ kind: "result", result: best });
  };

  const proposal = state.kind === "result" ? recognitionRows(state.result, draft, text, lang) : [];
  const taken = proposal.filter((row) => row.state !== "same" && selected.has(row.field));
  const apply = () => {
    for (const row of taken) onTake(row.field, row.value);
    setState({ kind: "applied" });
  };
  const toggle = (field: DocumentField) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  return (
    <div className="space-y-2" data-testid={testId} data-state={state.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-auto min-h-8 whitespace-normal py-1.5 text-left"
          disabled={disabled || state.kind === "running"}
          onClick={() => void run()}
          data-testid={`${testId}-run`}
        >
          {state.kind === "running" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <ScanText aria-hidden="true" className="size-3.5" />}
          {state.kind === "idle" ? words.run : words.again}
        </Button>
        <span className="text-xs leading-5 text-muted-foreground" aria-live="polite">
          {state.kind === "running" ? words.running : state.kind === "applied" ? words.applied : state.kind === "idle" ? words.hint : null}
        </span>
      </div>
      {state.kind === "failed" ? (
        <p role="alert" className="text-xs font-medium text-destructive" data-testid={`${testId}-failed`}>
          {words.failed}
        </p>
      ) : null}
      {state.kind === "not_found" ? (
        <p role="status" className="text-xs font-medium leading-5 text-amber-700 dark:text-amber-300" data-testid={`${testId}-not-found`}>
          {words.notFound}
        </p>
      ) : null}
      {state.kind === "result" ? (
        <div className="space-y-2.5 rounded-xl border border-border bg-muted/20 p-3" data-testid={`${testId}-proposal`} data-status={state.result.status}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-foreground">{words.title}</span>
            {state.result.status === "verified" ? <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{words.verified}</span> : null}
          </div>
          {state.result.status === "unverified" ? (
            <p role="alert" className="text-xs font-medium leading-5 text-amber-700 dark:text-amber-300" data-testid={`${testId}-unverified`}>
              {words.unverified}
            </p>
          ) : null}
          <ul className="space-y-1">
            {proposal.map((row) => (
              <li key={row.field} data-testid={`${testId}-${row.field}`} data-state={row.state}>
                <label className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm", row.state !== "same" && "cursor-pointer")}>
                  {row.state !== "same" ? (
                    <input
                      type="checkbox"
                      className="size-4 translate-y-0.5 rounded border-border accent-[var(--brand)]"
                      checked={selected.has(row.field)}
                      onChange={() => toggle(row.field)}
                    />
                  ) : (
                    <span aria-hidden="true" className="inline-block w-4" />
                  )}
                  <span className="text-muted-foreground">{identificationFieldLabel(text, row.field)}:</span>
                  <span className="font-medium text-foreground [overflow-wrap:anywhere]">{row.shown}</span>
                  {row.state === "same" ? (
                    <span className="text-xs text-emerald-700 dark:text-emerald-300">{words.same}</span>
                  ) : row.state === "differs" ? (
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      {words.current}: {row.current}
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-5 text-muted-foreground">{words.authorityHint}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={taken.length === 0} onClick={apply} data-testid={`${testId}-apply`}>
              {words.apply}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setState({ kind: "idle" })} data-testid={`${testId}-dismiss`}>
              {words.dismiss}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
