import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { checkboxClass, textareaClass, tokens } from "@/components/record-workspace/primitives/design-tokens";
import { cn } from "@/lib/utils";

import {
  INQUIRY_CONSENT,
  PAYER_NOT_SELF,
  fetchMyLeadRequests,
  saveLeadSelfFunds,
  uploadLeadFundsProof,
  withdrawLeadDocument,
  type LeadRequest,
  type LeadRequestSelfFunds,
} from "./lead-request-api";
import { MAX_UPLOAD_BYTES, consentGiven, type SaveState } from "./lead-request-model";
import {
  LabeledField,
  RequiredMark,
  UploadedFileList,
  errorBody,
  errorMessage,
  useAutosave,
  type RequestQueue,
} from "./lead-request-parts";
import {
  draftFromSelfFunds,
  selfFundsDescriptionRequired,
  selfFundsFieldOf,
  selfFundsPatch,
  selfFundsSourceOptions,
  selfFundsValue,
  withSelfFundsSource,
  type SelfFundsDraft,
} from "./lead-request-self-funds-model";
import type { LeadRequestText } from "./lead-request-text";

type Refused = Partial<Record<keyof SelfFundsDraft, string>>;

/**
 * "Where does the money come from" when the patient pays himself (owner
 * request 2026-10-05, "proof of income"), a part of "who pays": the sources
 * of the person list, a description (required with "other") and the proof —
 * a bank statement, a payslip —, which is required only while the enhanced
 * check of the money laundering act is (owner rule 2026-10-07; the reasons
 * are never shown). The answers autosave on their own route (only what
 * changed); the proof needs the consent to process the request data, like
 * the copy of the identity document.
 */
