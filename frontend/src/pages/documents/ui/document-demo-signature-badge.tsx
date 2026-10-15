import { Badge } from "@/components/ui/badge";
import { StatusChip } from "@/components/ui/status-chip";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useSignatureSummary } from "../data/use-signature-summary";
import { SIGNING_ROLES } from "./document-signature-action";

/** The document's archived DEMO result, never a legal signed flag. */
export function DocumentDemoSignatureBadge({ documentId }: { documentId: string }) {
  const { user } = useAuth();
  const { lang } = useLang();
  const summary = useSignatureSummary(user && SIGNING_ROLES.includes(user.role) ? user.id : undefined, documentId);
  if (!summary?.test_mode || summary.status !== "completed" || !summary.result_document_id) return null;
  return <StatusChip tone="info" className="sm:h-5 sm:shrink-0 sm:whitespace-nowrap sm:py-0 sm:leading-none" data-testid={`document-demo-signature-${documentId}`}>
    {lang === "de" ? "DEMO · Unterzeichnet" : "DEMO · Подписано"}
  </StatusChip>;
}

/** Both states must fit the table's shortest (26 px) row without wrapping. */
export function DocumentStatusBadges({ documentId, statusLabel, statusClassName }: {
  documentId: string;
  statusLabel: string;
  statusClassName: string;
}) {
  return <div className="flex items-center gap-1.5 sm:whitespace-nowrap">
    <Badge variant="outline" className={statusClassName}>{statusLabel}</Badge>
    <DocumentDemoSignatureBadge documentId={documentId} />
  </div>;
}
