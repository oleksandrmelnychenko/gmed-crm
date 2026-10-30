import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPen, LoaderCircle, RotateCcw } from "lucide-react";

import { Banner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PayerQuestionnaire } from "@/pages/payer-link/payer-link-api";
import { PayerLinkForm } from "@/pages/payer-link/payer-link-form";
import { payerLinkText } from "@/pages/payer-link/payer-link-text";

import {
  asPayerLinkError,
  createStaffPayerClient,
  fetchStaffPayerQuestionnaire,
  reopenStaffPayerQuestionnaire,
  type StaffPayerQuestionnaire,
} from "../data/lead-payer-paper-questionnaire-api";
import type { Tx } from "../model/lead-payer";

/**
 * Staff transcribe the payer's signed paper Selbstauskunft into the payer's
 * own questionnaire (owner rule 2026-10-29, DEV QA 2026-10-30): the payer
 * page's form, bound to staff's routes. What is sent counts like the payer's
 * own send — risk blocks C/D, the GwG sheet, the payer's documents — and is
 * marked «внёс сотрудник».
 */
export function LeadPayerPaperQuestionnaireDialog({
  leadId,
  lang,
  tx,
  errorText,
  onChanged,
  onClose,
}: {
  leadId: string;
  lang: "de" | "ru";
  tx: Tx;
  errorText: (error: unknown) => string;
  /** The answers changed on the server: the wizard reads the payer afresh. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const client = useMemo(() => createStaffPayerClient(leadId), [leadId]);
  const text = useMemo(() => payerLinkText(lang), [lang]);
  const [questionnaire, setQuestionnaire] = useState<StaffPayerQuestionnaire | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const changedRef = useRef(false);

  useEffect(() => {
    let active = true;
    fetchStaffPayerQuestionnaire(leadId)
      .then((next) => { if (active) setQuestionnaire(next); })
      .catch((cause) => { if (active) setError(errorText(cause)); });
    return () => { active = false; };
  }, [leadId, errorText]);

  const changed = useCallback((next: PayerQuestionnaire) => {
    setQuestionnaire(next as StaffPayerQuestionnaire);
    changedRef.current = true;
  }, []);

  const close = () => {
    if (changedRef.current) onChanged();
    onClose();
  };

  async function reopen() {
    setBusy(true);
    setError("");
    try {
      changed(await reopenStaffPayerQuestionnaire(leadId));
    } catch (cause) {
      setError(errorText(asPayerLinkError(cause)));
    } finally {
      setBusy(false);
    }
  }

  const submitted = questionnaire?.state === "submitted";
  return (
    <Dialog open dirty={false} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:w-[calc(100vw-3rem)] sm:max-w-3xl" aria-describedby={undefined} data-testid="lead-payer-paper-questionnaire-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardPen className="size-5 text-[var(--brand)]" />
            {tx("Ответы плательщика с бумажной анкеты", "Angaben des Zahlers vom Papierfragebogen")}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[75vh] space-y-4 overflow-y-auto bg-muted/30 p-4 sm:p-5">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200" data-testid="lead-payer-paper-questionnaire-hint">
            {tx(
              "Перенесите ответы из подписанной плательщиком Selbstauskunft — так, как их отметил плательщик. Отправленные ответы считаются как анкета по ссылке и помечаются «внёс сотрудник».",
              "Übertragen Sie die Angaben aus der vom Zahler unterschriebenen Selbstauskunft – so, wie der Zahler sie angekreuzt hat. Gesendete Angaben zählen wie der Fragebogen über den Link und werden als „von GMED erfasst“ markiert.",
            )}
          </p>
          {error ? <Banner tone="error">{error}</Banner> : null}
          {questionnaire ? (
            <div className="rounded-xl border bg-card p-4" lang={lang}>
              <PayerLinkForm
                questionnaire={questionnaire}
                client={client}
                text={text}
                lang={lang}
                onQuestionnaire={changed}
                onLinkProblem={() => setError(tx("Анкета сейчас недоступна — обновите страницу", "Fragebogen derzeit nicht verfügbar – Seite neu laden"))}
              />
            </div>
          ) : !error ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{tx("Загрузка…", "Wird geladen…")}</p>
          ) : null}
        </div>
        <DialogFooter>
          {submitted ? (
            <Button type="button" variant="outline" disabled={busy} data-testid="lead-payer-paper-questionnaire-reopen" onClick={() => void reopen()}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              {tx("Исправить ответы", "Angaben korrigieren")}
            </Button>
          ) : null}
          <Button type="button" onClick={close}>{tx("Готово", "Fertig")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
