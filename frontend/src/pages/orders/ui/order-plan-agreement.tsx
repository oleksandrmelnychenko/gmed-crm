import { SectionHeading } from "@/components/ui/section-heading";
import { useEffect, useRef, useState } from "react";
import { CalendarCheck2, FileText, LoaderCircle } from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { buttonVariants } from "@/components/ui/button";
import { fetchDocuments, generateDocument } from "@/pages/documents/data/document-api";
import type { DocumentItem } from "@/pages/documents/model/types";

import { updateOrderPlanningPreparation } from "../data/order-api";
import {
  PLAN_AGREEMENT_STATUS,
  planAgreementSteps,
  planChangedSince,
  planNotePayload,
} from "../model/order-plan-agreement";
import type { TreatmentPlanStatus } from "../model/types";

type OrderPlanAgreementProps = {
  orderId: string;
  patientId: string | null | undefined;
  lang: string;
  status: TreatmentPlanStatus;
  note: string | null | undefined;
  /** Who set the current status and when (planning payload). */
  statusUpdatedAt?: string | null;
  statusUpdatedByName?: string | null;
  /** Creation time of the newest appointment of the plan. */
  appointmentsLastAddedAt?: string | null;
  /** CEO or patient manager on an open order: may generate the PDF and record steps. */
  canEdit: boolean;
  reloadNonce: number;
  onChanged: () => void;
};

const BUTTON = buttonVariants({ size: "sm" });

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
          data-slot="button" data-variant="default" data-size="sm" className={BUTTON}
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
  statusUpdatedAt,
  statusUpdatedByName,
  appointmentsLastAddedAt,
  canEdit,
  reloadNonce,
  onChanged,
}: OrderPlanAgreementProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const [planDocument, setPlanDocument] = useState<DocumentItem | null>(null);
  const [noteDraft, setNoteDraft] = useState(note ?? "");
  const [busy, setBusy] = useState<"pdf" | "step" | null>(null);
  // Set synchronously: a double click must not record a step twice before
  // the disabled buttons render.
  const busyRef = useRef(false);
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
    if (!patientId || busyRef.current) return;
    busyRef.current = true;
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
        created_at: new Date().toISOString(),
      } as DocumentItem);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const recordStep = async (next: TreatmentPlanStatus) => {
    if (busyRef.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
      setBusy(null);
    }
  };

  const { pdfStale, statusStale } = planChangedSince({
    status,
    statusUpdatedAt,
    pdfCreatedAt: planDocument?.created_at,
    appointmentsLastAddedAt,
  });
  const statusLabel = statusInfo ? (de ? statusInfo.de : statusInfo.ru) : status;
  const statusSetLine =
    status !== "draft" && statusUpdatedAt
      ? [
          tx("Статус установил", "Status gesetzt von"),
          statusUpdatedByName || tx("сотрудник", "Mitarbeiter"),
          formatAppDateTime(statusUpdatedAt) || statusUpdatedAt,
        ].join(" ")
      : null;

  const documentHref = planDocument
    ? `/documents?order_id=${encodeURIComponent(orderId)}&document=${encodeURIComponent(planDocument.id)}`
    : null;

  return (
    <div data-testid="order-plan-agreement" className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3><SectionHeading icon={CalendarCheck2}>{tx("План для пациента", "Plan für den Patienten")}</SectionHeading></h3>
        <StatusBadge tone={statusInfo?.tone ?? "neutral"}>{statusLabel}</StatusBadge>
      </div>
      {statusSetLine ? (
        <p data-testid="order-plan-status-set" className="mt-1 text-xs text-muted-foreground">
          {statusSetLine}
        </p>
      ) : null}

      <div className="mt-2 space-y-2">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {pdfStale || statusStale ? (
          <div
            data-testid="order-plan-changed"
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"
          >
            {statusStale
              ? tx(
                  `После статуса «${statusLabel}» в план добавлены приёмы. Проверьте, нужно ли снова согласовать план с пациентом.`,
                  `Nach dem Status „${statusLabel}“ kamen Termine zum Plan hinzu. Prüfen Sie, ob der Plan erneut abgestimmt werden muss.`,
                )
              : null}
            {statusStale && pdfStale ? " " : null}
            {pdfStale
              ? tx(
                  "PDF плана сформирован до последних приёмов: обновите PDF.",
                  "Das Plan-PDF ist älter als die neuesten Termine: PDF aktualisieren.",
                )
              : null}
          </div>
        ) : null}

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
                data-slot="button" data-variant="default" data-size="sm" className={BUTTON}
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
