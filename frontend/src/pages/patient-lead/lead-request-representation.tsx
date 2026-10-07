import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle, Trash2, Upload } from "lucide-react";

import { Section } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { inputClass, selectClass, tokens } from "@/components/record-workspace/primitives/design-tokens";
import { appDateKey } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  INQUIRY_CONSENT,
  removeLeadRepresentative,
  saveLeadRepresentation,
  saveLeadRepresentative,
  uploadLeadRepresentativeDocument,
  withdrawLeadDocument,
  type Custody,
  type LeadRequest,
  type LeadRequestDocument,
  type LeadRequestRepresentative,
  type RepresentativeSlot,
  type RepresentativeUploadKind,
} from "./lead-request-api";
import { MAX_UPLOAD_BYTES, combinedSaveState, consentGiven, type SaveState } from "./lead-request-model";
import {
  LabeledField,
  RequiredMark,
  UploadedFileList,
  YesNoSelect,
  errorBody,
  errorMessage,
  useAutosave,
  type RequestQueue,
} from "./lead-request-parts";
import {
  BASE_REPRESENTATIVE_FIELDS,
  CUSTODIES,
  REPRESENTATIVE_FIELDS,
  ROLE_OF_SLOT,
  asksRepresentativeField,
  authorityProofOf,
  draftFromRepresentation,
  draftFromRepresentative,
  hasChildAddress,
  hasRepresentativeEntries,
  newRepresentativeId,
  refusedRepresentativeField,
  removedByAnswers,
  representationPatch,
  representativeInSlot,
  representativeName,
  representativePatch,
  representativeSubmitPart,
  representativeValue,
  representativesOnFile,
  requiresRepresentativeField,
  shownSlots,
  stillRejectedRepresentative,
  withChildAddress,
  withRejectedRepresentative,
  type RejectedRepresentative,
  type RepresentationDraft,
  type RepresentativeDraft,
  type RepresentativeField,
} from "./lead-request-representation-model";
import {
  asLeadCabinetLang,
  representativeFieldLabel,
  representativeHeading,
  representativeOnFileNote,
  representativeUploadLabel,
  type LeadRequestText,
} from "./lead-request-text";

// Who acts for the lead (owner spec "Patientenformular", section 3). An adult
// says whether somebody acts for him and whether he is under legal
// guardianship; each "yes" names one person. For a minor the parent says who
// has custody and names the legal representatives. Every person has a form of
// its own that saves on its own, with identity document and uploads.

/** The save state of the answers; a person's form reports under its slot. */
const ANSWERS = "answers";

/**
 * The persons of whom the missing keys name more than the first step's names
 * and contacts (`<slot>_<part>`, the uploads included).
 */
function slotsBeyondBase(missing: readonly string[]): Set<RepresentativeSlot> {
  const slots = new Set<RepresentativeSlot>();
  for (const key of missing) {
    const part = representativeSubmitPart(key);
    if (part && !(BASE_REPRESENTATIVE_FIELDS as readonly string[]).includes(part.part)) slots.add(part.slot);
  }
  return slots;
}

/** The form of one person as typed, with what the server refused. */
type RepresentativeForm = {
  draft: RepresentativeDraft;
  set: <Field extends RepresentativeField>(field: Field, value: RepresentativeDraft[Field]) => void;
  update: (change: (draft: RepresentativeDraft) => RepresentativeDraft) => void;
  errorFor: (field: RepresentativeField) => string | undefined;
  /** What the server refused about the person as a whole. */
  problem: string | undefined;
  /** While the person is being removed nothing of the form is saved. */
  setRemoved: (removed: boolean) => void;
};

type RefusedValues = { values: RejectedRepresentative; codes: Partial<Record<RepresentativeField, string>> };

function refusalText(text: LeadRequestText, code: string | undefined): string {
  switch (code) {
    case "id_document_expired":
      return text.idDocumentExpired;
    case "representative_email_is_login":
      return text.representativeEmailLocked;
    case "representative_email_duplicate":
      return text.representativeEmailDuplicate;
    default:
      return text.invalidField;
  }
}

function problemText(text: LeadRequestText, code: string): string | undefined {
  if (!code) return undefined;
  if (code === "representative_limit") return text.representativeLimit;
  return code === "representative_in_use" ? text.representativeInUse : text.notSaved;
}

