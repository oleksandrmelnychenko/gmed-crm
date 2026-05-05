export interface SharedCoreTranslations {
  admin_guide_open: string;
  admin_guide_table_toolbar: string;
  admin_guide_filter_hint: string;
  admin_guide_sort_hint: string;
  admin_guide_columns_hint: string;
  admin_guide_density_hint: string;
  admin_guide_column_width: string;
  admin_guide_column_width_hint: string;
  common_detail: string;
  table_filter_days_suffix: string;
  topbar_language_toggle: string;
  topbar_online_users: string;
  topbar_realtime_connected: string;
  topbar_realtime_connecting: string;
  topbar_realtime_reconnecting: string;
  topbar_realtime_disconnected: string;
}

export const sharedCoreRu: SharedCoreTranslations = {
  admin_guide_open: "Гайд",
  admin_guide_table_toolbar: "Панель таблицы",
  admin_guide_filter_hint:
    "фильтрация по любой колонке (текст/список/дата/число).",
  admin_guide_sort_hint:
    "многоступенчатая сортировка; клик по заголовку - быстрый переключатель, Shift+клик - добавить.",
  admin_guide_columns_hint:
    "видимость и закрепление слева (до 3 закрепленных).",
  admin_guide_density_hint: "высота строк: свободно / компактно / плотно.",
  admin_guide_column_width: "Ширина колонок",
  admin_guide_column_width_hint:
    "перетяните правый край заголовка; сохраняется в браузере.",
  common_detail: "Детали",
  table_filter_days_suffix: " дн.",
  topbar_language_toggle: "Переключить язык",
  topbar_online_users: "Пользователи онлайн",
  topbar_realtime_connected: "Realtime подключен",
  topbar_realtime_connecting: "Realtime подключается...",
  topbar_realtime_reconnecting: "Realtime переподключается ({attempt})",
  topbar_realtime_disconnected: "Realtime отключен",
};

export const sharedCoreDe: SharedCoreTranslations = {
  admin_guide_open: "Anleitung",
  admin_guide_table_toolbar: "Tabellen-Toolbar",
  admin_guide_filter_hint:
    "beliebige Spalte filtern (Text/Auswahl/Datum/Zahl).",
  admin_guide_sort_hint:
    "mehrstufige Sortierung; Klick auf Spaltenkopf - schnelles Umschalten, Shift+Klick - hinzufügen.",
  admin_guide_columns_hint:
    "Sichtbarkeit und Fixierung links (max. 3 fixierte).",
  admin_guide_density_hint: "Zeilenhöhe: komfortabel / kompakt / dicht.",
  admin_guide_column_width: "Spaltenbreite",
  admin_guide_column_width_hint:
    "rechte Kante des Headers ziehen; wird im Browser gespeichert.",
  common_detail: "Details",
  table_filter_days_suffix: " T.",
  topbar_language_toggle: "Sprache wechseln",
  topbar_online_users: "Benutzer online",
  topbar_realtime_connected: "Realtime verbunden",
  topbar_realtime_connecting: "Realtime verbindet...",
  topbar_realtime_reconnecting: "Realtime verbindet erneut ({attempt})",
  topbar_realtime_disconnected: "Realtime getrennt",
};
