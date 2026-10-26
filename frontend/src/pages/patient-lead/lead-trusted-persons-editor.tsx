import { useState } from "react";
import { CalendarDays, Info, Mail, Phone, Plus, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { checkboxClass, inputClass, selectClass } from "@/components/record-workspace/primitives/design-tokens";
import { appDateKey } from "@/lib/app-time-zone";
import { CONSENT_RECIPIENT_SCOPES, cabinetScopeSummary, checkedScopeCodes, normalizeScopeCodes, scopeOptionLabel, toggleScopeCode } from "@/lib/consent-recipient-scope";
import { isValidPersonPhone } from "@/lib/person-fields";
import { cn } from "@/lib/utils";
import { CONSENT_RECIPIENT_RELATIONS, MAX_CONSENT_RECIPIENTS, type ConsentRecipient, type ConsentRecipientRelation } from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import { asLeadCabinetLang } from "./lead-request-text";
import { blankRecipient, formatBirthDate, isInstitution, personScope, recipientProblems, typedRecipient, unchangedStored, type RecipientDraft, type RecipientField } from "./lead-trusted-persons-model";
import { trustedPersonsText } from "./lead-trusted-persons-text";

/**
 * The saved persons, read-only: name, relationship, date of birth and the phone they call from
 * (owner 2026-10-26: staff check a caller by both), a legacy contact as given, and the scope.
 * `onRemove` (after the request is sent) offers to remove a person — a withdrawal.
 */
export function TrustedPersonsList({ persons, lang, onRemove, disabled = false }: {
  persons: readonly ConsentRecipient[]; lang: string; onRemove?: (index: number) => void; disabled?: boolean;
}) {
  const text = consentFormText(lang);
  const fields = trustedPersonsText(lang);
  return <ul className="space-y-2 text-sm" data-testid="trusted-persons-list">
    {persons.map((person, index) => {
      const born = formatBirthDate(person.birth_date);
      const scopes = normalizeScopeCodes(person.scope_codes);
      const scopeLabels = scopes.length ? scopes.map((code) => cabinetScopeSummary([code], lang)) : [personScope(person, lang)].filter(Boolean);
      const contacts = [...new Set([person.phone?.trim(), person.contact?.trim()].filter((value): value is string => Boolean(value)))];
      return <li key={index} className="flex items-start justify-between gap-3 break-words rounded-lg border border-border/60 bg-card px-3 py-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <UserRound aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="font-semibold text-foreground [overflow-wrap:anywhere]">{person.name}</span>
            <StatusChip className="border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200">{text.recipientRelations[person.relation] ?? text.recipientRelations.other}</StatusChip>
            {born ? <StatusChip tone="info"><CalendarDays aria-hidden="true" />{fields.birthDateShort} {born}</StatusChip> : null}
            {contacts.map((contact) => <StatusChip key={contact} tone="warning">
              {contact.includes("@") ? <Mail aria-hidden="true" /> : <Phone aria-hidden="true" />}
              <span className="min-w-0 [overflow-wrap:anywhere]">{contact}</span>
            </StatusChip>)}
          </div>
          {scopeLabels.length ? <div className="flex flex-wrap gap-1.5">{scopeLabels.map((scope) => <StatusChip key={scope} tone="info">{scope}</StatusChip>)}</div> : null}
        </div>
        {onRemove ? <Button type="button" variant="ghost" size="sm" className="size-7 shrink-0 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={disabled}
          aria-label={`${fields.removePerson}: ${person.name}`} title={fields.removePerson} data-testid="trusted-person-remove" onClick={() => onRemove(index)}>
          <Trash2 aria-hidden="true" className="size-3.5" />
        </Button> : null}
      </li>;
    })}
  </ul>;
}

/**
 * The (i) beside the phone label: why GMED asks for the number (owner 2026-10-26). A toggle button
 * with the explanation right below the label, so it never leaves a phone screen; Escape closes it.
 */
function PhoneInfo({ index, label, info }: { index: number; label: string; info: string }) {
  const [open, setOpen] = useState(false);
  const id = `trusted-person-phone-info-${index}`;
  return <>
    <button type="button" className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={label} title={label} aria-expanded={open} aria-controls={id} data-testid="trusted-person-phone-info"
      onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <Info aria-hidden="true" className="size-3.5" />
    </button>
    {open ? <p id={id} role="note" className="basis-full rounded-lg border border-border/70 bg-muted/40 px-3 py-2 leading-5 text-foreground" data-testid="trusted-person-phone-info-text">{info}</p> : null}
  </>;
}

/**
 * `showErrors` (after "Next" or a tab could not save the choice) marks each
 * missing or wrong entry at its field; a phone number that is not one is named
 * as soon as the field is left. `serverProblem` marks the field the server
 * refused. A saved person shown unchanged keeps its legacy contact (read-only)
 * and needs no phone or date of birth until it is edited (owner 2026-10-26).
 */
export function TrustedPersonsEditor({ persons, onChange, lang, disabled = false, showErrors = false, serverProblem = null }: {
  persons: readonly RecipientDraft[]; onChange: (persons: RecipientDraft[]) => void; lang: string; disabled?: boolean; showErrors?: boolean;
  serverProblem?: { index: number; field: RecipientField } | null;
}) {
  const text = consentFormText(lang);
  const fields = trustedPersonsText(lang);
  const today = appDateKey();
  const [leftPhone, setLeftPhone] = useState<ReadonlySet<number>>(() => new Set());
  const update = (index: number, patch: Partial<RecipientDraft>) => onChange(persons.map((person, at) => at === index ? { ...person, ...patch } : person));
  // An empty row is no person (it is dropped on saving) unless it is the only one.
  const anyTyped = persons.some(typedRecipient);
  const problemsOf = (person: RecipientDraft, index: number): ReadonlySet<RecipientField> => {
    const all = recipientProblems(person, today);
    const shown = new Set<RecipientField>(showErrors && (typedRecipient(person) || !anyTyped) ? all : []);
    if (leftPhone.has(index) && person.phone.trim() && !isValidPersonPhone(person.phone)) shown.add("phone");
    if (serverProblem?.index === index) shown.add(serverProblem.field);
    return shown;
  };
  const messages: Record<RecipientField, string> = {
    name: fields.nameRequired, relation: fields.relationRequired, phone: fields.phoneRequired, birth_date: fields.birthDateRequired, scope: fields.scopeRequired,
  };
  const message = (field: RecipientField, problems: ReadonlySet<RecipientField>, index: number) => problems.has(field)
    ? <p className="text-destructive" role="alert" id={`trusted-person-${field}-${index}-error`} data-testid={`trusted-person-${field}-error`}>{messages[field]}</p>
    : null;
  const removeAt = (index: number) => {
    onChange(persons.filter((_, at) => at !== index));
    setLeftPhone((current) => new Set([...current].filter((at) => at !== index).map((at) => (at > index ? at - 1 : at))));
  };
  return <div className="space-y-3" data-testid="trusted-persons-editor">
    {persons.length === 0 ? <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-muted/25 px-3 py-4 text-sm text-muted-foreground"><UserRound aria-hidden="true" className="size-4 shrink-0" /><p>{fields.empty}</p></div> : null}
    {persons.map((person, index) => {
      const problems = problemsOf(person, index);
      const describedBy = (field: RecipientField) => (problems.has(field) ? `trusted-person-${field}-${index}-error` : undefined);
      const legacyContact = person.contact.trim() && unchangedStored(person) ? person.contact.trim() : "";
      const institution = isInstitution(person.relation);
      const checked = checkedScopeCodes(person.scopeCodes);
      return <div key={index} className="overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="trusted-person-editor">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium"><span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-card font-mono text-[11px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><span className="truncate">{person.name || fields.name}</span></span>
        <Button type="button" variant="ghost" size="sm" className="size-7 shrink-0 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={disabled} aria-label={text.removeRecipient} title={text.removeRecipient} onClick={() => removeAt(index)}><Trash2 aria-hidden="true" className="size-3.5" /></Button>
      </div>
      <div className="grid gap-x-4 gap-y-3 p-3 sm:grid-cols-2">
      <label className="min-w-0 space-y-1.5 text-xs"><span className="text-muted-foreground">{fields.name}</span>
        <Input className={inputClass} value={person.name} maxLength={120} disabled={disabled} autoComplete="off" aria-invalid={problems.has("name") || undefined} aria-describedby={describedBy("name")} onChange={(event) => update(index, { name: event.target.value })} />
        {message("name", problems, index)}
      </label>
      <label className="min-w-0 space-y-1.5 text-xs"><span className="text-muted-foreground">{fields.relation}</span>
        <NativeComboboxSelect className={selectClass} value={person.relation} disabled={disabled} aria-invalid={problems.has("relation") || undefined} aria-describedby={describedBy("relation")} onChange={(event) => update(index, { relation: event.target.value as ConsentRecipientRelation | "" })}>
          <option value="">—</option>{CONSENT_RECIPIENT_RELATIONS.map((relation) => <option key={relation} value={relation}>{text.recipientRelations[relation]}</option>)}
        </NativeComboboxSelect>
        {message("relation", problems, index)}
      </label>
      <div className="min-w-0 space-y-1.5 text-xs">
        <div className="flex flex-wrap items-start gap-x-1.5 gap-y-1.5">
          <label htmlFor={`trusted-person-phone-${index}`} className="min-w-0 flex-1 text-muted-foreground">{fields.phone}</label>
          <PhoneInfo index={index} label={fields.phoneInfoLabel} info={fields.phoneInfo} />
        </div>
        <Input id={`trusted-person-phone-${index}`} className={inputClass} type="tel" inputMode="tel" value={person.phone} maxLength={40} disabled={disabled} autoComplete="off" required
          aria-invalid={problems.has("phone") || undefined} aria-describedby={[describedBy("phone"), legacyContact ? `trusted-person-contact-${index}` : null].filter(Boolean).join(" ") || undefined}
          data-testid="trusted-person-phone"
          onBlur={() => setLeftPhone((current) => (current.has(index) ? current : new Set(current).add(index)))}
          onChange={(event) => update(index, { phone: event.target.value })} />
        {legacyContact ? <p id={`trusted-person-contact-${index}`} className="text-muted-foreground" data-testid="trusted-person-legacy-contact">{fields.legacyContact(legacyContact)}</p> : null}
        {message("phone", problems, index)}
      </div>
      {institution ? null : <div className="min-w-0 space-y-1.5 text-xs">
        <label htmlFor={`trusted-person-birth-date-${index}`} className="text-muted-foreground">{fields.birthDate}</label>
        <Input id={`trusted-person-birth-date-${index}`} key={`trusted-person-birth-date-${index}-${lang}`} className={inputClass} type="date" pickerLang={asLeadCabinetLang(lang) ?? undefined}
          min="1900-01-01" max={today} value={person.birthDate} disabled={disabled} autoComplete="off" required
          aria-invalid={problems.has("birth_date") || undefined} aria-describedby={describedBy("birth_date")} data-testid="trusted-person-birth-date"
          onChange={(event) => update(index, { birthDate: event.target.value })} />
        {message("birth_date", problems, index)}
      </div>}
      <fieldset className="min-w-0 space-y-1.5 text-xs sm:col-span-2" aria-invalid={problems.has("scope") || undefined} aria-describedby={describedBy("scope")} data-testid="trusted-person-scope">
        <legend className="mb-1.5 text-muted-foreground">{fields.scope}</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {CONSENT_RECIPIENT_SCOPES.map((code) => <label key={code} className={cn(
            "flex min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 text-sm leading-5",
            checked.includes(code) ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-border/70 bg-card",
            disabled && "cursor-not-allowed opacity-70",
          )}>
            <input type="checkbox" className={cn(checkboxClass, "mt-0.5 shrink-0")} checked={checked.includes(code)} disabled={disabled}
              data-testid={`trusted-person-scope-${code}`} onChange={() => update(index, { scopeCodes: toggleScopeCode(person.scopeCodes, code) })} />
            <span>{scopeOptionLabel(code, lang)}</span>
          </label>)}
        </div>
        {person.scopeCodes.length === 0 && person.scope.trim()
          ? <p className="text-amber-700 dark:text-amber-400" data-testid="trusted-person-scope-legacy">{fields.scopeLegacy(person.scope.trim())}</p>
          : message("scope", problems, index) ?? <p className="text-muted-foreground">{fields.scopeHint}</p>}
      </fieldset>
      </div>
    </div>;
    })}
    {persons.length < MAX_CONSENT_RECIPIENTS ? <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg" disabled={disabled} data-testid="trusted-person-add" onClick={() => onChange([...persons, blankRecipient()])}>
      <Plus aria-hidden="true" className="size-3.5" />{text.addRecipient}
    </Button> : <p className="text-xs text-muted-foreground" data-testid="trusted-person-max">{fields.maxReached}</p>}
  </div>;
}
