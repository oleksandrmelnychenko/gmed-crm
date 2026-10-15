import { Plus, Trash2, UserRound } from "lucide-react";
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
      {person.scope ? <p className="mt-1 text-muted-foreground">{person.scope}</p> : null}
    </li>)}
  </ul>;
}

export function TrustedPersonsEditor({ persons, onChange, lang, disabled = false }: {
  persons: readonly RecipientDraft[]; onChange: (persons: RecipientDraft[]) => void; lang: string; disabled?: boolean;
}) {
  const text = consentFormText(lang);
  const fields = trustedPersonsText(lang);
  const update = (index: number, patch: Partial<RecipientDraft>) => onChange(persons.map((person, at) => at === index ? { ...person, ...patch } : person));
  return <div className="space-y-3" data-testid="trusted-persons-editor">
    {persons.length === 0 ? <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-muted/25 px-3 py-4 text-sm text-muted-foreground"><UserRound aria-hidden="true" className="size-4 shrink-0" /><p>{fields.empty}</p></div> : null}
    {persons.map((person, index) => <div key={index} className="overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="trusted-person-editor">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium"><span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-card font-mono text-[11px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><span className="truncate">{person.name || fields.name}</span></span>
        <Button type="button" variant="ghost" size="sm" className="size-7 shrink-0 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={disabled} aria-label={text.removeRecipient} title={text.removeRecipient} onClick={() => onChange(persons.filter((_, at) => at !== index))}><Trash2 aria-hidden="true" className="size-3.5" /></Button>
      </div>
      <div className="grid gap-x-4 gap-y-3 p-3 sm:grid-cols-2">
      <label className="min-w-0 space-y-1.5 text-xs"><span className="text-muted-foreground">{fields.name}</span>
        <Input className={inputClass} value={person.name} maxLength={120} disabled={disabled} autoComplete="off" onChange={(event) => update(index, { name: event.target.value })} />
      </label>
      <label className="min-w-0 space-y-1.5 text-xs"><span className="text-muted-foreground">{fields.relation}</span>
        <NativeComboboxSelect className={selectClass} value={person.relation} disabled={disabled} onChange={(event) => update(index, { relation: event.target.value as ConsentRecipientRelation | "" })}>
          <option value="">—</option>{CONSENT_RECIPIENT_RELATIONS.map((relation) => <option key={relation} value={relation}>{text.recipientRelations[relation]}</option>)}
        </NativeComboboxSelect>
      </label>
      <label className="min-w-0 space-y-1.5 text-xs"><span className="text-muted-foreground">{fields.contact}</span>
        <Input className={inputClass} value={person.contact} maxLength={120} disabled={disabled} autoComplete="off" onChange={(event) => update(index, { contact: event.target.value })} />
      </label>
      <label className="min-w-0 space-y-1.5 text-xs"><span className="text-muted-foreground">{fields.scope}</span>
        <Input className={inputClass} value={person.scope} maxLength={240} disabled={disabled} autoComplete="off" onChange={(event) => update(index, { scope: event.target.value })} />
      </label>
      </div>
    </div>)}
    {persons.length < MAX_CONSENT_RECIPIENTS ? <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg" disabled={disabled} data-testid="trusted-person-add" onClick={() => onChange([...persons, { name: "", relation: "", contact: "", scope: "" }])}>
      <Plus aria-hidden="true" className="size-3.5" />{text.addRecipient}
    </Button> : null}
  </div>;
}
