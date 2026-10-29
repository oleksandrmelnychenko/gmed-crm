import { asLeadCabinetLang } from "./lead-request-text";

// Owner tasks 2026-10-29 (TASK-46F1, TASK-CD80): the start date is asked as the wished date,
// the services are «Дополнительная поддержка» with a description each, the general comment
// is «Индивидуальные пожелания». The descriptions are the website's «Подробнее» texts
// (gmed-web-site, appointment.newPatient.services.*Details); the website has none for the
// interpreter, the translation and the visa, so those are written in the same style.
const TEXT = {
  ru: {
    period: "Предпочитаемая дата начала обследования и/или лечения?", from: "Дата",
    more: "Подробнее", close: "Закрыть",
    services: "Дополнительная поддержка", notes: "Индивидуальные пожелания", comment: "Комментарий к услуге",
    optional: "Необязательно",
    options: {
      driver: "Услуги водителя и трансфер", concierge: "Консьерж-сервис",
      interpreter_support: "Сопровождение устного переводчика", document_translation: "Письменный перевод документов",
      visa_support: "Визовая поддержка", "medical-transport": "Наземный медицинский транспорт",
      "air-ambulance": "Санитарная авиация", "business-aviation": "Организация чартерных перелётов",
      none: "Ничего из перечисленного", "not-sure": "Пока не знаю",
    },
    descriptions: {
      driver: "Индивидуальная логистика с акцентом на Ваш комфорт и конфиденциальность.",
      concierge: "Ваш персональный ассистент: бронирование, подбор мероприятий, координация повседневных нужд и выполнение деликатных поручений.",
      interpreter_support: "Медицинский переводчик рядом с Вами на консультациях, обследованиях и в клинике — с глубоким пониманием медицинской терминологии.",
      document_translation: "Перевод медицинских выписок, заключений и сопутствующих материалов для немецких клиник и для Вас.",
      visa_support: "Приглашение от клиники, необходимые подтверждения и помощь с комплектом документов для визы на лечение.",
      "medical-transport": "Безопасная транспортировка пациентов, которым по состоянию здоровья требуется сопровождение медицинского персонала.",
      "air-ambulance": "Организация оперативной транспортировки пациентов с привлечением специализированных бортов и профильных медицинских бригад. Мы координируем каждый этап перелета для обеспечения безопасности и комфорта в пути.",
      "business-aviation": "Профессиональная организация перелетов на частных самолетах и вертолетах. Индивидуальные маршруты, подача борта в кратчайшие сроки и полное административное сопровождение.",
      none: "",
      "not-sure": "",
    },
  },
  uk: {
    period: "Бажана дата початку обстеження та/або лікування?", from: "Дата",
    more: "Детальніше", close: "Закрити",
    services: "Додаткова підтримка", notes: "Індивідуальні побажання", comment: "Коментар до послуги",
    optional: "Необов’язково",
    options: {
      driver: "Послуги водія та трансфер", concierge: "Консьєрж-сервіс",
      interpreter_support: "Супровід усного перекладача", document_translation: "Письмовий переклад документів",
      visa_support: "Візова підтримка", "medical-transport": "Наземний медичний транспорт",
      "air-ambulance": "Санітарна авіація", "business-aviation": "Організація чартерних перельотів",
      none: "Нічого з переліченого", "not-sure": "Поки не знаю",
    },
    descriptions: {
      driver: "Індивідуальна логістика з акцентом на Ваш комфорт і конфіденційність.",
      concierge: "Ваш персональний асистент: бронювання, добір заходів, координація повсякденних потреб і виконання делікатних доручень.",
      interpreter_support: "Медичний перекладач поруч із Вами на консультаціях, обстеженнях і в клініці — з глибоким розумінням медичної термінології.",
      document_translation: "Переклад медичних виписок, висновків і супровідних матеріалів для німецьких клінік і для Вас.",
      visa_support: "Запрошення від клініки, потрібні підтвердження та допомога з комплектом документів для візи на лікування.",
      "medical-transport": "Безпечне перевезення пацієнтів, яким за станом здоров’я потрібен супровід медичного персоналу.",
      "air-ambulance": "Організація оперативного перевезення пацієнтів із залученням спеціалізованих бортів і профільних медичних бригад. Ми координуємо кожен етап перельоту для безпеки та комфорту в дорозі.",
      "business-aviation": "Професійна організація перельотів приватними літаками й гелікоптерами. Індивідуальні маршрути, подача борту в найкоротші строки та повний адміністративний супровід.",
      none: "",
      "not-sure": "",
    },
  },
  de: {
    period: "Das Wunschdatum für den Beginn Ihrer Untersuchung und/oder Behandlung?", from: "Datum",
    more: "Mehr erfahren", close: "Schließen",
    services: "Zusätzliche Unterstützung", notes: "Individuelle Wünsche", comment: "Kommentar zur Leistung",
    optional: "Optional",
    options: {
      driver: "Fahrdienst und Transfer", concierge: "Concierge-Service",
      interpreter_support: "Begleitung durch einen Dolmetscher", document_translation: "Schriftliche Übersetzung von Dokumenten",
      visa_support: "Visumunterstützung", "medical-transport": "Bodengebundener Krankentransport",
      "air-ambulance": "Ambulanzflug", "business-aviation": "Organisation von Charterflügen",
      none: "Keine der genannten Leistungen", "not-sure": "Ich weiß es noch nicht",
    },
    descriptions: {
      driver: "Individuelle Transfers zwischen Flughafen, Klinik und Unterkunft mit abgestimmten Fahrzeiten und festem Fahrer.",
      concierge: "Ihr persönlicher Assistent: Buchungen, Veranstaltungsauswahl, Koordination des Alltags und diskrete Erledigungen.",
      interpreter_support: "Ein medizinischer Dolmetscher begleitet Sie zu Konsultationen, Untersuchungen und in der Klinik – mit fundierter Kenntnis der medizinischen Fachsprache.",
      document_translation: "Übersetzung von Arztbriefen, Befunden und Begleitunterlagen für die deutschen Kliniken und für Sie.",
      visa_support: "Einladung der Klinik, erforderliche Bestätigungen und Hilfe bei den Unterlagen für ein medizinisches Visum.",
      "medical-transport": "Medizinisch begleiteter Bodentransport, wenn ein regulärer Transfer für den Zustand des Patienten nicht ausreicht.",
      "air-ambulance": "Koordination von Ambulanzflügen für komplexere Fälle mit medizinischem Personal und entsprechender Ausrüstung an Bord.",
      "business-aviation": "Organisation privater Flüge für zeitkritische Reisen mit hoher Flexibilität, Diskretion und individueller Logistik.",
      none: "",
      "not-sure": "",
    },
  },
  en: {
    period: "Preferred start date for your examination and/or treatment?", from: "Date",
    more: "Learn more", close: "Close",
    services: "Additional support", notes: "Individual wishes", comment: "Comment on this service",
    optional: "Optional",
    options: {
      driver: "Driver and transfer services", concierge: "Concierge service",
      interpreter_support: "Interpreter accompaniment", document_translation: "Written translation of documents",
      visa_support: "Visa support", "medical-transport": "Ground medical transport",
      "air-ambulance": "Air ambulance", "business-aviation": "Charter flight arrangements",
      none: "None of these", "not-sure": "I don’t know yet",
    },
    descriptions: {
      driver: "Private airport, clinic, and hotel transfers with coordinated timing and a dedicated driver throughout your care journey.",
      concierge: "Your personal assistant: bookings, event selection, day-to-day coordination, and discreet errands.",
      interpreter_support: "A medical interpreter at your side during consultations, examinations and in the clinic, fluent in medical terminology.",
      document_translation: "Translation of medical reports, findings and supporting documents for German clinics and for you.",
      visa_support: "An invitation from the clinic, the required confirmations and help with the documents for a medical visa.",
      "medical-transport": "Medically supervised ground transport for patients who need more support than a standard transfer can provide.",
      "air-ambulance": "Air ambulance coordination for higher-acuity cases that require medical staff and equipment during transport.",
      "business-aviation": "Private aviation support for time-sensitive travel that calls for flexibility, privacy, and tailored logistics.",
      none: "",
      "not-sure": "",
    },
  },
};

export function servicesText(lang: string) { return TEXT[asLeadCabinetLang(lang) ?? "ru"]; }
