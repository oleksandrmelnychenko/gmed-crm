import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CircleCheck, LoaderCircle, Send } from "lucide-react";

import { Banner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inputClass, selectClass, textareaClass } from "@/components/record-workspace/primitives/design-tokens";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  FOLLOW_UP_INCOMPLETE,
  INQUIRY_CONSENT,
  PAYER_NOT_SELF,
  PAYER_NOT_THIRD_PARTY,
  fetchMyLeadRequests,
  saveLeadEnhancedDetails,
  submitLeadFollowUp,
  uploadLeadFundsProof,
  uploadLeadRelationshipProof,
  withdrawLeadDocument,
  type ExtraAnswers,
  type FollowUpBlock,
  type LeadRequest,
} from "./lead-request-api";
import { BillingSections } from "./lead-request-billing";
import {
  askedExtraFields,
  blockAAsks,
  draftFromExtra,
  extraFieldOf,
  extraPatch,
  extraValue,
  familyPayer,
  followUpAnswered,
  followUpMissing,
  fundsSourceOptions,
  missingOfRefusal,
  openFollowUpBlocks,
  type ExtraDraft,
  type ExtraSourceField,
  type ExtraTextField,
} from "./lead-request-follow-up-model";
import {
  IdentificationChoiceSelect,
  IdentificationCountriesSelect,
  IdentificationCountrySelect,
  IdentificationFormField,
  IdentificationTextArea,
  IdentificationTextInput,
  IdentityDocumentSection,
  LegalQuestionsSection,
  useIdentificationForm,
  type IdentificationForm,
} from "./lead-request-identification";
import { SANCTIONS_LINK_KINDS, STAY_REASONS, combinedSaveState, consentGiven, type SaveState } from "./lead-request-model";
import {
  CabinetSection as Section,
  FileUploadField,
  LabeledField,
  MissingList,
  MissingShownContext,
  SaveIndicator,
  StepFooter,
  errorBody,
  errorMessage,
  useAutosave,
  type RequestQueue,
} from "./lead-request-parts";
import { PayerSection } from "./lead-request-payer-section";
import { RepresentationSection } from "./lead-request-representation";
import { followUpFieldLabel, type LeadRequestText } from "./lead-request-text";

// Step "Ergänzende Angaben" (trigger flow 2026-10-07, contract 3 and 6): the
// follow-up blocks the server opened, each a sub-section of its own, under
// one neutral heading. The cabinet never learns why a block is asked and
// never says so (P2). The answers autosave like the rest of the form; "send"
// tells GMED they are complete.

type Part = "identification" | "funds" | "billing" | "representation" | "payer";

const FULL_ROW = "sm:col-span-2 lg:col-span-3";

