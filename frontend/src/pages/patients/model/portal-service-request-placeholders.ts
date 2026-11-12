import type { Lang } from "@/lib/i18n";

export type ServiceRequestPlaceholders = {
  title: string;
  vendor: string;
  notes: string;
};

type PlaceholderKey =
  | "hotel"
  | "transfer"
  | "vip_terminal"
  | "flight"
  | "chauffeur"
  | "translation_support"
  | "restaurant"
  | "tickets"
  | "other";

const PLACEHOLDERS: Record<Lang, Record<PlaceholderKey, ServiceRequestPlaceholders>> = {
  ru: {
    hotel: {
      title: "Отель у аэропорта",
      vendor: "Название отеля",
      notes: "Даты заезда, номер, предпочтения по отелю...",
    },
    transfer: {
      title: "Трансфер из аэропорта",
      vendor: "Трансферная компания",
      notes: "Число пассажиров, детское кресло, особые пожелания...",
    },
    chauffeur: {
      title: "Водитель на день",
      vendor: "Компания или водитель",
      notes: "Маршрут, остановки, число пассажиров...",
    },
    vip_terminal: {
      title: "VIP-терминал при вылете",
      vendor: "Аэропорт или VIP-сервис",
      notes: "Номер рейса, число пассажиров, багаж...",
    },
    flight: {
      title: "Перелёт в Германию",
      vendor: "Авиакомпания",
      notes: "Маршрут, класс, багаж, гибкость по датам...",
    },
    translation_support: {
      title: "Переводчик на встречу",
      vendor: "Переводчик или бюро",
      notes: "Язык, место, продолжительность...",
    },
    restaurant: {
      title: "Ужин в ресторане",
      vendor: "Название ресторана",
      notes: "Повод, пожелания по столику...",
    },
    tickets: {
      title: "Билеты в театр",
      vendor: "Театр, концертный зал или касса",
      notes: "Желаемые места, бюджет на билет...",
    },
    other: {
      title: "Что вам нужно",
      vendor: "Компания или место",
      notes: "Подробности запроса...",
    },
  },
  de: {
    hotel: {
      title: "Hotelübernachtung am Flughafen",
      vendor: "Name des Hotels",
      notes: "Anreise und Abreise, Zimmer, Hotelwünsche...",
    },
    transfer: {
      title: "Transfer vom Flughafen",
      vendor: "Transferfirma",
      notes: "Anzahl der Fahrgäste, Kindersitz, besondere Wünsche...",
    },
    chauffeur: {
      title: "Fahrer für einen Tag",
      vendor: "Firma oder Fahrer",
      notes: "Route, Zwischenstopps, Anzahl der Fahrgäste...",
    },
    vip_terminal: {
      title: "VIP-Terminal beim Abflug",
      vendor: "Flughafen oder VIP-Service",
      notes: "Flugnummer, Anzahl der Reisenden, Gepäck...",
    },
    flight: {
      title: "Flug nach Deutschland",
      vendor: "Fluglinie",
      notes: "Strecke, Klasse, Gepäck, flexible Daten...",
    },
    translation_support: {
      title: "Dolmetscher für einen Termin",
      vendor: "Dolmetscher oder Büro",
      notes: "Sprache, Ort, Dauer...",
    },
    restaurant: {
      title: "Abendessen im Restaurant",
      vendor: "Name des Restaurants",
      notes: "Anlass, Wünsche zum Tisch...",
    },
    tickets: {
      title: "Theaterkarten",
      vendor: "Theater, Konzerthaus oder Vorverkaufsstelle",
      notes: "Gewünschte Plätze, Budget pro Karte...",
    },
    other: {
      title: "Was Sie brauchen",
      vendor: "Firma oder Ort",
      notes: "Einzelheiten der Anfrage...",
    },
  },
};

/**
 * Placeholders of the portal request form that fit what is requested: the
 * kind with own fields (restaurant, tickets, a ride) first, then the service
 * type. A transfer request no longer shows the hotel example (release QA
 * 2026-11-13, A7).
 */
export function serviceRequestPlaceholders(
  serviceKind: string,
  detailsKind: string | null | undefined,
  lang: Lang,
): ServiceRequestPlaceholders {
  const table = PLACEHOLDERS[lang] ?? PLACEHOLDERS.ru;
  if (detailsKind === "restaurant" || detailsKind === "tickets") return table[detailsKind];
  if (serviceKind in table) return table[serviceKind as PlaceholderKey];
  if (detailsKind === "transfer") return table.transfer;
  return table.other;
}
