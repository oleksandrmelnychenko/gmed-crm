import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { useLang } from "@/lib/i18n";
import type { Signer } from "../data/document-signature-api";

export function SignatureSignerFields({ signer, index, disabled, agencyOnly, embedded, onChange, onRemove }: {
  signer: Signer; index: number; disabled?: boolean; agencyOnly?: boolean; embedded?: boolean;
  onChange: (patch: Partial<Signer>) => void; onRemove?: () => void;
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  return <fieldset disabled={disabled} className={embedded ? "grid min-w-0 gap-3" : "grid min-w-0 gap-3 rounded-lg border border-border/70 bg-muted/10 p-3"}>
    <legend className={embedded ? "sr-only" : "px-2 text-xs font-semibold"}>{agencyOnly ? tx("Представитель GMED", "GMED-Vertretung") : tx("Подписант", "Unterzeichnende Person")} {index + 1}</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">{tx("Имя", "Vorname")}<Input className="h-9 bg-field font-normal text-foreground" maxLength={120} autoComplete="off" value={signer.first_name} onChange={e => onChange({ first_name: e.target.value })} /></label>
      <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">{tx("Фамилия", "Nachname")}<Input className="h-9 bg-field font-normal text-foreground" maxLength={120} autoComplete="off" value={signer.last_name} onChange={e => onChange({ last_name: e.target.value })} /></label>
    </div>
    <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">E-Mail<Input className="h-9 bg-field font-normal text-foreground" type="email" maxLength={254} autoComplete="off" value={signer.email} onChange={e => onChange({ email: e.target.value })} /></label>
    {!agencyOnly ? <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">{tx("Роль", "Rolle")}<NativeComboboxSelect className="h-9 bg-field text-sm font-normal text-foreground" value={signer.role} onChange={e => onChange({ role: e.target.value as Signer["role"] })}>
      <option value="client">{tx("Клиент / представитель клиента", "Kunde / Kundenvertretung")}</option>
      <option value="agency">{tx("Представитель агентства", "Agenturvertretung")}</option>
      <option value="other">{tx("Другая сторона", "Weitere Partei")}</option>
    </NativeComboboxSelect></label> : null}
    {onRemove ? <div className="flex justify-end border-t border-border/60 pt-2"><Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={onRemove}><Trash2 aria-hidden="true" className="size-3.5" />{tx("Удалить подписанта", "Person entfernen")}</Button></div> : null}
  </fieldset>;
}
