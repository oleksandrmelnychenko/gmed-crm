import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Pencil, Plus, UsersRound } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";
import { fetchSignatureDefaults, saveSignatureDefaults, validSigners, type Signer } from "../data/document-signature-api";
import { SignatureSignerFields } from "./signature-signer-fields";

export function SignatureDefaultsSettings() {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [saved, setSaved] = useState<Signer[]>([]);
  const [draft, setDraft] = useState<Signer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState(false);
  const [revision, setRevision] = useState(0);
  const saving = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void fetchSignatureDefaults().then(value => {
      if (!cancelled) { setSaved(value.signers); setDraft(value.signers); setError(false); }
    }).catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(false); setNotice(false);
    try {
      const next = await saveSignatureDefaults(draft);
      setSaved(next.signers); setDraft(next.signers); setEditing(false); setNotice(true);
    } catch { setError(true); }
    finally { saving.current = false; setBusy(false); }
  }
  const add = () => setDraft(current => [...current, { first_name: "", last_name: "", email: "", role: "agency" }]);
  return <section className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card">
    <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3.5 py-2.5">
      <AdminSectionTitle>{tx("Представители GMED", "GMED-Vertretungen")}</AdminSectionTitle><UsersRound aria-hidden="true" className="size-4 text-muted-foreground" />
    </div>
    <form onSubmit={event => void save(event)}>
      <div className="space-y-3 p-3.5">
        <p className="text-xs leading-5 text-muted-foreground">{tx("Настройте подписантов со стороны GMED один раз — они будут подставляться в новые запросы. Клиент подставляется из связанной карточки. Перед отправкой всех подписантов можно изменить.", "Hinterlegen Sie die GMED-Vertretungen einmal für neue Signaturanfragen. Kundendaten werden aus der verknüpften Karte übernommen. Vor dem Versand können Sie alle Personen anpassen.")}</p>
        {loading ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{tx("Загрузка…", "Wird geladen…")}</p>
          : editing ? <>
            {draft.map((signer, index) => <SignatureSignerFields key={index} signer={signer} index={index} agencyOnly disabled={busy} onChange={patch => setDraft(current => current.map((item, n) => n === index ? { ...item, ...patch } : item))} onRemove={() => setDraft(current => current.filter((_, n) => n !== index))} />)}
            {draft.length < 5 ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={add}><Plus className="size-3.5" />{tx("Добавить представителя", "Vertretung hinzufügen")}</Button> : null}
          </> : saved.length ? <div className="grid gap-2">{saved.map(signer => <div key={signer.email} className="min-w-0 rounded-md border border-border/60 bg-muted/15 px-3 py-2">
            <p className="break-words text-sm font-medium">{signer.first_name} {signer.last_name}</p><p className="break-all text-xs leading-5 text-muted-foreground">{signer.email}</p>
          </div>)}</div> : !error ? <p className="rounded-md bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">{tx("Представители пока не настроены. Их можно указать здесь или вручную в запросе подписи.", "Noch keine Vertretungen hinterlegt. Sie können diese hier oder direkt in einer Signaturanfrage eintragen.")}</p> : null}
        {notice ? <p role="status" className="text-xs text-emerald-700">{tx("Представители сохранены для новых запросов.", "Vertretungen für neue Anfragen gespeichert.")}</p> : null}
        {error ? <p role="alert" className="text-xs leading-5 text-destructive">{tx("Не удалось загрузить или сохранить представителей. Проверьте данные и повторите.", "Vertretungen konnten nicht geladen oder gespeichert werden. Angaben prüfen und erneut versuchen.")}</p> : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 bg-muted/20 px-3.5 py-3">
        {editing ? <>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setDraft(saved); setEditing(false); setError(false); }}>{tx("Отменить изменения", "Änderungen verwerfen")}</Button>
          <Button type="submit" size="sm" disabled={busy || (draft.length > 0 && !validSigners(draft)) || JSON.stringify(saved) === JSON.stringify(draft)}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}{tx("Сохранить представителей", "Vertretungen speichern")}</Button>
        </> : error ? <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => { setLoading(true); setRevision(value => value + 1); }}>{tx("Повторить", "Erneut versuchen")}</Button>
          : <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => { setDraft(saved.length ? saved : [{ first_name: "", last_name: "", email: "", role: "agency" }]); setEditing(true); setNotice(false); }}><Pencil className="size-3.5" />{tx("Настроить представителей", "Vertretungen einrichten")}</Button>}
      </div>
    </form>
  </section>;
}
