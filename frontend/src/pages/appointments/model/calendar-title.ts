import type { Lang } from "@/lib/i18n";

/** A calendar day as FullCalendar hands it to a title formatter (month 0-based). */
export type CalendarTitleDay = { year: number; month: number; day: number };

const RU_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
// "5–11 октября": a day of the month takes the genitive.
const RU_MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const DE_MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** "Октябрь 2026" / "Oktober 2026" – not the browser's "окт. 2026 г.". */
export function calendarMonthTitle(date: CalendarTitleDay, lang: Lang): string {
  return `${(lang === "ru" ? RU_MONTHS : DE_MONTHS)[date.month]} ${date.year}`;
}

function dayAndMonth(date: CalendarTitleDay, lang: Lang) {
  return lang === "ru"
    ? `${date.day} ${RU_MONTHS_GENITIVE[date.month]}`
    : `${date.day}. ${DE_MONTHS[date.month]}`;
}

/** "11 октября 2026" / "11. Oktober 2026". */
export function calendarDayTitle(date: CalendarTitleDay, lang: Lang): string {
  return `${dayAndMonth(date, lang)} ${date.year}`;
}

/**
 * The title of a week (or any range, last day inclusive):
 * "5–11 октября 2026", "28 сентября – 4 октября 2026",
 * "29 декабря 2026 – 4 января 2027"; German "5.–11. Oktober 2026".
 */
export function calendarRangeTitle(
  start: CalendarTitleDay,
  end: CalendarTitleDay,
  lang: Lang,
): string {
  const sameYear = start.year === end.year;
  const sameMonth = sameYear && start.month === end.month;
  if (sameMonth && start.day === end.day) return calendarDayTitle(start, lang);
  if (sameMonth) {
    return lang === "ru"
      ? `${start.day}–${end.day} ${RU_MONTHS_GENITIVE[end.month]} ${end.year}`
      : `${start.day}.–${end.day}. ${DE_MONTHS[end.month]} ${end.year}`;
  }
  if (sameYear) {
    return `${dayAndMonth(start, lang)} – ${dayAndMonth(end, lang)} ${end.year}`;
  }
  return `${calendarDayTitle(start, lang)} – ${calendarDayTitle(end, lang)}`;
}

type TitleFormatterArg = { start: CalendarTitleDay; end?: CalendarTitleDay };

/** Per-view `titleFormat` options for FullCalendar in the UI language. */
export function appointmentCalendarTitleViews(lang: Lang) {
  const range = (arg: TitleFormatterArg) => calendarRangeTitle(arg.start, arg.end ?? arg.start, lang);
  return {
    dayGridMonth: { titleFormat: (arg: TitleFormatterArg) => calendarMonthTitle(arg.start, lang) },
    timeGridWeek: { titleFormat: range },
    listWeek: { titleFormat: range },
    timeGridDay: { titleFormat: (arg: TitleFormatterArg) => calendarDayTitle(arg.start, lang) },
  };
}