/**
 * Autosave of one person, like the statements for the identification: only
 * what changed, after the draft has rested; a refused value stays out until
 * it is changed and does not hold back the other fields. A person the server
 * does not know yet is created by the first save, with an id made here, once
 * the last name is there.
 */
function useRepresentativeForm({
  request,
  slot,
  person,
  text,
  enqueue,
  onChange,
  onSaveState,
  isShown,
}: {
  request: LeadRequest;
  slot: RepresentativeSlot;
  person: LeadRequestRepresentative | null;
  text: LeadRequestText;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
  /** Whether the answers still ask for this person; a form that was taken away saves nothing. */
  isShown: (slot: RepresentativeSlot) => boolean;
}): RepresentativeForm {
  const [draft, setDraft] = useState<RepresentativeDraft>(() => draftFromRepresentative(person));
  const savedRef = useRef<RepresentativeDraft>(draftFromRepresentative(person));
  // The id the person has on the server, or the one made for the first save.
  const idRef = useRef<string | null>(person?.id ?? null);
  const existsRef = useRef(Boolean(person));
  const lockedRef = useRef(Boolean(person?.email_locked));
  const refusedRef = useRef<RefusedValues>({ values: {}, codes: {} });
  const failedRef = useRef(false);
  const removedRef = useRef(false);
  const [refused, setRefused] = useState<RefusedValues>(refusedRef.current);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    lockedRef.current = Boolean(person?.email_locked);
  }, [person?.email_locked]);

  const save = useCallback(
    (snapshot: RepresentativeDraft) => {
      if (removedRef.current || !isShown(slot)) return;
      void enqueue(async () => {
        if (removedRef.current) return;
        let saved = false;
        let refusedAsWhole = "";
        let anotherId = false;
        let rejected = stillRejectedRepresentative(refusedRef.current.values, snapshot);
        const codes = { ...refusedRef.current.codes };
        // Each round either saves or sets one more refused field aside.
        for (;;) {
          const patch = representativePatch(savedRef.current, snapshot, {
            rejected,
            create: existsRef.current ? null : ROLE_OF_SLOT[slot],
            emailLocked: lockedRef.current,
          });
          if (!patch) break;
          onSaveState("saving");
          const id = (idRef.current ??= newRepresentativeId());
          try {
            const next = await saveLeadRepresentative(request.lead_id, id, patch);
            const stored = next.representation?.representatives.find((item) => item.id === id);
            if (stored) savedRef.current = draftFromRepresentative(stored);
            existsRef.current = true;
            saved = true;
            onChange(next);
            break;
          } catch (cause) {
            const body = errorBody(cause);
            const code = typeof body?.code === "string" ? body.code : "";
            // The id made here is somebody else's on the server: another one, once.
            if (code === "representative_id_taken" && !existsRef.current && !anotherId) {
              idRef.current = null;
              anotherId = true;
              continue;
            }
            const field = refusedRepresentativeField(code, body?.field);
            if (!field || !(field in patch)) {
              refusedAsWhole = code || "failed";
              break;
            }
            rejected = withRejectedRepresentative(rejected, field, snapshot);
            codes[field] = code;
          }
        }
        refusedRef.current = { values: rejected, codes };
        setRefused(refusedRef.current);
        setProblem(refusedAsWhole);
        const wasFailed = failedRef.current;
        failedRef.current = Boolean(refusedAsWhole) || Object.keys(rejected).length > 0;
        if (failedRef.current) onSaveState("error");
        else if (saved || wasFailed) onSaveState("saved");
      });
    },
    [enqueue, isShown, onChange, onSaveState, request.lead_id, slot],
  );

  useAutosave(draft, save);

  return {
    draft,
    set: (field, value) => setDraft((current) => ({ ...current, [field]: value })),
    update: (change) => setDraft(change),
    errorFor: (field) => {
      // The message belongs to the refused value: it goes as soon as the value is changed.
      const value = refused.values[field];
      if (value !== undefined && value === representativeValue(field, draft)) return refusalText(text, refused.codes[field]);
      // Nothing about a person is saved before the last name is there.
      if (field === "last_name" && !representativeValue(field, draft) && hasRepresentativeEntries(draft)) return text.required;
      return undefined;
    },
    problem: problemText(text, problem),
    setRemoved: (removed) => {
      removedRef.current = removed;
    },
  };
}

