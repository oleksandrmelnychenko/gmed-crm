import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

type Draft = { id: string; created_at: string; concern?: string | null };
export function repeatCreationKey(patientId: string, fresh = false) {
  const storageKey = `gmed:repeat-intake:pending:${patientId}`;
  try {
    const previous = localStorage.getItem(storageKey);
    if (previous && !fresh) return previous;
    const key = crypto.randomUUID();
    localStorage.setItem(storageKey, key);
    return key;
  } catch { return crypto.randomUUID(); }
}

export function RepeatIntakePicker({ patientId, lang, onPick, onClose }: {
  patientId: string; lang: string; onPick: (leadId: string | null, creationKey?: string) => void; onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  useEffect(() => {
    let active = true;
    setError(""); setDrafts(null);
    void apiFetch<Draft[]>(`/patients/${patientId}/repeat-intakes`, {forceFresh: true}).then(items => {
      if (!active) return;
      if (!items.length) onPick(null, repeatCreationKey(patientId));
      else {
        try { localStorage.removeItem(`gmed:repeat-intake:pending:${patientId}`); } catch { /* Storage is optional. */ }
        setDrafts(items);
      }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [attempt, onPick, patientId]);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader><DialogTitle>{tx("Повторное обращение", "Erneute Anfrage")}</DialogTitle></DialogHeader>
      {error ? <div role="alert" className="space-y-3 text-sm text-destructive">{error}<Button variant="outline" onClick={() => setAttempt(value => value + 1)}>{tx("Повторить", "Erneut versuchen")}</Button></div>
        : !drafts ? <p role="status" className="text-sm text-muted-foreground">{tx("Проверяем сохранённые обращения…", "Gespeicherte Anfragen werden geprüft…")}</p>
        : <div className="overflow-hidden rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="p-3 text-left font-medium">{tx("Сохранённые обращения", "Gespeicherte Anfragen")}</th><th /></tr></thead><tbody>{drafts.map(item => <tr key={item.id} className="border-t"><td className="p-3"><div>{item.concern || tx("Черновик обращения", "Anfrageentwurf")}</div><div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleDateString(lang === "de" ? "de-DE" : "ru-RU")}</div></td><td className="p-3 text-right"><Button size="sm" onClick={() => onPick(item.id)}>{tx("Продолжить", "Fortsetzen")}</Button></td></tr>)}</tbody></table></div>}
      <DialogFooter><Button variant="outline" onClick={onClose}>{tx("Отмена", "Abbrechen")}</Button>{drafts ? <Button onClick={() => onPick(null, repeatCreationKey(patientId, true))}>{tx("Новое обращение", "Neue Anfrage")}</Button> : null}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