export function SelfFundsBlock({
  request,
  selfFunds,
  text,
  lang,
  enqueue,
  onChange,
  onSaveState,
  className,
}: {
  request: LeadRequest;
  selfFunds: LeadRequestSelfFunds;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
  className?: string;
}) {
  const leadId = request.lead_id;
  const [draft, setDraft] = useState<SelfFundsDraft>(() => draftFromSelfFunds(selfFunds));
  const savedRef = useRef<SelfFundsDraft>(draftFromSelfFunds(selfFunds));
  const refusedRef = useRef<Refused>({});
  const [refused, setRefused] = useState<Refused>({});
  const failedRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const consentReady = consentGiven(request, INQUIRY_CONSENT);
  const proofRequired = selfFunds.proof_required;

  // Another save changed the answers on the server (staff, another tab):
  // the draft takes them over where the patient is not typing something else.
  useEffect(() => {
    const incoming = draftFromSelfFunds(selfFunds);
    const saved = savedRef.current;
    const sourcesChanged = selfFundsValue("sources", incoming) !== selfFundsValue("sources", saved);
    const descriptionChanged = selfFundsValue("description", incoming) !== selfFundsValue("description", saved);
    if (!sourcesChanged && !descriptionChanged) return;
    savedRef.current = incoming;
    setDraft((current) => ({
      sources: sourcesChanged ? incoming.sources : current.sources,
      description: descriptionChanged ? incoming.description : current.description,
    }));
  }, [selfFunds]);

  const save = useCallback(
    (snapshot: SelfFundsDraft) => {
      void enqueue(async () => {
        const stillRefused: Refused = {};
        for (const field of ["sources", "description"] as const) {
          if (refusedRef.current[field] !== undefined && refusedRef.current[field] === selfFundsValue(field, snapshot)) {
            stillRefused[field] = refusedRef.current[field];
          }
        }
        refusedRef.current = stillRefused;
        const patch = selfFundsPatch(savedRef.current, snapshot, stillRefused);
        if (Object.keys(patch).length === 0) {
          // A refused value the patient took back is no error any more.
          if (failedRef.current && Object.keys(stillRefused).length === 0) {
            failedRef.current = false;
            setRefused({});
            onSaveState("saved");
          }
          return;
        }
        onSaveState("saving");
        try {
          const next = await saveLeadSelfFunds(leadId, patch);
          savedRef.current = draftFromSelfFunds(next.self_funds);
          failedRef.current = Object.keys(stillRefused).length > 0;
          setRefused(stillRefused);
          onSaveState(failedRef.current ? "error" : "saved");
          onChange(next);
        } catch (cause) {
          failedRef.current = true;
          const body = errorBody(cause);
          if (body?.code === PAYER_NOT_SELF) {
            // Somebody else pays now: the request is loaded afresh and the block goes.
            try {
              const fresh = (await fetchMyLeadRequests()).find((item) => item.lead_id === leadId);
              if (fresh) onChange(fresh);
            } catch {
              // The next load of the page shows the state.
            }
            onSaveState("error");
            return;
          }
          const field = selfFundsFieldOf(body?.field);
          if (field) {
            refusedRef.current = { ...stillRefused, [field]: selfFundsValue(field, snapshot) };
            setRefused(refusedRef.current);
          }
          onSaveState("error");
        }
      });
    },
    [enqueue, leadId, onChange, onSaveState],
  );

  useAutosave(draft, save);

  const errorFor = (field: keyof SelfFundsDraft) => {
    const value = refused[field];
    return value !== undefined && value === selfFundsValue(field, draft) ? text.invalidField : undefined;
  };

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    const nextErrors: string[] = [];
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        nextErrors.push(text.fileTooLarge(file.name));
        continue;
      }
      try {
        onChange(await enqueue(() => uploadLeadFundsProof(leadId, file)));
      } catch (cause) {
        nextErrors.push(
          errorBody(cause)?.code === "inquiry_consent_required"
            ? text.identityUploadNeedsConsent
            : `${file.name}: ${errorMessage(cause)}`,
        );
      }
    }
    setErrors(Array.from(new Set(nextErrors)));
    setUploading(false);
  }

  async function remove(documentId: string) {
    setErrors([]);
    try {
      onChange(await enqueue(() => withdrawLeadDocument(leadId, documentId)));
    } catch (cause) {
      setErrors([errorMessage(cause)]);
    }
  }

  const sourcesError = errorFor("sources");
  const descriptionError = errorFor("description");
  const sourcesId = "lead-request-self_funds_sources";
  const descriptionId = "lead-request-self_funds_description";

  return (
    <div
      // A grid item: without `min-w-0` a long file name (one line, truncated) would widen the column on a phone.
      className={cn("min-w-0 space-y-3 rounded-lg border border-border bg-muted/10 px-3 py-3", className)}
      data-testid="lead-request-self-funds"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">{text.selfFundsTitle}</p>
        <p className="text-xs leading-5 text-muted-foreground">{text.selfFundsIntro}</p>
      </div>
      <div
        role="group"
        aria-labelledby={`${sourcesId}-label`}
        aria-invalid={Boolean(sourcesError) || undefined}
        aria-describedby={sourcesError ? `${sourcesId}-error` : undefined}
        data-testid="lead-request-self-funds-sources"
      >
        <p id={`${sourcesId}-label`} className={tokens.text.label}>
          {text.payerQuestionnaireFields.funds_sources}
          <RequiredMark />
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {selfFundsSourceOptions(selfFunds).map((source) => (
            <label key={source} className="inline-flex items-start gap-2 text-sm leading-snug">
              <input
                type="checkbox"
                className={cn(checkboxClass, "mt-0.5")}
                checked={draft.sources.includes(source)}
                onChange={(event) => {
                  const chosen = event.target.checked;
                  setDraft((current) => withSelfFundsSource(current, source, chosen));
                }}
              />
              {text.fundsSourceOptions[source]}
            </label>
          ))}
        </div>
        {sourcesError ? (
          <p id={`${sourcesId}-error`} role="alert" className="mt-1 text-xs text-destructive">
            {sourcesError}
          </p>
        ) : null}
      </div>
      <LabeledField
        id={descriptionId}
        label={text.payerQuestionnaireFields.funds_description}
        error={descriptionError}
        required={selfFundsDescriptionRequired(draft)}
      >
        <textarea
          id={descriptionId}
          // 16 px on phones: a smaller text makes iOS zoom into the field.
          className={cn(textareaClass, "text-base md:text-sm")}
          rows={3}
          maxLength={2000}
          autoComplete="off"
          aria-invalid={Boolean(descriptionError) || undefined}
          aria-describedby={descriptionError ? `${descriptionId}-error` : undefined}
          value={draft.description}
          onChange={(event) => {
            const description = event.target.value;
            setDraft((current) => ({ ...current, description }));
          }}
        />
      </LabeledField>
      <div
        className="space-y-2"
        data-testid="lead-request-self-funds-proof"
        data-required={proofRequired ? "true" : "false"}
      >
        <p className={tokens.text.label}>
          {text.selfFundsProofTitle}
          {" · "}
          <span className={proofRequired ? "text-destructive" : undefined} data-testid="lead-request-self-funds-proof-need">
            {proofRequired ? text.payerFundsProofRequired : text.payerFundsProofOptional}
          </span>
        </p>
        {proofRequired ? (
          <p
            role="note"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-snug text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {text.payerFundsProofRequiredNote}
          </p>
        ) : null}
        <input
          ref={fileInput}
          id="lead-request-self-funds-proof-files"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          className="sr-only"
          disabled={!consentReady || uploading}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void uploadFiles(files);
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-8 w-full gap-2 whitespace-normal py-1.5 text-left sm:w-auto"
          disabled={!consentReady || uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Upload aria-hidden="true" className="size-4" />}
          {uploading ? text.uploading : text.payerFundsProofUpload}
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          {consentReady ? text.selfFundsProofHint : text.identityUploadNeedsConsent}
        </p>
        {errors.map((message) => (
          <p key={message} role="alert" className="text-xs text-destructive">
            {message}
          </p>
        ))}
        <UploadedFileList
          documents={selfFunds.proof_documents}
          text={text}
          lang={lang}
          emptyText={text.noPayerFundsProof}
          testId="lead-request-self-funds-proof-list"
          onRemove={(documentId) => void remove(documentId)}
        />
      </div>
    </div>
  );
}
