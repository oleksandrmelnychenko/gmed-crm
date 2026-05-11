import { Button } from "@/components/ui/button";

type PatientsShortcutsDialogProps = {
  open: boolean;
  closeLabel: string;
  onClose: () => void;
};

export function PatientsShortcutsDialog({
  open,
  closeLabel,
  onClose,
}: PatientsShortcutsDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30">
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl"
      >
        <h2 className="mb-3 text-sm font-semibold">Keyboard shortcuts</h2>
        <ul className="space-y-1.5 text-xs">
          <li><kbd className="rounded border border-border px-1.5 py-0.5">/</kbd> Focus search</li>
          <li><kbd className="rounded border border-border px-1.5 py-0.5">↑</kbd> / <kbd className="rounded border border-border px-1.5 py-0.5">↓</kbd> Navigate rows</li>
          <li><kbd className="rounded border border-border px-1.5 py-0.5">Enter</kbd> Open in split pane</li>
          <li><kbd className="rounded border border-border px-1.5 py-0.5">Shift</kbd> + click header Multi-sort</li>
          <li><kbd className="rounded border border-border px-1.5 py-0.5">Esc</kbd> Close pane</li>
        </ul>
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
