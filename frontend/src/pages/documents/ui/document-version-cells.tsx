import { RowExpandButton } from "@/components/data-table/row-expand-button";
import { StatusChip, type StatusChipTone } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

import {
  expandVersionsLabel,
  previousVersionsOf,
  versionMarkerLabel,
  type DocumentChip,
  type VersionedDocument,
} from "../model/document-versions";

const CHIP_TONE: Record<DocumentChip["tone"], StatusChipTone> = {
  amber: "warning",
  sky: "info",
  emerald: "success",
  muted: "neutral",
};

export function DocumentStateChip({ chip, documentId, className }: { chip: DocumentChip | null; documentId: string; className?: string }) {
  if (!chip) return null;
  return (
    <StatusChip
      tone={CHIP_TONE[chip.tone]}
      className={cn("shrink-0 whitespace-nowrap px-1.5 py-0 text-[10px]", className)}
      title={chip.label}
      data-testid={`${chip.testId}-${documentId}`}
    >
      {chip.label}
    </StatusChip>
  );
}

/**
 * «v3» and the toggle that opens the earlier versions under the row (fix-98).
 * Nothing for a document without earlier versions.
 */
export function DocumentVersionToggle({
  document,
  expanded,
  onToggle,
  lang,
}: {
  document: VersionedDocument;
  expanded: boolean;
  onToggle: (id: string) => void;
  lang: string;
}) {
  const count = previousVersionsOf(document).length;
  if (count === 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5" data-testid={`document-versions-${document.id}`}>
      <RowExpandButton
        expanded={expanded}
        label={expandVersionsLabel(count, expanded, lang)}
        onToggle={() => onToggle(document.id)}
        testId={`document-versions-toggle-${document.id}`}
      />
      <span
        className="rounded-md border border-border/70 bg-muted/40 px-1 font-mono text-[10px] font-medium text-muted-foreground"
        title={expandVersionsLabel(count, false, lang)}
      >
        {versionMarkerLabel(document)} · {count + 1}
      </span>
    </span>
  );
}

/** The version label of a sub-row («v2»), indented under its document. */
export function PreviousVersionLabel({ document }: { document: VersionedDocument }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 pl-6 text-muted-foreground">
      <span aria-hidden className="font-mono text-xs">└</span>
      <span className="rounded-md border border-border/60 px-1 font-mono text-[10px]">{versionMarkerLabel(document)}</span>
    </span>
  );
}
