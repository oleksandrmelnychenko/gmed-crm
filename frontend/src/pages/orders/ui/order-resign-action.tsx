import { useState } from "react";
import { FilePlus2, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { fetchDocuments, generateDocument } from "@/pages/documents/data/document-api";

/** Only these roles generate documents (`POST /documents/generate`). */
const GENERATING_ROLES = ["ceo", "patient_manager"];

/**
 * After a change of the signed terms reset the order signatures (QA C3-01),
 * the order needs a new Einzelauftrag for the client to sign again. This
 * makes it from the order workspace: a new version of the latest single
 * order document (or the first one), then opens it in the documents screen,
 * where it is sent for signature. The server fills the period and purpose
 * from the order.
 */
export function OrderResignAction({
  orderId,
  patientId,
  leadId,
  lang,
}: {
  orderId: string;
  patientId: string | null | undefined;
  leadId: string | null | undefined;
  lang: string;
}) {
  const { user } = useAuth();
  const { staffGo } = useStaffNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const de = lang === "de";
  if (!GENERATING_ROLES.includes(user?.role ?? "") || (!patientId && !leadId)) return null;

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      const documents = await fetchDocuments(`/documents?order_id=${encodeURIComponent(orderId)}`);
      const previous = documents.find(
        (doc) =>
          doc.order_id === orderId &&
          doc.generated_template_id === "single_order" &&
          doc.is_latest_version &&
          doc.status !== "archived",
      );
      const created = await generateDocument({
        template_id: "single_order",
        order_id: orderId,
        ...(patientId ? { patient_id: patientId } : { lead_id: leadId }),
        language: de ? "de" : "ru",
        replace_document_id: previous?.id,
      });
      staffGo(`/documents?order_id=${encodeURIComponent(orderId)}&document=${encodeURIComponent(created.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5" data-testid="order-resign-action">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void regenerate()}>
        {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <FilePlus2 aria-hidden="true" className="size-3.5" />}
        {de ? "Neue Auftragsversion zur Unterschrift erstellen" : "Создать новую версию заказа на подпись"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
