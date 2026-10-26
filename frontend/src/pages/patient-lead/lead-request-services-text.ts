import { asLeadCabinetLang } from "./lead-request-text";

const TEXT = {
  ru: {
    period: "Период программы", from: "Начало программы",
    services: "Запрошенные услуги", notes: "Общий комментарий", comment: "Комментарий к услуге",
    optional: "Необязательно",
    options: {
      driver: "Услуги водителя и трансфер", concierge: "Консьерж-сервис",
      interpreter_support: "Поддержка переводчика", "medical-transport": "Наземный медицинский транспорт",
      "air-ambulance": "Санитарная авиация", "business-aviation": "Организация чартерных перелётов",
      none: "Ничего из перечисленного", "not-sure": "Пока не знаю",
    },
  },
  uk: {
    period: "Період програми", from: "Початок програми",
    services: "Потрібні послуги", notes: "Загальний коментар", comment: "Коментар до послуги",
    optional: "Необов’язково",
    options: {
      driver: "Послуги водія та трансфер", concierge: "Консьєрж-сервіс",
      interpreter_support: "Підтримка перекладача", "medical-transport": "Наземний медичний транспорт",
      "air-ambulance": "Санітарна авіація", "business-aviation": "Організація чартерних перельотів",
      none: "Нічого з переліченого", "not-sure": "Поки не знаю",
    },
  },
  de: {
    period: "Programmzeitraum", from: "Programmbeginn",
    services: "Gewünschte Leistungen", notes: "Allgemeiner Kommentar", comment: "Kommentar zur Leistung",
    optional: "Optional",
    options: {
      driver: "Fahrdienst und Transfer", concierge: "Concierge-Service",
      interpreter_support: "Dolmetscherunterstützung", "medical-transport": "Bodengebundener Krankentransport",
      "air-ambulance": "Ambulanzflug", "business-aviation": "Organisation von Charterflügen",
      none: "Keine der genannten Leistungen", "not-sure": "Ich weiß es noch nicht",
    },
  },
  en: {
    period: "Programme period", from: "Programme start",
    services: "Requested services", notes: "General comment", comment: "Comment on this service",
    optional: "Optional",
    options: {
      driver: "Driver and transfer services", concierge: "Concierge service",
      interpreter_support: "Interpreter support", "medical-transport": "Ground medical transport",
      "air-ambulance": "Air ambulance", "business-aviation": "Charter flight arrangements",
      none: "None of these", "not-sure": "I don’t know yet",
    },
  },
};

export function servicesText(lang: string) { return TEXT[asLeadCabinetLang(lang) ?? "ru"]; }