export function FollowUpStep({
  request,
  text,
  lang,
  enqueue,
  onChange,
  onBack,
  onNext,
  missingShown: showMissing,
  onShowMissing,
  index,
  total,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onBack: () => void;
  onNext: () => void;
  /** Whether "next" or "send" of this step was pressed: the page keeps it for the step bar. */
  missingShown: boolean;
  onShowMissing: () => void;
  index: number;
  total: number;
}) {
  const guardian = request.access_kind === "guardian";
  // A lead who corrected "yes" to "no" has nothing to detail (QA 2026-10-10): the
  // server stops asking H / J then, the details block goes too.
  const legal = request.identification;
  const blocks = openFollowUpBlocks(request).filter(
    (block) =>
      !(block === "H" && legal?.pep_self === false && legal?.pep_related === false) &&
      !(block === "J" && legal?.sanctions_links === false),
  );
  const [states, setStates] = useState<Record<Part, SaveState>>({
    identification: "idle",
    funds: "idle",
    billing: "idle",
    representation: "idle",
    payer: "idle",
  });
  const setPart = useCallback((part: Part, state: SaveState) => {
    setStates((current) => (current[part] === state ? current : { ...current, [part]: state }));
  }, []);
  const onIdentificationState = useCallback((state: SaveState) => setPart("identification", state), [setPart]);
  const onFundsState = useCallback((state: SaveState) => setPart("funds", state), [setPart]);
  const onBillingState = useCallback((state: SaveState) => setPart("billing", state), [setPart]);
  const onRepresentationState = useCallback((state: SaveState) => setPart("representation", state), [setPart]);
  const onPayerState = useCallback((state: SaveState) => setPart("payer", state), [setPart]);
  // F, B, H and J are statements of the identification: one record, one autosave.
  const identification = useIdentificationForm({ request, text, enqueue, onChange, onSaveState: onIdentificationState });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const answered = followUpAnswered(request);
  const answeredAt = request.follow_up?.answered_at ?? null;

  async function send() {
    // A send also shows what is still missing.
    onShowMissing();
    setSending(true);
    setError("");
    try {
      onChange(await enqueue(() => submitLeadFollowUp(request.lead_id)));
    } catch (cause) {
      const body = errorBody(cause);
      const missing = body?.code === FOLLOW_UP_INCOMPLETE ? missingOfRefusal(body) : null;
      if (missing && request.follow_up) {
        // The server names what is still open: each block shows it.
        onChange({ ...request, follow_up: { ...request.follow_up, missing } });
        setError(text.followUpIncomplete);
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setSending(false);
    }
  }

  const blockContent = (block: FollowUpBlock): ReactNode => {
    switch (block) {
      case "A":
        return <FundsBlock request={request} text={text} lang={lang} enqueue={enqueue} onChange={onChange} onSaveState={onFundsState} />;
      case "B":
        return <RelationshipBlock request={request} form={identification} text={text} lang={lang} enqueue={enqueue} onChange={onChange} />;
      case "C":
        return request.billing ? (
          <BillingSections
            request={request}
            billing={request.billing}
            text={text}
            lang={lang}
            enqueue={enqueue}
            onChange={onChange}
            onSaveState={onBillingState}
            part="route"
            bare
          />
        ) : null;
      case "F":
        return <ResidenceBlock form={identification} text={text} lang={lang} guardian={guardian} />;
      case "G":
        return request.representation ? (
          <RepresentationSection
            request={request}
            text={text}
            lang={lang}
            enqueue={enqueue}
            onChange={onChange}
            onSaveState={onRepresentationState}
            mode="follow_up"
          />
        ) : null;
      case "H":
        return <OfficeBlock form={identification} text={text} lang={lang} relatedAsked={request.identification?.pep_related === true} />;
      case "I":
        return (
          <IdentityDocumentSection
            request={request}
            text={text}
            lang={lang}
            enqueue={enqueue}
            onChange={onChange}
            bare
          />
        );
      case "J":
        return <SanctionsLinkBlock form={identification} text={text} />;
      case "K":
        return <BirthBlock form={identification} text={text} lang={lang} guardian={guardian} />;
      case "L":
        return (
          <div className="space-y-5">
            <LegalQuestionsSection form={identification} text={text} guardian={guardian} bare />
            {request.payer ? (
              <PayerSection
                request={request}
                text={text}
                lang={lang}
                identification={identification}
                enqueue={enqueue}
                onChange={onChange}
                onSaveState={onPayerState}
                ownAccountOnly
              />
            ) : null}
          </div>
        );
    }
  };

  return (
    <section className="space-y-6" data-testid="lead-request-follow-up">
      {answered && answeredAt ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
          data-testid="lead-request-follow-up-answered"
        >
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{text.followUpAnsweredAt(formatAppDateTime(answeredAt))}</span>
        </p>
      ) : null}

      {blocks.map((block) => (
        <div key={block} data-testid={`lead-request-follow-up-${block}`}>
          <Section title={text.followUpBlocks[block]}>
            {showMissing ? (
              <MissingList
                title={text.stepMissingTitle}
                labels={followUpMissing(request, block).map((key) => followUpFieldLabel(text, key, guardian))}
                testId={`lead-request-follow-up-${block}-missing`}
              />
            ) : null}
            <MissingShownContext.Provider value={showMissing}>{blockContent(block)}</MissingShownContext.Provider>
          </Section>
        </div>
      ))}

      {error ? <Banner tone="error">{error}</Banner> : null}

      <StepFooter
        index={index}
        total={total}
        text={text}
        status={<SaveIndicator state={combinedSaveState(Object.values(states))} text={text} />}
      >
        <Button type="button" variant="outline" className="h-9" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {text.back}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => {
              // What is missing shows only after "Next" (or "Send"): the first press shows it.
              if (blocks.some((block) => followUpMissing(request, block).length > 0) && !showMissing) {
                onShowMissing();
                return;
              }
              onNext();
            }}
          >
            {text.next}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            type="button"
            className="h-9 gap-2"
            disabled={sending}
            onClick={() => void send()}
            data-testid="lead-request-follow-up-submit"
          >
            {sending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Send aria-hidden="true" className="size-3.5" />}
            {sending ? text.followUpSending : text.followUpSubmit}
          </Button>
        </div>
      </StepFooter>
    </section>
  );
}

