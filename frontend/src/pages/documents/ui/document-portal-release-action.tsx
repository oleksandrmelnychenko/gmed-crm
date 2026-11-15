import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { toast } from "@/components/ui/toast";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import type { DocumentItem } from "../model/types";
import { releaseDocumentToPortal } from "../data/document-api";

type ReleaseState = Pick<DocumentItem, "patient_id" | "has_active_patient_portal_user" | "has_active_portal_release" | "status">;

/**
 * «Передать клиенту»: releases a patient's document to the patient portal with
 * the release of the documents screen (`POST /documents/:id/portal-release`;
 * the server checks the role, the document ACL and the patient's portal
 * account). A new version of a released document already follows its
 * predecessor (`release_new_version_like_predecessor`): then it only says that
 * the document is in the client's portal. Nothing happens without the click.
 */
export function DocumentPortalReleaseAction({ documentId, onReleased }: { documentId: string; onReleased?: () => void }) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const [state, setState] = useState<ReleaseState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<DocumentItem>(`/documents/${documentId}`, { forceFresh: true })
      .then((document) => { if (!cancelled) setState(document); })
      // Without the document's state the button stays away; the documents screen still releases it.
      .catch(() => { if (!cancelled) setState(null); });
    return () => { cancelled = true; };
  }, [documentId]);

  if (!state || !state.patient_id || state.status === "archived") return null;
  if (state.has_active_portal_release) {
    return (
      <StatusChip tone="success" data-testid="document-in-client-portal">
        <CheckCircle2 aria-hidden="true" />
        {tx("В кабинете клиента", "Im Kundenportal")}
      </StatusChip>
    );
  }
  if (!state.has_active_patient_portal_user) {
    return (
      <StatusChip tone="neutral" title={tx("У пациента нет активного доступа в кабинет.", "Der Patient hat keinen aktiven Portalzugang.")}>
        {tx("Нет доступа в кабинет", "Kein Portalzugang")}
      </StatusChip>
    );
  }

  async function release() {
    setBusy(true);
    try {
      await releaseDocumentToPortal(documentId);
      clearApiCache("/documents");
      clearApiCache("/patients");
      setState((current) => (current ? { ...current, has_active_portal_release: true } : current));
      toast.success(tx("Документ передан в кабинет клиента.", "Dokument ins Kundenportal freigegeben."));
      onReleased?.();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : tx("Не удалось передать документ клиенту.", "Das Dokument konnte nicht freigegeben werden."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" className="shrink-0 gap-1.5" disabled={busy} aria-busy={busy} data-testid="document-release-to-client" onClick={() => void release()}>
      {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Send aria-hidden="true" className="size-3.5" />}
      {tx("Передать клиенту", "An den Kunden übergeben")}
    </Button>
  );
}
