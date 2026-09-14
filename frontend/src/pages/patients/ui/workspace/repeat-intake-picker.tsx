import { useEffect, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  discardRepeatIntake,
  fetchRepeatIntakes,
  type RepeatIntakeSummary,
} from "../../data/repeat-intakes-api";

function repeatCreationKey(patientId: string) {
  const storageKey = `gmed:repeat-intake:pending:${patientId}`;
  try {
    const previous = localStorage.getItem(storageKey);
    if (previous) return previous;
    const key = crypto.randomUUID();
    localStorage.setItem(storageKey, key);
    return key;
  } catch { return crypto.randomUUID(); }
}

export function RepeatIntakePicker({ patientId, lang, onPick, onClose }: {
  patientId: string; lang: string; onPick: (leadId: string | null, creationKey?: string) => void; onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<RepeatIntakeSummary[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<RepeatIntakeSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;

  useEffect(() => {
    let active = true;
    setError(""); setDrafts(null);
    void fetchRepeatIntakes(patientId).then(items => {
      if (!active) return;
      if (!items.length) onPick(null, repeatCreationKey(patientId));
      else {
        try { localStorage.removeItem(`gmed:repeat-intake:pending:${patientId}`); } catch { /* Storage is optional. */ }
        if (items.length === 1) onPick(items[0].id);
        else setDrafts(items);
      }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [attempt, onPick, patientId]);

  async function deleteDraft() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await discardRepeatIntake(deleteTarget.id);
      setDrafts(current => current?.filter(item => item.id !== deleteTarget.id) ?? current);
      setDeleteTarget(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleteBusy(false);
    }
  }

  return <>
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{tx("Повторное обращение", "Erneute Anfrage")}</DialogTitle></DialogHeader>
        {error ? <div role="alert" className="space-y-3 text-sm text-destructive">{error}<Button variant="outline" onClick={() => setAttempt(value => value + 1)}>{tx("Повторить", "Erneut versuchen")}</Button></div>
          : !drafts ? <p role="status" className="text-sm text-muted-foreground">{tx("Проверяем сохранённые обращения…", "Gespeicherte Anfragen werden geprüft…")}</p>
          : drafts.length === 0 ? <p className="rounded-lg border p-4 text-sm text-muted-foreground">{tx("Сохранённых черновиков нет.", "Keine gespeicherten Entwürfe vorhanden.")}</p>
          : <div className="overflow-hidden rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="p-3 text-left font-medium">{tx("Сохранённые обращения", "Gespeicherte Anfragen")}</th><th /></tr></thead><tbody>{drafts.map(item => <tr key={item.id} className="border-t"><td className="p-3"><div>{item.concern || tx("Черновик обращения", "Anfrageentwurf")}</div><div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleDateString(lang === "de" ? "de-DE" : "ru-RU")}</div></td><td className="p-3"><div className="flex flex-wrap justify-end gap-2"><Button
            type="button"
            variant="destructive"
            size="sm"
            aria-label={`${tx("Удалить черновик", "Entwurf löschen")}: ${item.concern || tx("Черновик обращения", "Anfrageentwurf")}`}
            onClick={() => {
              setDeleteError("");
              setDeleteTarget(item);
            }}
          ><Trash2 aria-hidden="true" />{tx("Удалить", "Löschen")}</Button><Button size="sm" onClick={() => onPick(item.id)}>{tx("Продолжить", "Fortsetzen")}</Button></div></td></tr>)}</tbody></table></div>}
        <DialogFooter><Button variant="outline" onClick={onClose}>{tx("Отмена", "Abbrechen")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      open={Boolean(deleteTarget)}
      onOpenChange={open => {
        if (!open && !deleteBusy) {
          setDeleteTarget(null);
          setDeleteError("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tx("Удалить черновик?", "Entwurf löschen?")}</DialogTitle>
          <DialogDescription>
            {tx(
              "Черновик будет удалён из списка. Это действие нельзя отменить.",
              "Der Entwurf wird aus der Liste entfernt. Diese Aktion kann nicht rückgängig gemacht werden.",
            )}
          </DialogDescription>
        </DialogHeader>
        {deleteError ? <p role="alert" className="text-sm text-destructive">{deleteError}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>
            {tx("Отмена", "Abbrechen")}
          </Button>
          <Button type="button" variant="destructive" disabled={deleteBusy} onClick={() => void deleteDraft()}>
            {deleteBusy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Trash2 aria-hidden="true" />}
            {tx("Удалить черновик", "Entwurf löschen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