type Refused = Partial<Record<keyof ExtraAnswers, string>>;

/**
 * Block A, the source of funds: the self-payer's own sources (several of the
 * person list), their words, profession, sector and the proofs; or what the
 * patient knows of a third party's funds. Saved through `…/enhanced-details`,
 * only what changed; the proofs need the consent to process the request data.
 */
function FundsBlock({
  request,
  text,
  lang,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}) {
  const leadId = request.lead_id;
  const extra = request.follow_up;
  const asks = blockAAsks(request);
  const asksKey = JSON.stringify(asks);
  const asked = useMemo(() => askedExtraFields(JSON.parse(asksKey) as typeof asks), [asksKey]);
  const [draft, setDraft] = useState<ExtraDraft>(() => draftFromExtra(extra));
  const savedRef = useRef<ExtraDraft>(draftFromExtra(extra));
  const refusedRef = useRef<Refused>({});
  const [refused, setRefused] = useState<Refused>({});
  const consentReady = consentGiven(request, INQUIRY_CONSENT);

  // Another save changed the answers on the server: the draft takes them over
  // where the patient is not typing something else.
  useEffect(() => {
    const incoming = draftFromExtra(extra);
    const saved = savedRef.current;
    const changed = (Object.keys(incoming) as Array<keyof ExtraDraft>).filter(
      (field) => extraValue(field, incoming) !== extraValue(field, saved),
    );
    if (changed.length === 0) return;
    savedRef.current = incoming;
    setDraft((current) => {
      const next = { ...current };
      for (const field of changed) (next as Record<string, unknown>)[field] = incoming[field];
      return next;
    });
  }, [extra]);

  const save = useCallback(
    (snapshot: ExtraDraft) => {
      void enqueue(async () => {
        const stillRefused: Refused = {};
        for (const [field, value] of Object.entries(refusedRef.current) as Array<[keyof ExtraDraft, string]>) {
          if (value === extraValue(field, snapshot)) stillRefused[field] = value;
        }
        refusedRef.current = stillRefused;
        const patch = extraPatch(savedRef.current, snapshot, asked, stillRefused);
        if (Object.keys(patch).length === 0) return;
        onSaveState("saving");
        try {
          const next = await saveLeadEnhancedDetails(leadId, patch);
          savedRef.current = draftFromExtra(next.follow_up);
          setRefused(stillRefused);
          onSaveState(Object.keys(stillRefused).length > 0 ? "error" : "saved");
          onChange(next);
        } catch (cause) {
          const body = errorBody(cause);
          if (body?.code === PAYER_NOT_SELF || body?.code === PAYER_NOT_THIRD_PARTY) {
            // Who pays changed meanwhile: the request is loaded afresh.
            try {
              const fresh = (await fetchMyLeadRequests()).find((item) => item.lead_id === leadId);
              if (fresh) onChange(fresh);
            } catch {
              // The next load of the page shows the state.
            }
          }
          const field = extraFieldOf(body?.field);
          if (field) {
            refusedRef.current = { ...stillRefused, [field]: extraValue(field, snapshot) };
            setRefused(refusedRef.current);
          }
          onSaveState("error");
        }
      });
    },
    [asked, enqueue, leadId, onChange, onSaveState],
  );

  useAutosave(draft, save);

  const errorFor = (field: keyof ExtraDraft) =>
    refused[field] !== undefined && refused[field] === extraValue(field, draft) ? text.invalidField : undefined;
  const controlId = (field: keyof ExtraDraft) => `lead-request-${field}`;
  const control = (field: keyof ExtraDraft) => ({
    id: controlId(field),
    "aria-invalid": Boolean(errorFor(field)) || undefined,
    "aria-describedby": errorFor(field) ? `${controlId(field)}-error` : undefined,
  });
  const options = fundsSourceOptions(extra);

  const sources = (field: ExtraSourceField) => (
    <LabeledField id={controlId(field)} label={text.extraFields[field]} error={errorFor(field)} required>
      <NativeComboboxSelect
        {...control(field)}
        className={selectClass}
        value={draft[field]}
        onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
      >
        <option value="">{text.choose}</option>
        {options.map((source) => (
          <option key={source} value={source}>
            {text.statedFundsSourceOptions[source]}
          </option>
        ))}
      </NativeComboboxSelect>
    </LabeledField>
  );
  const description = (field: "funds_description" | "payer_funds_description") => (
    <LabeledField id={controlId(field)} label={text.extraFields[field]} error={errorFor(field)} required className={FULL_ROW}>
      <textarea
        {...control(field)}
        // 16 px on phones: a smaller text makes iOS zoom into the field.
        className={cn(textareaClass, "text-base md:text-sm")}
        rows={3}
        maxLength={2000}
        autoComplete="off"
        value={draft[field]}
        onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
      />
    </LabeledField>
  );
  const textField = (field: Extract<ExtraTextField, "occupation" | "sector">) => (
    <LabeledField id={controlId(field)} label={text.extraFields[field]} error={errorFor(field)} required>
      <Input
        {...control(field)}
        className={inputClass}
        autoComplete="off"
        maxLength={200}
        value={draft[field]}
        onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
      />
    </LabeledField>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {asks.payer_funds ? (
          <>
            {sources("payer_funds_source")}
            {description("payer_funds_description")}
          </>
        ) : null}
        {asks.funds ? (
          <>
            {sources("funds_source")}
            {description("funds_description")}
          </>
        ) : null}
        {asks.occupation ? textField("occupation") : null}
        {asks.sector ? textField("sector") : null}
        {asks.sector && !asks.occupation && request.payer_questionnaire ? (
          <p className={cn("text-xs leading-5 text-muted-foreground", FULL_ROW)}>{text.extraOccupationElsewhere}</p>
        ) : null}
        {asks.payer_states_funds ? (
          <p
            role="note"
            className={cn("rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm leading-5 text-muted-foreground", FULL_ROW)}
            data-testid="lead-request-follow-up-payer-note"
          >
            {text.extraPayerStatesFunds}
          </p>
        ) : null}
      </div>
      {asks.funds_proof ? (
        <FileUploadField
          id="lead-request-funds-proof"
          label={text.extraFields.funds_proof}
          required
          hint={text.selfFundsProofHint}
          emptyText={text.noPayerFundsProof}
          buttonLabel={text.payerFundsProofUpload}
          documents={extra?.funds_proof_documents ?? []}
          consentReady={consentReady}
          text={text}
          lang={lang}
          upload={async (file) => onChange(await enqueue(() => uploadLeadFundsProof(leadId, file)))}
          remove={async (documentId) => onChange(await enqueue(() => withdrawLeadDocument(leadId, documentId)))}
          testId="lead-request-funds-proof"
        />
      ) : null}
    </div>
  );
}

