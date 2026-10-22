import { useState } from "react";
import { Plus, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { inputClass, selectClass } from "@/components/record-workspace/primitives/design-tokens";
import { CONSENT_RECIPIENT_SCOPES, cabinetScopeSummary, checkedScopeCodes, scopeOptionLabel, toggleScopeCode, type ConsentRecipientScope } from "@/lib/consent-recipient-scope";
import { CONSENT_RECIPIENT_RELATIONS, MAX_CONSENT_RECIPIENTS, type ConsentRecipient, type ConsentRecipientRelation } from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import { contactValid, personScope, recipientProblems, type RecipientDraft, type RecipientField } from "./lead-trusted-persons-model";
import { trustedPersonsText } from "./lead-trusted-persons-text";

export function TrustedPersonsList({ persons, lang }: { persons: readonly ConsentRecipient[]; lang: string }) {
  const text = consentFormText(lang);
  return <ul className="space-y-2 text-sm" data-testid="trusted-persons-list">
    {persons.map((person, index) => <li key={index} className="break-words rounded-lg border border-border/60 bg-card px-3 py-2">
      <span className="font-medium">{person.name}</span>{" · "}{text.recipientRelations[person.relation] ?? text.recipientRelations.other}
      {person.contact ? <span className="text-muted-foreground"> · {person.contact}</span> : null}
      {personScope(person, lang) ? <p className="mt-1 text-muted-foreground">{personScope(person, lang)}</p> : null}
    </li>)}
  </ul>;
}

/** Multi-select with check marks: `all` ticks every option, unticking another one drops `all`. */
export function ScopeSelect({ value, onChange, lang, disabled = false, invalid = false, id }: {
  value: readonly ConsentRecipientScope[]; onChange: (next: ConsentRecipientScope[]) => void; lang: string; disabled?: boolean; invalid?: boolean; id?: string;
}) {
  const fields = trustedPersonsText(lang);
  const summary = cabinetScopeSummary(value, lang);
  return <NativeComboboxSelect id={id} className={selectClass} value="" disabled={disabled} aria-invalid={invalid || undefined}
    selectedValues={checkedScopeCodes(value)} showValueIndicator={false} hidePlaceholderOption keepOpenOnSelect title={summary || fields.scopePlaceholder} aria-label={fields.scope}
    onChange={(event) => { if (event.target.value) onChange(toggleScopeCode(value, event.target.value as ConsentRecipientScope)); }}>
    <option value="">{summary || fields.scopePlaceholder}</option>
    {CONSENT_RECIPIENT_SCOPES.map((code) => <option key={code} value={code}>{scopeOptionLabel(code, lang)}</option>)}
  </NativeComboboxSelect>;
}

const typed = (person: RecipientDraft) => Boolean(person.name.trim() || person.relation || person.contact.trim() || person.scopeCodes.length > 0);

/**
 * `showErrors` (after "Next" or a tab could not save the choice) marks each
 * missing or wrong entry at its field; a contact that is neither a phone
 * number nor an e-mail address is named as soon as the field is left.
 */
export function TrustedPersonsEditor({ persons, onChange, lang, disabled = false, showErrors = false }: {
  persons: readonly RecipientDraft[]; onChange: (persons: RecipientDraft[]) => void; lang: string; disabled?: boolean; showErrors?: boolean;
}) {
  const text = consentFormText(lang);
  const fields = trustedPersonsText(lang);
  const [leftContact, setLeftContact] = useState<ReadonlySet<number>>(() => new Set());
  const update = (index: number, patch: Partial<RecipientDraft>) => onChange(persons.map((person, at) => at === index ? { ...person, ...patch } : person));
  // An empty row is no person (it is dropped on saving) unless it is the only one.
  const anyTyped = persons.some(typed);
  const problemsOf = (person: RecipientDraft, index: number): ReadonlySet<RecipientField> => {
    const all = recipientProblems(person);
    if (showErrors && (typed(person) || !anyTyped)) return new Set(all);
    return new Set(leftContact.has(index) && !contactValid(person.contact) ? ["contact"] : []);
  };
  const message = (field: RecipientField, problems: ReadonlySet<RecipientField>, index: number) => problems.has(field)
    ? <p className="text-destructive" role="alert" id={`trusted-person-${field}-${index}-error`} data-testid={`trusted-person-${field}-error`}>
      {{ name: fields.nameRequired, relation: fields.relationRequired, contact: fields.contactInvalid, scope: fields.scopeRequired }[field]}
    </p>
    : null;
  const removeAt = (index: number) => {
    onChange(persons.filter((_, at) => at !== index));
    setLeftContact((current) => new Set([...current].filter((at) => at !== index).map((at) => (at > index ? at - 1 : at))));
  };
  return <div className="space-y-3" data-testid="trusted-persons-editor">
    {persons.length === 0 ? <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-muted/25 px-3 py-4 text-sm text-muted-foreground"><UserRound aria-hidden="true" className="size-4 shrink-0" /><p>{fields.empty}</p></div> : null}
    {persons.map((person, index) => {
      const problems = problemsOf(person, index);
      const describedBy = (field: RecipientField) => (problems.has(field) ? `trusted-person-${field}-${index}-error` : undefined);
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
      <label className="min-w-0 space-y-1.5 text-xs"><span className="text-muted-foreground">{fields.contact}</span>
        <Input className={inputClass} value={person.contact} maxLength={120} disabled={disabled} autoComplete="off" aria-invalid={problems.has("contact") || undefined} aria-describedby={describedBy("contact")}
          onBlur={() => setLeftContact((current) => (current.has(index) ? current : new Set(current).add(index)))}
          onChange={(event) => update(index, { contact: event.target.value })} />
        {message("contact", problems, index)}
      </label>
      <div className="min-w-0 space-y-1.5 text-xs sm:col-span-2"><label htmlFor={`trusted-person-scope-${index}`} className="text-muted-foreground">{fields.scope}</label>
        <ScopeSelect id={`trusted-person-scope-${index}`} value={person.scopeCodes} lang={lang} disabled={disabled} invalid={problems.has("scope") || (person.scopeCodes.length === 0 && Boolean(person.scope.trim()))}
          onChange={(scopeCodes) => update(index, { scopeCodes })} />
        {person.scopeCodes.length === 0 && person.scope.trim()
          ? <p className="text-amber-700 dark:text-amber-400" data-testid="trusted-person-scope-legacy">{fields.scopeLegacy(person.scope.trim())}</p>
          : message("scope", problems, index) ?? <p className="text-muted-foreground">{fields.scopeHint}</p>}
      </div>
      </div>
    </div>;
    })}
    {persons.length < MAX_CONSENT_RECIPIENTS ? <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg" disabled={disabled} data-testid="trusted-person-add" onClick={() => onChange([...persons, { name: "", relation: "", contact: "", scope: "", scopeCodes: [] }])}>
      <Plus aria-hidden="true" className="size-3.5" />{text.addRecipient}
    </Button> : <p className="text-xs text-muted-foreground" data-testid="trusted-person-max">{fields.maxReached}</p>}
  </div>;
}
