import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { useLang } from "@/lib/i18n";
import type { Signer, SignerPolicy, SignerRole } from "../data/document-signature-api";

/** Roles a signer can take for the package's signer policy. */
export function rolesForPolicy(policy: SignerPolicy = "flexible"): SignerRole[] {
  if (policy === "agency_only") return ["agency"];
  if (policy === "client_only") return ["client", "minor"];
  if (policy === "both_parties") return ["client", "minor", "agency"];
  if (policy === "payer_and_agency") return ["payer", "agency"];
  if (policy === "client_payer_and_agency") return ["client", "minor", "payer", "agency"];
  return ["client", "minor", "payer", "agency", "other"];
}

export function SignatureSignerFields({ signer, index, disabled, agencyOnly, embedded, policy, onChange, onRemove }: {
  signer: Signer; index: number; disabled?: boolean; agencyOnly?: boolean; embedded?: boolean; policy?: SignerPolicy;
  onChange: (patch: Partial<Signer>) => void; onRemove?: () => void;
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const labels: Record<SignerRole, string> = {
    client: tx("Пациент / законный представитель", "Patient/in / gesetzliche Vertretung"),
    minor: tx("Несовершеннолетний пациент (с ~14 лет, по желанию)", "Minderjährige/r Patient/in (ab ca. 14 J., optional)"),
    payer: tx("Плательщик (принимает расходы)", "Kostenübernehmer"),
    agency: tx("Представитель агентства", "Agenturvertretung"),
    other: tx("Другая сторона", "Weitere Partei"),
  };
  const roles = rolesForPolicy(policy);
  return <fieldset disabled={disabled} className={embedded ? "grid min-w-0 gap-3" : "grid min-w-0 gap-3 rounded-lg border border-border/70 bg-muted/10 p-3"}>
    <legend className={embedded ? "sr-only" : "px-2 text-xs font-semibold"}>{agencyOnly ? tx("Представитель GMED", "GMED-Vertretung") : tx("Подписант", "Unterzeichnende Person")} {index + 1}</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">{tx("Имя", "Vorname")}<Input className="h-9 bg-field font-normal text-foreground" maxLength={120} autoComplete="off" value={signer.first_name} onChange={e => onChange({ first_name: e.target.value })} /></label>
      <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">{tx("Фамилия", "Nachname")}<Input className="h-9 bg-field font-normal text-foreground" maxLength={120} autoComplete="off" value={signer.last_name} onChange={e => onChange({ last_name: e.target.value })} /></label>
    </div>
    <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">E-Mail<Input className="h-9 bg-field font-normal text-foreground" type="email" maxLength={254} autoComplete="off" value={signer.email} onChange={e => onChange({ email: e.target.value })} /></label>
    {!agencyOnly && roles.length > 1 ? <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">{tx("Роль", "Rolle")}<NativeComboboxSelect className="h-9 bg-field text-sm font-normal text-foreground" value={signer.role} onChange={e => onChange({ role: e.target.value as SignerRole })}>
      {roles.map(role => <option key={role} value={role}>{labels[role]}</option>)}
    </NativeComboboxSelect></label> : null}
    {onRemove ? <div className="flex justify-end border-t border-border/60 pt-2"><Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={onRemove}><Trash2 aria-hidden="true" className="size-3.5" />{tx("Удалить подписанта", "Person entfernen")}</Button></div> : null}
  </fieldset>;
}