/** Block B: why the payer pays, since when the two know each other, and a proof of the relationship. */
function RelationshipBlock({
  request,
  form,
  text,
  lang,
  enqueue,
  onChange,
}: {
  request: LeadRequest;
  form: IdentificationForm;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
}) {
  const leadId = request.lead_id;
  return (
    <div className="space-y-4">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <IdentificationFormField form={form} field="payment_background" text={text} required className={FULL_ROW}>
          <IdentificationTextArea form={form} field="payment_background" />
        </IdentificationFormField>
        <IdentificationFormField form={form} field="relationship_since" text={text} required>
          <IdentificationTextInput form={form} field="relationship_since" maxLength={100} />
        </IdentificationFormField>
      </div>
      {request.follow_up?.relationship_proof_documents !== undefined ? (
        <FileUploadField
          id="lead-request-relationship-proof"
          label={text.relationshipProofTitle}
          required
          // A certificate fits family only; a friend or an employer shows the relationship otherwise (QA 2026-10-10).
          hint={familyPayer(request) ? text.relationshipProofHint : text.relationshipProofHintOther}
          emptyText={text.noRelationshipProof}
          buttonLabel={text.uploadButton}
          documents={request.follow_up.relationship_proof_documents}
          consentReady={consentGiven(request, INQUIRY_CONSENT)}
          text={text}
          lang={lang}
          upload={async (file) => onChange(await enqueue(() => uploadLeadRelationshipProof(leadId, file)))}
          remove={async (documentId) => onChange(await enqueue(() => withdrawLeadDocument(leadId, documentId)))}
          testId="lead-request-relationship-proof"
        />
      ) : null}
    </div>
  );
}

/** Block K: birth name, place and country of birth (only with the enhanced check). */
function BirthBlock({
  form,
  text,
  lang,
  guardian,
}: {
  form: IdentificationForm;
  text: LeadRequestText;
  lang: string;
  guardian: boolean;
}) {
  return (
    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      <IdentificationFormField form={form} field="former_names" text={text} guardian={guardian}>
        <IdentificationTextInput form={form} field="former_names" maxLength={200} />
      </IdentificationFormField>
      <IdentificationFormField form={form} field="birth_place" text={text} guardian={guardian} required>
        <IdentificationTextInput form={form} field="birth_place" maxLength={200} />
      </IdentificationFormField>
      <IdentificationFormField form={form} field="birth_country" text={text} guardian={guardian} required>
        <IdentificationCountrySelect form={form} field="birth_country" text={text} lang={lang} guardian={guardian} />
      </IdentificationFormField>
    </div>
  );
}

