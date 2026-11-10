import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { LeadRequestPage } from "@/pages/patient-lead/lead-request-page";

import { hasCapability } from "@/lib/permissions";

import { fetchLeadDetail } from "./data/leads-api";
import { leadErrorMessage } from "./model/leads-model";

/**
 * Why the client's form cannot be opened for this lead, known before the form
 * itself asks the server (QA 2026-11-10): a role that does not fill it in and
 * a lead that already has its patient both ended in «Не удалось загрузить
 * заявку. Повторить», which a retry never helps.
 */
type Refusal =
  | { kind: "forbidden" }
  | { kind: "converted"; patientId: string }
  | { kind: "error"; error: unknown };

/**
 * `/leads/{id}/client-form`: the client's cabinet form, filled in by staff
 * from the wizard (owner decision 2026-10-29).
 */
export function LeadClientFormPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const { user } = useAuth();
  const { lang } = useLang();
  const { staffGo } = useStaffNavigate();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  // The server's rule (`require_cabinet_editor`): who edits leads and reads medical data.
  // The second half is read from the lead itself (`medical_fields_hidden`), below.
  const mayFill = hasCapability(user, "leads.edit");
  const [state, setState] = useState<{ leadId: string; refusal: Refusal | null } | null>(null);

  useEffect(() => {
    if (!leadId || !mayFill) return undefined;
    let active = true;
    fetchLeadDetail(leadId)
      .then((lead) => {
        if (!active) return;
        setState({
          leadId,
          refusal: lead.converted_patient_id
            ? { kind: "converted", patientId: lead.converted_patient_id }
            // The server sends this role the lead without its medical content: the form is closed to it.
            : lead.medical_fields_hidden === true
              ? { kind: "forbidden" }
              : null,
        });
      })
      .catch((error: unknown) => {
        if (active) setState({ leadId, refusal: { kind: "error", error } });
      });
    return () => {
      active = false;
    };
  }, [leadId, mayFill]);

  if (!leadId) return null;
  const refusal: Refusal | null = !mayFill
    ? { kind: "forbidden" }
    : state?.leadId === leadId ? state.refusal : null;
  if (mayFill && state?.leadId !== leadId) {
    return (
      <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        {tx("Загрузка…", "Wird geladen…")}
      </div>
    );
  }
  if (!refusal) return <LeadRequestPage staffLeadId={leadId} />;
  return (
    <div className="space-y-3" data-testid="lead-client-form-refused" data-reason={refusal.kind}>
      <Banner tone={refusal.kind === "error" ? "error" : "warning"} withIcon>
        {refusal.kind === "forbidden"
          ? tx(
            "Анкету клиента за клиента заполняют менеджер пациентов или CEO. У вашей роли этого права нет.",
            "Das Formular des Kunden füllen das Patientenmanagement oder der CEO für den Kunden aus. Ihre Rolle hat dieses Recht nicht.",
          )
          : refusal.kind === "converted"
            ? tx(
              "Пациент по этой заявке уже создан: анкета закрыта, данные меняются в карточке пациента.",
              "Zu dieser Anfrage wurde bereits ein Patient angelegt: Das Formular ist geschlossen, die Daten werden in der Patientenakte geändert.",
            )
            : leadErrorMessage(refusal.error, tx)}
      </Banner>
      <div className="flex flex-wrap gap-2">
        {refusal.kind === "converted" ? (
          <Button type="button" size="sm" onClick={() => staffGo(`/patients/${encodeURIComponent(refusal.patientId)}`)}>
            {tx("Открыть карточку пациента", "Patientenakte öffnen")}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" onClick={() => staffGo("/leads")}>
          {tx("К списку лидов", "Zur Lead-Liste")}
        </Button>
      </div>
    </div>
  );
}
