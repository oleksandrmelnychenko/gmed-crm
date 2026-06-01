import type { Lang } from "@/lib/i18n";

type LocalizedText = { label: string; description: string };

/**
 * Localized (de/ru) names + descriptions for the reusable document text blocks.
 * The backend (DOCUMENT_TEXT_BLOCKS) only serves English label/description; these
 * are UI chrome, so they are localized client-side like the other document codes.
 * Keyed by the text-block `key`; falls back to the API value when a key is unknown.
 */
const TEXT_BLOCK_LABELS: Record<string, Record<Lang, LocalizedText>> = {
  fasting: {
    de: {
      label: "Nüchtern erscheinen",
      description:
        "Verwenden, wenn der Patient vor Diagnostik oder Eingriff nüchtern bleiben muss.",
    },
    ru: {
      label: "Натощак",
      description:
        "Используйте, если перед диагностикой или вмешательством пациент должен быть натощак.",
    },
  },
  bring_documents: {
    de: {
      label: "Originaldokumente mitbringen",
      description:
        "Erinnerung, Reisepass, Vorbefunde und Kostenübernahme-/Zahlungsnachweise mitzubringen.",
    },
    ru: {
      label: "Взять оригиналы документов",
      description:
        "Напоминание взять паспорт, прежние заключения и подтверждения оплаты/страхового покрытия.",
    },
  },
  morning_medication: {
    de: {
      label: "Hinweis zur Morgenmedikation",
      description:
        "Erinnerung, die übliche Medikamenteneinnahme vor dem Termin abzustimmen.",
    },
    ru: {
      label: "Заметка об утренних лекарствах",
      description: "Напоминание согласовать обычный приём лекарств перед визитом.",
    },
  },
  payment_clearance: {
    de: {
      label: "Zahlungs- bzw. Kostenfreigabe",
      description:
        "Erinnerung an Vorauszahlung, Kostenübernahme oder Bestätigung des Kostenvoranschlags.",
    },
    ru: {
      label: "Подтверждение оплаты или покрытия",
      description:
        "Напоминание о предоплате, согласовании покрытия или подтверждении сметы.",
    },
  },
  interpreter_briefing: {
    de: {
      label: "Dolmetscher-Abstimmung",
      description:
        "Erinnerung, dass ein Dolmetscher oder Koordinator den Patienten vor dem Termin briefen wird.",
    },
    ru: {
      label: "Координация переводчика",
      description:
        "Напоминание, что переводчик или координатор проведёт инструктаж пациента перед визитом.",
    },
  },
  contract_scope_clause: {
    de: {
      label: "Leistungsumfang der Agentur",
      description:
        "Definiert den Koordinationsumfang der Agentur im Rahmen des Rahmendienstleistungsvertrags.",
    },
    ru: {
      label: "Объём услуг агентства",
      description:
        "Определяет объём координации со стороны агентства в рамках рамочного договора.",
    },
  },
  quote_reference_clause: {
    de: {
      label: "Bezug auf Kostenvoranschlag",
      description:
        "Stellt klar, dass konkrete kommerzielle Positionen durch den verknüpften Kostenvoranschlag geregelt werden.",
    },
    ru: {
      label: "Ссылка на смету",
      description:
        "Уточняет, что конкретные коммерческие позиции регулируются связанной сметой.",
    },
  },
  cost_passthrough_clause: {
    de: {
      label: "Weitergabe externer Kosten",
      description: "Erläutert externe durchgereichte Kosten und die Erstattungslogik.",
    },
    ru: {
      label: "Передача внешних расходов",
      description: "Поясняет передаваемые внешние расходы и логику возмещения.",
    },
  },
  privacy_contract_clause: {
    de: {
      label: "Hinweis zur Datenverarbeitung",
      description: "Kurzer vertraglicher Hinweis zu Datenschutz und Vertraulichkeit.",
    },
    ru: {
      label: "Уведомление об обработке данных",
      description:
        "Краткое договорное уведомление о конфиденциальности и защите данных.",
    },
  },
  doctor_changes_only: {
    de: {
      label: "Änderungen nur durch den Arzt",
      description:
        "Erinnert den Patienten, dass Medikamentenänderungen ärztlich bestätigt werden müssen.",
    },
    ru: {
      label: "Изменения только врачом",
      description:
        "Напоминает пациенту, что изменения в лекарствах требуют подтверждения врача.",
    },
  },
  carry_updated_list: {
    de: {
      label: "Diese Liste mitführen",
      description:
        "Erinnerung, die aktuelle Medikamentenliste bei Terminen und auf Reisen mitzuführen.",
    },
    ru: {
      label: "Носите этот список с собой",
      description:
        "Напоминание держать актуальный список лекарств при визитах и в поездках.",
    },
  },
  temporary_medication_review: {
    de: {
      label: "Überprüfung befristeter Medikation",
      description:
        "Erinnerung, befristete Verordnungen und Absetzdaten erneut zu prüfen.",
    },
    ru: {
      label: "Проверка временных назначений",
      description:
        "Напоминание перепроверить временные назначения и даты отмены.",
    },
  },
};

export function localizeTextBlock(
  key: string,
  lang: Lang,
  fallback: { label: string; description: string },
): LocalizedText {
  const entry = TEXT_BLOCK_LABELS[key]?.[lang];
  return {
    label: entry?.label || fallback.label,
    description: entry?.description || fallback.description,
  };
}
