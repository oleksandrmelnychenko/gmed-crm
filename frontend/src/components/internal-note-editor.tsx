import { useEffect, useState } from "react";
import { LoaderCircle, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Banner, textareaClass, tokens } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { INTERNAL_NOTE_MAX_LENGTH } from "@/lib/internal-note";

/**
 * The staff-only internal note of a quote or an invoice (owner 2026-10-12).
 * Unlike the printed customer remark it is never printed, never copied into
 * invoices and never shown to the patient or a payer, so it stays editable
 * after an invoice is released. It is saved on its own, without touching the
 * document.
 */
export function InternalNoteEditor({
  value,
  canEdit,
  onSave,
  onDirtyChange,
  testId = "internal-note",
}: {
  value: string | null | undefined;
  canEdit: boolean;
  onSave: (note: string) => Promise<void>;
  /** Reports unsaved edits, so the sheet's close guard can ask first. */
  onDirtyChange?: (dirty: boolean) => void;
  testId?: string;
}) {
  const { t } = useLang();
  const stored = value ?? "";
  const [draft, setDraft] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A reloaded record (another save, realtime refresh) replaces the draft.
  useEffect(() => {
    setDraft(stored);
    setError(null);
  }, [stored]);

  const dirty = canEdit && draft.trim() !== stored.trim();
  const tooLong = draft.trim().length > INTERNAL_NOTE_MAX_LENGTH;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // A closed or replaced editor holds no unsaved note any more.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  async function save() {
    if (!dirty || busy || tooLong) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(draft);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.common_error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5" data-testid={testId}>
      <h2 className={`${tokens.text.sectionTitle} flex items-center gap-1.5`}>
        <Lock className="size-3.5 text-muted-foreground" aria-hidden />
        {t.finance_internal_note}
      </h2>
      <p className="text-xs leading-5 text-muted-foreground">{t.finance_internal_note_hint}</p>
      {canEdit ? (
        <>
          <textarea
            className={textareaClass}
            value={draft}
            maxLength={INTERNAL_NOTE_MAX_LENGTH}
            aria-label={t.finance_internal_note}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
            }}
            disabled={busy}
          />
          {tooLong ? (
            <p role="alert" className="text-xs text-destructive">{t.finance_internal_note_too_long}</p>
          ) : null}
          {error ? <Banner tone="error">{error}</Banner> : null}
          <div className="flex items-center justify-end gap-3">
            {saved && !dirty ? (
              <span role="status" className="text-xs text-muted-foreground">
                {t.finance_internal_note_saved}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!dirty || busy || tooLong}
              onClick={() => void save()}
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t.finance_internal_note_save}
            </Button>
          </div>
        </>
      ) : (
        <div className="whitespace-pre-line rounded-xl border border-dashed border-border bg-background/60 p-3.5 text-sm leading-snug text-muted-foreground">
          {stored || t.finance_internal_note_empty}
        </div>
      )}
    </div>
  );
}
