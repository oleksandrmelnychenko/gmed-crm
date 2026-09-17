import type { OrderSectionKey } from "../sections";

export type OrderPipelineStageKey =
  | "medical"
  | "care_team"
  | "appointments"
  | "execution"
  | "closure";

export type OrderPipelineStageState = "not_required" | "pending" | "active" | "done";

export type OrderPipelineStage = {
  key: OrderPipelineStageKey;
  state: OrderPipelineStageState;
  missing: string[];
};

export type OrderPipelineMedical =
  | { visible: false; required: boolean }
  | {
      visible: true;
      required: boolean;
      patient_id: string | null;
      case_id: string | null;
      case_code: string | null;
      case_status: string | null;
      anamnesis_recorded: boolean;
      treatment_plan_status: string;
      conditions: number;
      allergies: number;
      medications: number;
      operations: number;
      work_types: Array<{
        id: string;
        status: string;
        name_de: string;
        name_ru: string;
        specialization_de: string;
        specialization_ru: string;
      }>;
    };

export type OrderPipelineCareTeamMember = {
  provider_id: string;
  provider_name: string;
  provider_type: string;
  doctor_id: string | null;
  doctor_name: string | null;
  doctor_title: string | null;
  doctor_specialty: string | null;
  services: number;
  appointments: number;
};

export type OrderPipelineAppointment = {
  id: string;
  title: string;
  appointment_type: string;
  date: string;
  time_start: string | null;
  time_end: string | null;
  status: string;
  location: string | null;
  provider_name: string | null;
  doctor_name: string | null;
  interpreter_name: string | null;
  interpreter_response: string | null;
};

export type OrderPipeline = {
  order_id: string;
  phase: string;
  status: string;
  stages: OrderPipelineStage[];
  medical: OrderPipelineMedical;
  care_team: OrderPipelineCareTeamMember[];
  appointments: OrderPipelineAppointment[];
  services: { total: number; planned: number; delivered: number; approved: number; invoiced: number };
  invoices: { total: number; open: number };
};

type Localized = { de: string; ru: string };

const STAGE_LABELS: Record<OrderPipelineStageKey, Localized> = {
  medical: { de: "Medizinische Akte", ru: "Медицинская часть" },
  care_team: { de: "Anbieter und Ärzte", ru: "Провайдеры и врачи" },
  appointments: { de: "Termine", ru: "Приёмы" },
  execution: { de: "Durchführung", ru: "Выполнение" },
  closure: { de: "Abschluss", ru: "Закрытие" },
};

const STATE_LABELS: Record<OrderPipelineStageState, Localized> = {
  not_required: { de: "Nicht erforderlich", ru: "Не требуется" },
  pending: { de: "Offen", ru: "Не начато" },
  active: { de: "In Arbeit", ru: "В работе" },
  done: { de: "Erledigt", ru: "Готово" },
};

const MISSING_LABELS: Record<string, Localized> = {
  case_not_linked: { de: "Medizinischer Fall ist nicht verknüpft", ru: "Медицинский кейс не привязан к заказу" },
  anamnesis_missing: { de: "Anamnese ist nicht erfasst", ru: "Анамнез не заполнен" },
  treatment_plan_not_finalized: { de: "Behandlungsplan ist nicht finalisiert", ru: "План лечения не финализирован" },
  provider_missing: { de: "Kein Anbieter ausgewählt", ru: "Провайдер не выбран" },
  doctor_missing: { de: "Kein Arzt ausgewählt", ru: "Врач не выбран" },
  appointment_missing: { de: "Noch kein Termin angelegt", ru: "Приёмы ещё не созданы" },
  appointment_unconfirmed: { de: "Es gibt unbestätigte Termine", ru: "Есть неподтверждённые приёмы" },
  nothing_to_execute: { de: "Keine Termine oder Leistungen vorhanden", ru: "Нет приёмов и услуг для выполнения" },
  appointment_not_completed: { de: "Nicht alle Termine sind abgeschlossen", ru: "Не все приёмы завершены" },
  service_not_delivered: { de: "Nicht alle Leistungen sind erbracht", ru: "Не все услуги оказаны" },
  service_not_invoiced: { de: "Nicht alle Leistungen sind abgerechnet", ru: "Не все услуги выставлены в счёт" },
  invoice_unpaid: { de: "Es gibt offene Rechnungen", ru: "Есть неоплаченные счета" },
  order_not_completed: { de: "Auftrag ist noch nicht abgeschlossen", ru: "Заказ ещё не завершён" },
};

const pick = (value: Localized, lang: string) => (lang === "de" ? value.de : value.ru);

export const pipelineStageLabel = (key: OrderPipelineStageKey, lang: string) =>
  pick(STAGE_LABELS[key], lang);

export const pipelineStateLabel = (state: OrderPipelineStageState, lang: string) =>
  pick(STATE_LABELS[state], lang);

export const pipelineMissingLabel = (reason: string, lang: string) =>
  MISSING_LABELS[reason] ? pick(MISSING_LABELS[reason], lang) : reason;

/** The stage the team should work on now: the first one that is neither done nor skipped. */
export function currentPipelineStage(stages: OrderPipelineStage[]): OrderPipelineStageKey | null {
  return stages.find((stage) => stage.state === "pending" || stage.state === "active")?.key ?? null;
}

/** Order section where the work of a pipeline stage is actually done. */
export function pipelineStageSection(key: OrderPipelineStageKey): OrderSectionKey {
  switch (key) {
    case "medical":
    case "appointments":
      return "planning";
    case "care_team":
      return "services";
    case "execution":
      return "execution";
    case "closure":
      return "invoices";
  }
}