/** Block F: since when the patient lives in the country, other residences, former citizenships, why there. */
function ResidenceBlock({
  form,
  text,
  lang,
  guardian,
}: {
  form: IdentificationForm;
  text: LeadRequestText;
  lang: string;
  guardian: boolean;
}) {
  return (
    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      <IdentificationFormField form={form} field="residence_since" text={text} guardian={guardian} required>
        <IdentificationTextInput form={form} field="residence_since" maxLength={60} />
      </IdentificationFormField>
      <IdentificationFormField form={form} field="stay_reason" text={text} required>
        <IdentificationChoiceSelect form={form} field="stay_reason" options={pick(text.stayReasonOptions, STAY_REASONS)} text={text} />
      </IdentificationFormField>
      {/* The words right under the reason, only for "other": a named reason says enough (QA 2026-10-10). */}
      {form.draft.stay_reason === "other" ? (
        <IdentificationFormField form={form} field="stay_reason_details" text={text} required className={FULL_ROW}>
          <IdentificationTextArea form={form} field="stay_reason_details" rows={2} />
        </IdentificationFormField>
      ) : null}
      <IdentificationFormField form={form} field="former_citizenships" text={text}>
        <IdentificationCountriesSelect form={form} field="former_citizenships" text={text} lang={lang} />
      </IdentificationFormField>
      <IdentificationFormField form={form} field="other_residences" text={text} className={FULL_ROW}>
        <IdentificationTextArea form={form} field="other_residences" rows={2} />
      </IdentificationFormField>
    </div>
  );
}

/** Block H: the public office behind the patient's own "yes". */
function OfficeBlock({
  form,
  text,
  lang,
  relatedAsked,
}: {
  form: IdentificationForm;
  text: LeadRequestText;
  lang: string;
  /** The "yes" was about a close person: who that is to the patient is asked too. */
  relatedAsked: boolean;
}) {
  return (
    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      <IdentificationFormField form={form} field="pep_office" text={text} required className="sm:col-span-2">
        <IdentificationTextInput form={form} field="pep_office" maxLength={2000} />
      </IdentificationFormField>
      <IdentificationFormField form={form} field="pep_country" text={text} required>
        <IdentificationCountrySelect form={form} field="pep_country" text={text} lang={lang} />
      </IdentificationFormField>
      <IdentificationFormField form={form} field="pep_period" text={text} required>
        <IdentificationTextInput form={form} field="pep_period" maxLength={2000} />
      </IdentificationFormField>
      {relatedAsked ? (
        <IdentificationFormField form={form} field="pep_relationship" text={text} required className="sm:col-span-2">
          <IdentificationTextInput form={form} field="pep_relationship" maxLength={2000} />
        </IdentificationFormField>
      ) : null}
      <IdentificationFormField form={form} field="pep_wealth_origin" text={text} required className={FULL_ROW}>
        <IdentificationTextArea form={form} field="pep_wealth_origin" />
      </IdentificationFormField>
    </div>
  );
}

/** Block J: who the link is to, what kind of link it is, since when and to what extent. */
function SanctionsLinkBlock({ form, text }: { form: IdentificationForm; text: LeadRequestText }) {
  return (
    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      <IdentificationFormField form={form} field="sanctions_link_name" text={text} required className="sm:col-span-2">
        <IdentificationTextInput form={form} field="sanctions_link_name" maxLength={2000} />
      </IdentificationFormField>
      <IdentificationFormField form={form} field="sanctions_link_kind" text={text} required>
        <IdentificationChoiceSelect
          form={form}
          field="sanctions_link_kind"
          options={pick(text.sanctionsLinkKindOptions, SANCTIONS_LINK_KINDS)}
          text={text}
        />
      </IdentificationFormField>
      <IdentificationFormField form={form} field="sanctions_link_since_extent" text={text} required className={FULL_ROW}>
        <IdentificationTextArea form={form} field="sanctions_link_since_extent" />
      </IdentificationFormField>
    </div>
  );
}

/** The options of a list in its order. */
function pick<Key extends string>(labels: Record<Key, string>, order: readonly Key[]): Record<string, string> {
  return Object.fromEntries(order.map((key) => [key, labels[key]]));
}
