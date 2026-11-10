import { useEffect, useRef, useState } from "react";
import { LoaderCircle, ScanText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { countryLabel } from "@/components/ui/country-select";
import { formatAppDate } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { normalizeIdentityRecognition, type IdentityRecognition } from "@/pages/leads/model/identity-recognition-result";

import type { StepContext, UploadControl } from "./payer-link-fields";
import type { IdDocumentType } from "./payer-link-model";
import { fieldLabel } from "./payer-link-text";

/** The scans tried in one run, newest first. */
const MAX_SCANS_PER_RUN = 3;

type DocumentField = "id_document_type" | "id_document_number" | "id_issuing_country" | "id_valid_until";
const FIELDS: readonly DocumentField[] = ["id_document_type", "id_document_number", "id_issuing_country", "id_valid_until"];

type Row = {
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

function rows(result: IdentityRecognition, context: StepContext): Row[] {
  const { form, text, lang } = context;
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
    if (field === "id_document_type") return text.idDocumentTypes[value as IdDocumentType] ?? value;
    if (field === "id_issuing_country") return countryLabel(value, lang) || value;
    if (field === "id_valid_until") return formatAppDate(value);
    return value;
  };
  const stored = (field: DocumentField) => {
    const value = String(form.draft[field] ?? "").trim();
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
      } satisfies Row,
    ];
  });
}

/**
 * «Read the data from the scan» under the payer's identity copies: the
 * server reads the machine readable zone of an uploaded copy and the values
 * show as a proposal. Nothing enters the form before «take over»; a field
 * that already holds another value is never ticked by itself, and nothing is
 * ticked when a check digit fails.
 */
export function PayerIdentityRecognition({ context, uploads }: { context: StepContext; uploads: UploadControl }) {
  const text = context.text.recognition;
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

  const recognize = uploads.recognize;
  if (!recognize || uploads.documents.length === 0) return null;

  const run = async () => {
    const token = ++runRef.current;
    const current = () => mountedRef.current && runRef.current === token;
    setState({ kind: "running" });
    let best: IdentityRecognition | null = null;
    let failed = false;
    for (const document of [...uploads.documents].reverse().slice(0, MAX_SCANS_PER_RUN)) {
      try {
        const result = normalizeIdentityRecognition(await recognize(document.id));
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
    setSelected(new Set(rows(best, context).filter((row) => row.state === "fill" && row.verified).map((row) => row.field)));
    setState({ kind: "result", result: best });
  };

  const proposal = state.kind === "result" ? rows(state.result, context) : [];
  const taken = proposal.filter((row) => row.state !== "same" && selected.has(row.field));
  const apply = () => {
    for (const row of taken) context.form.set(row.field, row.value);
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
    <div className="space-y-2" data-testid="payer-link-recognition" data-state={state.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={state.kind === "running" || uploads.busy} onClick={() => void run()} data-testid="payer-link-recognition-run">
          {state.kind === "running" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <ScanText aria-hidden="true" className="size-3.5" />}
          {state.kind === "idle" ? text.run : text.again}
        </Button>
        <span className="text-xs leading-5 text-muted-foreground" aria-live="polite">
          {state.kind === "running" ? text.running : state.kind === "applied" ? text.applied : state.kind === "idle" ? text.hint : null}
        </span>
      </div>
      {state.kind === "failed" ? (
        <p role="alert" className="text-xs font-medium text-destructive" data-testid="payer-link-recognition-failed">
          {text.failed}
        </p>
      ) : null}
      {state.kind === "not_found" ? (
        <p role="status" className="text-xs font-medium leading-5 text-amber-700 dark:text-amber-300" data-testid="payer-link-recognition-not-found">
          {text.notFound}
        </p>
      ) : null}
      {state.kind === "result" ? (
        <div className="space-y-2.5 rounded-xl border border-border bg-muted/20 p-3" data-testid="payer-link-recognition-proposal" data-status={state.result.status}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-foreground">{text.title}</span>
            {state.result.status === "verified" ? <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{text.verified}</span> : null}
          </div>
          {state.result.status === "unverified" ? (
            <p role="alert" className="text-xs font-medium leading-5 text-amber-700 dark:text-amber-300" data-testid="payer-link-recognition-unverified">
              {text.unverified}
            </p>
          ) : null}
          <ul className="space-y-1">
            {proposal.map((row) => (
              <li key={row.field} data-testid={`payer-link-recognition-${row.field}`} data-state={row.state}>
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
                  <span className="text-muted-foreground">{fieldLabel(context.text, row.field, context.payerType)}:</span>
                  <span className="font-medium text-foreground [overflow-wrap:anywhere]">{row.shown}</span>
                  {row.state === "same" ? (
                    <span className="text-xs text-emerald-700 dark:text-emerald-300">{text.same}</span>
                  ) : row.state === "differs" ? (
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      {text.current}: {row.current}
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-5 text-muted-foreground">{text.authorityHint}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={taken.length === 0} onClick={apply} data-testid="payer-link-recognition-apply">
              {text.apply}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setState({ kind: "idle" })} data-testid="payer-link-recognition-dismiss">
              {text.dismiss}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
