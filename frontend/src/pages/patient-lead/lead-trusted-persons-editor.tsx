import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { inputClass, selectClass } from "@/components/record-workspace/primitives/design-tokens";
import { CONSENT_RECIPIENT_RELATIONS, MAX_CONSENT_RECIPIENTS, type ConsentRecipient, type ConsentRecipientRelation } from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import type { RecipientDraft } from "./lead-trusted-persons-model";
import { trustedPersonsText } from "./lead-trusted-persons-text";

export function TrustedPersonsList({ persons, lang }: { persons: readonly ConsentRecipient[]; lang: string }) {
  const text = consentFormText(lang);
  return <ul className="space-y-2 text-sm" data-testid="trusted-persons-list">
    {persons.map((person, index) => <li key={index} className="break-words rounded-lg border border-border/60 bg-card px-3 py-2">
      <span className="font-medium">{person.name}</span>{" · "}{text.recipientRelations[person.relation] ?? text.recipientRelations.other}
      {person.contact ? <span className="text-muted-foreground"> · {person.contact}</span> : null}
    </li>)}
  </ul>;
}

export function TrustedPersonsEditor({ persons, onChange, lang, disabled = false }: {
  persons: readonly RecipientDraft[]; onChange: (persons: RecipientDraft[]) => void; lang: string; disabled?: boolean;
}) {
  const text = consentFormText(lang);
  const update = (index: number, patch: Partial<RecipientDraft>) => onChange(persons.map((person, at) => at === index ? { ...person, ...patch } : person));
  return <div className="space-y-3" data-testid="trusted-persons-editor">
    {persons.length === 0 ? <p className="text-sm text-muted-foreground">{trustedPersonsText(lang).empty}</p> : null}
    {persons.map((person, index) => <div key={index} className="grid gap-3 rounded-xl border border-border/60 bg-card p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" data-testid="trusted-person-editor">
      <label className="space-y-1 text-xs"><span className="text-muted-foreground">{text.recipientName}</span>
        <Input className={inputClass} value={person.name} maxLength={120} disabled={disabled} autoComplete="off" onChange={(event) => update(index, { name: event.target.value })} />
      </label>
      <label className="space-y-1 text-xs"><span className="text-muted-foreground">{text.recipientRelation}</span>
        <NativeComboboxSelect className={selectClass} value={person.relation} disabled={disabled} onChange={(event) => update(index, { relation: event.target.value as ConsentRecipientRelation | "" })}>
          <option value="">—</option>{CONSENT_RECIPIENT_RELATIONS.map((relation) => <option key={relation} value={relation}>{text.recipientRelations[relation]}</option>)}
        </NativeComboboxSelect>
      </label>
      <label className="space-y-1 text-xs"><span className="text-muted-foreground">{text.recipientContact}</span>
        <Input className={inputClass} value={person.contact} maxLength={120} disabled={disabled} autoComplete="off" onChange={(event) => update(index, { contact: event.target.value })} />
      </label>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={text.removeRecipient} title={text.removeRecipient} onClick={() => onChange(persons.filter((_, at) => at !== index))}><Trash2 aria-hidden="true" className="size-4" /></Button>
    </div>)}
    {persons.length < MAX_CONSENT_RECIPIENTS ? <Button type="button" variant="outline" size="sm" disabled={disabled} data-testid="trusted-person-add" onClick={() => onChange([...persons, { name: "", relation: "", contact: "" }])}>
      <Plus aria-hidden="true" className="size-4" />{text.addRecipient}
    </Button> : null}
  </div>;
}