/** An upload of a person: a copy of the identity document, or the proof of authority. */
function RepresentativeUpload({
  request,
  slot,
  kind,
  label,
  required,
  person,
  documents,
  text,
  lang,
  enqueue,
  onChange,
}: {
  request: LeadRequest;
  slot: RepresentativeSlot;
  kind: RepresentativeUploadKind;
  label: string;
  required: boolean;
  /** `null` until the first save has created the person: there is nobody to upload for yet. */
  person: LeadRequestRepresentative | null;
  documents: readonly LeadRequestDocument[];
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
}) {
  const consentReady = consentGiven(request, INQUIRY_CONSENT);
  const ready = consentReady && person !== null;
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const id = `lead-request-${slot}-${kind}`;

  async function uploadFiles(files: File[]) {
    if (files.length === 0 || !person) return;
    setUploading(true);
    const nextErrors: string[] = [];
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        nextErrors.push(text.fileTooLarge(file.name));
        continue;
      }
      try {
        onChange(await enqueue(() => uploadLeadRepresentativeDocument(request.lead_id, person.id, kind, file)));
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
      onChange(await enqueue(() => withdrawLeadDocument(request.lead_id, documentId)));
    } catch (cause) {
      setErrors([errorMessage(cause)]);
    }
  }

  return (
    <div className="space-y-2" data-testid={`${id}-upload`}>
      <p id={`${id}-label`} className={tokens.text.label}>
        {label}
        {required ? <RequiredMark /> : null}
      </p>
      <input
        ref={fileInput}
        id={`${id}-files`}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png"
        className="sr-only"
        aria-labelledby={`${id}-label`}
        disabled={!ready || uploading}
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
        // Several uploads share the wording of the button: each is named with what it is for.
        aria-label={`${label}: ${text.uploadButton}`}
        disabled={!ready || uploading}
        onClick={() => fileInput.current?.click()}
      >
        {uploading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Upload aria-hidden="true" className="size-4" />}
        {uploading ? text.uploading : text.uploadButton}
      </Button>
      <p className="text-xs text-muted-foreground">
        {!consentReady
          ? text.identityUploadNeedsConsent
          : person
            ? text.identityUploadHint
            : text.representativeUploadNeedsPerson}
      </p>
      {errors.map((message) => (
        <p key={message} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ))}
      <UploadedFileList
        documents={documents}
        text={text}
        lang={lang}
        emptyText={kind === "identity" ? text.noIdentityDocuments : text.noAuthorityDocuments}
        testId={`${id}-list`}
        onRemove={(documentId) => void remove(documentId)}
      />
    </div>
  );
}

/**
 * One person who acts for the lead: who that is and the uploads of the
 * identity document and of the authority. `fields` are the fields asked in
 * this step (a minor's parents give names and contacts in the first step,
 * the rest in block G); `uploads` whether the uploads are asked here.
 */
