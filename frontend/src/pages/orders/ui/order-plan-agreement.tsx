import { useEffect, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import { fetchDocuments, generateDocument } from "@/pages/documents/data/document-api";
import type { DocumentItem } from "@/pages/documents/model/types";

import { updateOrderPlanningPreparation } from "../data/order-api";
import {
  PLAN_AGREEMENT_STATUS,
  planAgreementSteps,
  planNotePayload,
} from "../model/order-plan-agreement";
import type { TreatmentPlanStatus } from "../model/types";

type OrderPlanAgreementProps = {
  orderId: string;
  patientId: string | null | undefined;
  lang: string;
  status: TreatmentPlanStatus;
  note: string | null | undefined;
  /** CEO or patient manager on an open order: may generate the PDF and record steps. */
  canEdit: boolean;
  reloadNonce: number;
  onChanged: () => void;
};

const BUTTON =
  "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-60";

function latestPlanDocument(documents: DocumentItem[], orderId: string) {
  return (
    documents.find(
      (doc) =>
        doc.order_id === orderId &&
        doc.generated_template_id === "treatment_plan" &&
        doc.is_latest_version &&
        doc.status !== "archived",
    ) ?? null
  );
}

/** The step buttons of the agreement; exported for the static UI test. */
export function PlanAgreementSteps({
  status,
  lang,
  busy,
  onStep,
}: {
  status: TreatmentPlanStatus;
  lang: string;
  busy: boolean;
  onStep: (status: TreatmentPlanStatus) => void;
}) {
  return (
    <>
      {planAgreementSteps(status).map((step) => (
        <button
          key={step.status}
          type="button"
          data-testid={`order-plan-step-${step.status}`}
          disabled={busy}
          onClick={() => onStep(step.status)}
          className={cn(
            BUTTON,
            step.primary
              ? "border-foreground bg-foreground text-background hover:opacity-90"
              : "border-border bg-card text-foreground hover:bg-muted",
          )}
        >
          {lang === "de" ? step.de : step.ru}
        </button>
      ))}
    </>
  );
}

/**
 * Plan for the patient in the planning section (stage 4): the treatment plan
 * PDF and the manual agreement status with its note, next to the appointment
 * list, so the plan is made, shown, sent and agreed in one place.
 */
export function OrderPlanAgreement({
  orderId,
  patientId,
  lang,
  status,
  note,
  canEdit,
  reloadNonce,
  onChanged,
}: OrderPlanAgreementProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const [planDocument, setPlanDocument] = useState<DocumentItem | null>(null);
  const [noteDraft, setNoteDraft] = useState(note ?? "");
  const [busy, setBusy] = useState<"pdf" | "step" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setNoteDraft(note ?? ""), [note]);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    fetchDocuments(`/documents?order_id=${encodeURIComponent(orderId)}`)
      .then((documents) => {
        if (!cancelled) setPlanDocument(latestPlanDocument(documents, orderId));
      })
      .catch(() => {
        if (!cancelled) setPlanDocument(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, patientId, reloadNonce]);

  const statusInfo = PLAN_AGREEMENT_STATUS[status];

  const generatePdf = async () => {
    if (!patientId) return;
    setBusy("pdf");
    setError(null);
    try {
      const created = await generateDocument({
        template_id: "treatment_plan",
        order_id: orderId,
        patient_id: patientId,
        // The treatment plan template is German only.
        language: "de",
        replace_document_id: planDocument?.id,
      });
      setPlanDocument({
        ...(planDocument ?? {}),
        id: created.id,
        order_id: orderId,
        generated_template_id: "treatment_plan",
        is_latest_version: true,
        status: "draft",
      } as DocumentItem);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const recordStep = async (next: TreatmentPlanStatus) => {
    setBusy("step");
    setError(null);
    try {
      const notePayload = planNotePayload(noteDraft, note);
      await updateOrderPlanningPreparation(orderId, {
        treatment_plan_status: next,
        ...(notePayload === undefined ? {} : { treatment_plan_note: notePayload }),
      });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const documentHref = planDocument
    ? `/documents?order_id=${encodeURIComponent(orderId)}&document=${encodeURIComponent(planDocument.id)}`
    : null;

  return (
    <div data-testid="order-plan-agreement" className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">
          {tx("План для пациента", "Plan für den Patienten")}
        </div>
        <StatusBadge tone={statusInfo?.tone ?? "neutral"}>
          {statusInfo ? (de ? statusInfo.de : statusInfo.ru) : status}
        </StatusBadge>
      </div>

      <div className="mt-3 space-y-3">
        {error ? <Banner tone="error">{error}</Banner> : null}

        {patientId ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FileText aria-hidden className="size-4 text-muted-foreground" />
            {documentHref ? (
              <StaffLink to={documentHref} className="font-medium text-foreground hover:underline">
                {tx("PDF плана лечения", "Behandlungsplan (PDF)")}
              </StaffLink>
            ) : (
              <span className="text-muted-foreground">
                {tx("PDF плана ещё не сформирован", "Noch kein Behandlungsplan als PDF")}
              </span>
            )}
            {canEdit ? (
              <button
                type="button"
                data-testid="order-plan-pdf"
                disabled={busy !== null}
                onClick={() => void generatePdf()}
                className={cn(BUTTON, "border-border bg-card text-foreground hover:bg-muted")}
              >
                {busy === "pdf" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {planDocument
                  ? tx("Обновить PDF", "PDF aktualisieren")
                  : tx("Сформировать PDF", "PDF erstellen")}
              </button>
            ) : null}
          </div>
        ) : null}

        {canEdit ? (
          <>
            <input
              type="text"
              data-testid="order-plan-note"
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              className="h-8 w-full rounded-md border border-border bg-field px-3 text-sm"
              placeholder={tx(
                "Заметка к согласованию: что ответил пациент, что поправить",
                "Notiz zur Abstimmung: Antwort des Patienten, Korrekturen",
              )}
            />
            <div className="flex flex-wrap items-center gap-2">
              <PlanAgreementSteps
                status={status}
                lang={lang}
                busy={busy !== null}
                onStep={(next) => void recordStep(next)}
              />
              {busy === "step" ? <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" /> : null}
            </div>
          </>
        ) : note ? (
          <p className="text-sm text-muted-foreground">{note}</p>
        ) : null}
      </div>
    </div>
  );
}