function RepresentativeBlock({
  request,
  slot,
  person,
  custody,
  fields,
  uploads,
  text,
  lang,
  enqueue,
  onChange,
  onPartState,
  onEntries,
  onRemoved,
  isShown,
}: {
  request: LeadRequest;
  slot: RepresentativeSlot;
  /** The person on the server; `null` until the first save of this form has created it. */
  person: LeadRequestRepresentative | null;
  /** A minor's custody as chosen in the form; `null` for an adult. */
  custody: Custody | null;
  fields: ReadonlySet<RepresentativeField>;
  uploads: boolean;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onPartState: (part: string, state: SaveState) => void;
  /** Tells the block whether anything is typed here, so that hiding the form can ask first. */
  onEntries: (slot: RepresentativeSlot, entries: boolean) => void;
  onRemoved: (slot: RepresentativeSlot) => void;
  isShown: (slot: RepresentativeSlot) => boolean;
}) {
  // A save that answers after the form is gone must not leave its state behind.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onPartState(slot, "idle");
    };
  }, [onPartState, slot]);
  const onSaveState = useCallback(
    (state: SaveState) => {
      if (mounted.current) onPartState(slot, state);
    },
    [onPartState, slot],
  );

  const form = useRepresentativeForm({ request, slot, person, text, enqueue, onChange, onSaveState, isShown });
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const entries = hasRepresentativeEntries(form.draft);
  useEffect(() => {
    onEntries(slot, entries);
  }, [entries, onEntries, slot]);

  const minor = slot === "rep1" || slot === "rep2";
  const pickerLang = asLeadCabinetLang(lang) ?? undefined;
  const heading = representativeHeading(text, slot, Boolean(person?.mine), custody);
  const locked = Boolean(person?.email_locked);
  const proof = authorityProofOf(slot, custody);
  const fieldId = (field: RepresentativeField) => `lead-request-${slot}_${field}`;
  const control = (field: RepresentativeField) => {
    const invalid = Boolean(form.errorFor(field));
    return {
      id: fieldId(field),
      "aria-invalid": invalid || undefined,
      "aria-describedby": invalid ? `${fieldId(field)}-error` : undefined,
    };
  };
  const labeled = (field: RepresentativeField, className?: string) => ({
    id: fieldId(field),
    label: representativeFieldLabel(text, field),
    error: form.errorFor(field),
    required: requiresRepresentativeField(slot, field),
    className,
  });
  const textInput = (
    field: Exclude<RepresentativeField, "citizenships">,
    maxLength: number,
    type: "text" | "tel" = "text",
  ) => (
    <Input
      {...control(field)}
      className={inputClass}
      type={type}
      autoComplete="off"
      maxLength={maxLength}
      value={form.draft[field]}
      onChange={(event) => form.set(field, event.target.value)}
    />
  );
  const asked = (field: RepresentativeField) => fields.has(field) && asksRepresentativeField(slot, field);
  const dateInput = (field: "date_of_birth", max?: string) => (
    <Input
      key={`${fieldId(field)}-${lang}`}
      {...control(field)}
      className={inputClass}
      type="date"
      autoComplete="off"
      pickerLang={pickerLang}
      max={max}
      value={form.draft[field]}
      onChange={(event) => form.set(field, event.target.value)}
    />
  );
  const countrySelect = (field: "birth_country" | "country") => (
    <CountrySelect
      value={form.draft[field] || null}
      lang={lang}
      className={selectClass}
      aria-label={representativeFieldLabel(text, field)}
      onChange={(code) => form.set(field, code ?? "")}
    />
  );
  // Below the e-mail: whose sign-in address it is, or what the address is used for.
  const emailHint = locked
    ? person?.mine
      ? text.representativeEmailIsLogin
      : text.representativeEmailIsTheirLogin
    : slot === "rep2"
      ? text.representativeInviteHint
      : "";
  const emailError = Boolean(form.errorFor("email"));
  const emailDescribedBy =
    [emailHint ? `${fieldId("email")}-hint` : "", emailError ? `${fieldId("email")}-error` : ""].filter(Boolean).join(" ") ||
    undefined;

  async function remove() {
    if (!person) return;
    if (!window.confirm(text.representativeRemoveConfirm(representativeName(person) || heading))) return;
    setRemoving(true);
    setRemoveError("");
    // What is still unsaved in this form goes with the person.
    form.setRemoved(true);
    try {
      onChange(await enqueue(() => removeLeadRepresentative(request.lead_id, person.id)));
      onRemoved(slot);
    } catch (cause) {
      form.setRemoved(false);
      setRemoveError(errorBody(cause)?.code === "representative_in_use" ? text.representativeInUse : errorMessage(cause));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={`lead-request-representative-${slot}-title`}
      className="space-y-3 rounded-lg border border-border bg-muted/10 px-3 py-3"
      data-testid={`lead-request-representative-${slot}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`lead-request-representative-${slot}-title`} className="min-w-0 break-words text-sm font-semibold">
          {heading}
        </h4>
        {person?.can_remove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs"
            // The uploads below have a "remove" of their own: this one names the person.
            aria-label={`${heading}: ${text.representativeRemove}`}
            disabled={removing}
            onClick={() => void remove()}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            {text.representativeRemove}
          </Button>
        ) : null}
      </div>
      {/* The other parent has to be told that the data are given here. */}
      {slot === "rep2" ? <p className="text-xs leading-5 text-muted-foreground">{text.representativeInformHint}</p> : null}
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {asked("first_name") ? <LabeledField {...labeled("first_name")}>{textInput("first_name", 100)}</LabeledField> : null}
        {asked("last_name") ? <LabeledField {...labeled("last_name")}>{textInput("last_name", 100)}</LabeledField> : null}
        {asked("date_of_birth") ? (
          <LabeledField {...labeled("date_of_birth")}>{dateInput("date_of_birth", appDateKey())}</LabeledField>
        ) : null}
        {asked("birth_place") ? <LabeledField {...labeled("birth_place")}>{textInput("birth_place", 200)}</LabeledField> : null}
        {asked("birth_country") ? (
          <LabeledField {...labeled("birth_country")}>{countrySelect("birth_country")}</LabeledField>
        ) : null}
        {asked("citizenships") ? (
          <LabeledField {...labeled("citizenships")}>
            <CitizenshipMultiSelect
              id={fieldId("citizenships")}
              value={form.draft.citizenships}
              lang={lang}
              placeholder={text.citizenshipsPlaceholder}
              invalid={Boolean(form.errorFor("citizenships"))}
              onChange={(next) => form.set("citizenships", next)}
            />
          </LabeledField>
        ) : null}
        {/* A parent usually lives with the child: the address need not be typed twice. */}
        {minor && asked("street") ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto min-h-8 whitespace-normal py-1.5 text-left"
              disabled={!hasChildAddress(request.personal_data)}
              onClick={() => form.update((current) => withChildAddress(current, request.personal_data))}
            >
              {text.copyChildAddress}
            </Button>
          </div>
        ) : null}
        {asked("street") ? (
          <LabeledField {...labeled("street", "sm:col-span-2 lg:col-span-3")}>{textInput("street", 200)}</LabeledField>
        ) : null}
        {asked("zip") ? <LabeledField {...labeled("zip")}>{textInput("zip", 20)}</LabeledField> : null}
        {asked("city") ? <LabeledField {...labeled("city")}>{textInput("city", 200)}</LabeledField> : null}
        {asked("country") ? <LabeledField {...labeled("country")}>{countrySelect("country")}</LabeledField> : null}
        {asked("email") ? (
          <LabeledField {...labeled("email", "sm:col-start-1")}>
            <Input
              {...control("email")}
              aria-describedby={emailDescribedBy}
              className={cn(inputClass, locked && "bg-muted/40 text-muted-foreground")}
              type="email"
              autoComplete="off"
              maxLength={254}
              // A sign-in address is changed by staff only.
              readOnly={locked}
              value={form.draft.email}
              onChange={(event) => form.set("email", event.target.value)}
            />
            {emailHint ? (
              <p id={`${fieldId("email")}-hint`} className="text-xs leading-5 text-muted-foreground">
                {emailHint}
              </p>
            ) : null}
          </LabeledField>
        ) : null}
        {asked("phone") ? <LabeledField {...labeled("phone")}>{textInput("phone", 50, "tel")}</LabeledField> : null}
      </div>

      {/* The identity document: a copy only; GMED enters its data. */}
      {uploads ? (
        <RepresentativeUpload
          request={request}
          slot={slot}
          kind="identity"
          label={representativeUploadLabel(text, slot, "identity")}
          required
          person={person}
          documents={person?.identity_documents ?? []}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
        />
      ) : null}
      {uploads && proof ? (
        <RepresentativeUpload
          request={request}
          slot={slot}
          kind="authority"
          label={text.representativeAuthority[proof.proof]}
          required={proof.required}
          person={person}
          documents={person?.authority_documents ?? []}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
        />
      ) : null}
      {[form.problem, removeError].filter(Boolean).map((message) => (
        <p key={message} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
}

/**
 * Who acts for the lead (trigger flow 2026-10-07). `mode="base"` is the part
 * of step "Einwilligung & Person": an adult's two yes/no questions, or a
 * minor's custody with the names and contacts of the parents (they consent
 * and sign). `mode="follow_up"` is block G: the persons named by those
 * answers with the rest of their data and the uploads. A key the server
 * still lists as missing in the step (`stepMissing`) is asked there in any
 * case. `request.minor` says which questions are asked.
 */
export function RepresentationSection({
  request,
  text,
  lang,
  enqueue,
  onChange,
  onSaveState,
  mode,
  stepMissing = [],
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
  mode: "base" | "follow_up";
  stepMissing?: readonly string[];
}) {
  const representation = request.representation;
  const minor = request.minor;
  const [draft, setDraft] = useState<RepresentationDraft>(() => draftFromRepresentation(representation));
  const savedRef = useRef<RepresentationDraft>(draftFromRepresentation(representation));
  const refusedRef = useRef<string | null>(null);
  const failedRef = useRef(false);
  // "in_use": the server keeps a person, so the answer went back. "failed": the answers are not saved.
  const [problem, setProblem] = useState<"in_use" | "failed" | null>(null);
  // A person removed with "remove" leaves an empty form in its place.
  const [generations, setGenerations] = useState<Partial<Record<RepresentativeSlot, number>>>({});
  const [states, setStates] = useState<Record<string, SaveState>>({});
  // A person's form opens once the server has the answer that asks for it (it
  // then knows whom it holds for that place), and closes with the answer.
  const stored = shownSlots(minor, draftFromRepresentation(representation));
  const answered = shownSlots(minor, draft).filter((slot) => stored.includes(slot));
  // What the step asks of each person: everything in block G; in the first step a
  // minor's parents give names and contacts, an adult's persons nothing. A
  // server that still lists more of a person as missing in the first step (an
  // older one) gets the whole person there — from the visit's start on, so the
  // form does not lose a field the moment it is saved.
  const [missingAtStart] = useState(() => slotsBeyondBase(stepMissing));
  const missingNow = slotsBeyondBase(stepMissing);
  const whole = (slot: RepresentativeSlot) => mode === "follow_up" || missingAtStart.has(slot) || missingNow.has(slot);
  const fieldsOf = (slot: RepresentativeSlot): ReadonlySet<RepresentativeField> =>
    new Set(whole(slot) ? REPRESENTATIVE_FIELDS : minor ? BASE_REPRESENTATIVE_FIELDS : []);
  const shown = answered.filter((slot) => minor || whole(slot));
  const shownRef = useRef(shown);
  const entriesRef = useRef<Partial<Record<RepresentativeSlot, boolean>>>({});

  // In the layout phase, so before a form that was taken away is asked for its last save.
  useLayoutEffect(() => {
    shownRef.current = shown;
  });
  const isShown = useCallback((slot: RepresentativeSlot) => shownRef.current.includes(slot), []);
  const onEntries = useCallback((slot: RepresentativeSlot, entries: boolean) => {
    entriesRef.current[slot] = entries;
  }, []);
  const onRemoved = useCallback((slot: RepresentativeSlot) => {
    setGenerations((current) => ({ ...current, [slot]: (current[slot] ?? 0) + 1 }));
  }, []);

  // The footer shows one state for the answers and every person.
  const setPartState = useCallback((part: string, state: SaveState) => {
    setStates((current) => (current[part] === state ? current : { ...current, [part]: state }));
  }, []);
  useEffect(() => {
    onSaveState(combinedSaveState(Object.values(states)));
  }, [onSaveState, states]);

  const save = useCallback(
    (snapshot: RepresentationDraft) => {
      void enqueue(async () => {
        const patch = representationPatch(savedRef.current, snapshot, minor);
        const key = JSON.stringify(patch);
        if (Object.keys(patch).length === 0) {
          // Back at the saved answers: what the server refused in between is no error any more.
          if (failedRef.current) {
            failedRef.current = false;
            refusedRef.current = null;
            setProblem((current) => (current === "failed" ? null : current));
            setPartState(ANSWERS, "saved");
          }
          return;
        }
        if (key === refusedRef.current) return;
        setPartState(ANSWERS, "saving");
        try {
          const next = await saveLeadRepresentation(request.lead_id, patch);
          savedRef.current = draftFromRepresentation(next.representation);
          refusedRef.current = null;
          failedRef.current = false;
          setProblem(null);
          setPartState(ANSWERS, "saved");
          onChange(next);
        } catch (cause) {
          failedRef.current = true;
          setPartState(ANSWERS, "error");
          if (errorBody(cause)?.code === "representative_in_use") {
            // Nothing was saved and the person stays: the form shows the stored answers again.
            const stored = savedRef.current;
            setProblem("in_use");
            setDraft((current) => ({
              has_representative: "has_representative" in patch ? stored.has_representative : current.has_representative,
              under_guardianship: "under_guardianship" in patch ? stored.under_guardianship : current.under_guardianship,
              custody: "custody" in patch ? stored.custody : current.custody,
            }));
          } else {
            // The refused answers are not repeated until they are changed.
            refusedRef.current = key;
            setProblem("failed");
          }
        }
      });
    },
    [enqueue, minor, onChange, request.lead_id, setPartState],
  );

  useAutosave(draft, save);

  if (!representation) return null;

  /** Takes over new answers; asks first when they take a person away. */
  const change = (next: RepresentationDraft) => {
    const stays = shownSlots(minor, next);
    const hidden = shown.filter((slot) => !stays.includes(slot));
    const removed = removedByAnswers(representation, minor, next);
    // A person typed in, but not saved yet, goes with the form.
    const typed = hidden.filter((slot) => !representativeInSlot(representation, slot) && entriesRef.current[slot]);
    if (removed.length > 0 || typed.length > 0) {
      const who = [
        ...removed.map((person) => representativeName(person) || text.representativeCaptions[person.slot ?? "rep2"]),
        ...typed.map((slot) => text.representativeCaptions[slot]),
      ].join(", ");
      if (!window.confirm(text.representativeRemoveConfirm(who))) return;
    }
    setProblem((current) => (current === "in_use" ? null : current));
    setDraft(next);
    // An answer is a choice, not typing: it is saved at once, and the form it asks for opens with the reply.
    save(next);
  };

  const block = (slot: RepresentativeSlot) => (
    <RepresentativeBlock
      key={`${slot}-${generations[slot] ?? 0}`}
      request={request}
      slot={slot}
      person={representativeInSlot(representation, slot)}
      custody={minor ? draft.custody : null}
      fields={fieldsOf(slot)}
      uploads={whole(slot)}
      text={text}
      lang={lang}
      enqueue={enqueue}
      onChange={onChange}
      onPartState={setPartState}
      onEntries={onEntries}
      onRemoved={onRemoved}
      isShown={isShown}
    />
  );
  const problems =
    problem === null ? null : (
      <p role="alert" className="text-xs text-destructive" data-testid="lead-request-representation-problem">
        {problem === "in_use" ? text.representativeInUse : text.notSaved}
      </p>
    );

  if (mode === "follow_up") {
    // Block G: the persons the answers of the first step name, with the rest of their data and the uploads.
    return (
      <div className="space-y-4" data-testid="lead-request-representation-follow-up">
        {problems}
        {shown.map(block)}
      </div>
    );
  }

  if (minor) {
    return (
      <Section title={text.sectionLegalRepresentatives}>
        <div className="space-y-4" data-testid="lead-request-representation">
          {/* Who consents and signs follows the custody chosen below. */}
          <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-request-custody-note">
            {`${text.legalRepresentativesIntro} ${text.custodySignatureNote[draft.custody]}`}
          </p>
          <LabeledField id="lead-request-custody" label={text.custodyQuestion}>
            <NativeComboboxSelect
              id="lead-request-custody"
              className={selectClass}
              value={draft.custody}
              onChange={(event) => {
                const custody = CUSTODIES.find((value) => value === event.target.value);
                if (custody && custody !== draft.custody) change({ ...draft, custody });
              }}
            >
              {CUSTODIES.map((value) => (
                <option key={value} value={value}>
                  {text.custodyOptions[value]}
                </option>
              ))}
            </NativeComboboxSelect>
          </LabeledField>
          {problems}
          {/* Somebody with custody whom staff entered and the form does not ask for. */}
          {representativesOnFile(representation).map((person) => (
            <p
              key={person.id}
              role="note"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
              data-testid="lead-request-representative-on-file"
            >
              {representativeOnFileNote(text, representativeName(person) || "—", draft.custody)}
            </p>
          ))}
          {shown.map(block)}
        </div>
      </Section>
    );
  }

  return (
    <Section title={text.sectionRepresentation}>
      <div className="space-y-5" data-testid="lead-request-representation">
        <div className="space-y-3">
          <LabeledField id="lead-request-has_representative" label={text.hasRepresentativeQuestion} required question>
            <YesNoSelect
              id="lead-request-has_representative"
              className="sm:max-w-[calc(50%-0.5rem)]"
              value={draft.has_representative}
              text={text}
              onChange={(answer) => {
                if (answer !== draft.has_representative) change({ ...draft, has_representative: answer });
              }}
            />
          </LabeledField>
          {shown.includes("agent") ? block("agent") : null}
        </div>
        <div className="space-y-3">
          <LabeledField id="lead-request-under_guardianship" label={text.underGuardianshipQuestion} required question>
            <YesNoSelect
              id="lead-request-under_guardianship"
              className="sm:max-w-[calc(50%-0.5rem)]"
              value={draft.under_guardianship}
              text={text}
              onChange={(answer) => {
                if (answer !== draft.under_guardianship) change({ ...draft, under_guardianship: answer });
              }}
            />
          </LabeledField>
          {shown.includes("guardian") ? block("guardian") : null}
        </div>
        {problems}
      </div>
    </Section>
  );
}
