/**
 * Russian and German wording for the messages the personnel API and its
 * database triggers answer with (`crates/server/src/routes/personnel/`,
 * `migrations/20260930120000_personnel_files.sql`). Unknown messages pass
 * through unchanged.
 */

type Localized = { ru: string; de: string };

const NOT_FOUND: Localized = { ru: "Не найдено.", de: "Nicht gefunden." };
const FAILED: Localized = {
  ru: "Не удалось выполнить действие. Попробуйте ещё раз.",
  de: "Die Aktion ist fehlgeschlagen. Bitte erneut versuchen.",
};
const TYPES: Localized = {
  ru: "Подходят только PDF, JPEG, PNG, BMP и TIFF.",
  de: "Erlaubt sind nur PDF, JPEG, PNG, BMP und TIFF.",
};
const IMMUTABLE: Localized = {
  ru: "Сохранённый документ нельзя изменить — добавьте исправленную версию.",
  de: "Ein archiviertes Dokument kann nicht geändert werden – bitte eine korrigierte Version hinzufügen.",
};

const PERSONNEL_ERRORS: Record<string, Localized> = {
  Forbidden: { ru: "Недостаточно прав.", de: "Keine Berechtigung." },
  "Personnel file request failed": FAILED,
  "Employee not found": { ru: "Сотрудник не найден.", de: "Mitarbeitende(r) nicht gefunden." },
  "Document not found": { ru: "Документ не найден.", de: "Dokument nicht gefunden." },
  "Category not found": { ru: "Категория не найдена.", de: "Kategorie nicht gefunden." },
  "Profile document not found": { ru: "Документ профиля не найден.", de: "Profildokument nicht gefunden." },
  "Anchor not found": NOT_FOUND,
  "No personnel file": { ru: "К вашему аккаунту не привязано личное дело.", de: "Mit Ihrem Konto ist keine Personalakte verknüpft." },
  "Scan not found or already handled": {
    ru: "Скан не найден или уже обработан.",
    de: "Scan nicht gefunden oder bereits bearbeitet.",
  },
  "The scan has already been handled": { ru: "Скан уже обработан.", de: "Der Scan wurde bereits bearbeitet." },
  "No file uploaded": { ru: "Файл не выбран.", de: "Keine Datei ausgewählt." },
  "Failed to read file": { ru: "Не удалось прочитать файл.", de: "Die Datei konnte nicht gelesen werden." },
  "File too large": { ru: "Файл больше 25 МБ.", de: "Die Datei ist größer als 25 MB." },
  "Only PDF, JPEG, PNG, BMP and TIFF files are accepted": TYPES,
  "Uploaded file content does not match the declared MIME type or filename extension": {
    ru: "Содержимое файла не соответствует его формату.",
    de: "Der Dateiinhalt passt nicht zum Dateiformat.",
  },
  "Choose a category": { ru: "Выберите категорию.", de: "Bitte eine Kategorie wählen." },
  "Unknown category": { ru: "Неизвестная категория.", de: "Unbekannte Kategorie." },
  "Choose the month (YYYY-MM) of the document": { ru: "Выберите месяц документа.", de: "Bitte den Monat des Dokuments wählen." },
  "Enter the document date (YYYY-MM-DD)": { ru: "Укажите дату документа.", de: "Bitte das Dokumentdatum angeben." },
  "The document date lies too far in the future": {
    ru: "Дата документа слишком далеко в будущем.",
    de: "Das Dokumentdatum liegt zu weit in der Zukunft.",
  },
  "Unknown document to correct": { ru: "Исправляемый документ не найден.", de: "Das zu korrigierende Dokument wurde nicht gefunden." },
  "The document belongs to another personnel file": {
    ru: "Документ относится к другому личному делу.",
    de: "Das Dokument gehört zu einer anderen Personalakte.",
  },
  "A correction needs a reason": { ru: "Укажите причину исправления.", de: "Bitte einen Korrekturgrund angeben." },
  "A deleted document cannot be corrected": {
    ru: "Удалённый документ нельзя исправить.",
    de: "Ein gelöschtes Dokument kann nicht korrigiert werden.",
  },
  "Only the newest version of a document can be corrected": {
    ru: "Исправить можно только последнюю версию документа.",
    de: "Nur die neueste Version eines Dokuments kann korrigiert werden.",
  },
  "This document has already been corrected": {
    ru: "У этого документа уже есть новая версия.",
    de: "Für dieses Dokument gibt es bereits eine neue Version.",
  },
  "A document with this name was archived at the same time; try again": {
    ru: "Одновременно сохранён документ с тем же именем. Повторите попытку.",
    de: "Gleichzeitig wurde ein Dokument mit demselben Namen archiviert. Bitte erneut versuchen.",
  },
  "Too many documents with the same name in this file": {
    ru: "В деле слишком много документов с одинаковым именем.",
    de: "Zu viele Dokumente mit demselben Namen in dieser Akte.",
  },
  "This profile document is already in the personnel file": {
    ru: "Этот документ из профиля уже есть в деле.",
    de: "Dieses Profildokument ist bereits in der Akte.",
  },
  "The personnel file is not linked to an account with a profile": {
    ru: "Дело не привязано к аккаунту с профилем переводчика.",
    de: "Die Akte ist mit keinem Konto mit Dolmetscherprofil verknüpft.",
  },
  "The stored document fails its integrity check": {
    ru: "Сохранённый файл не прошёл проверку целостности. CEO получил уведомление.",
    de: "Die gespeicherte Datei hat die Integritätsprüfung nicht bestanden.",
  },
  "The scanned file fails its integrity check": {
    ru: "Скан не прошёл проверку целостности.",
    de: "Der Scan hat die Integritätsprüfung nicht bestanden.",
  },
  "The document was deleted after its retention period": {
    ru: "Документ удалён после окончания срока хранения.",
    de: "Das Dokument wurde nach Ablauf der Aufbewahrungsfrist gelöscht.",
  },
  "Discarding a scan needs a reason": { ru: "Укажите причину.", de: "Bitte eine Begründung angeben." },
  "A deletion needs a reason": { ru: "Укажите причину удаления.", de: "Bitte einen Löschgrund angeben." },
  "Deleting personnel documents is disabled until the retention periods are confirmed": {
    ru: "Удаление выключено, пока Steuerberater не подтвердит сроки хранения.",
    de: "Die Löschung ist ausgeschaltet, bis das Steuerbüro die Fristen bestätigt.",
  },
  "Deleting personnel documents is disabled": {
    ru: "Удаление выключено в настройках.",
    de: "Die Löschung ist in den Einstellungen ausgeschaltet.",
  },
  "The retention period of this personnel document has not ended": {
    ru: "Срок хранения этого документа ещё не истёк.",
    de: "Die Aufbewahrungsfrist dieses Dokuments ist noch nicht abgelaufen.",
  },
  "A personnel document under legal hold cannot be deleted": {
    ru: "На документ установлен запрет удаления.",
    de: "Für das Dokument gilt eine Löschsperre.",
  },
  "The stored file could not be removed; nothing was deleted, try again": {
    ru: "Не удалось удалить файл; ничего не изменено. Повторите попытку.",
    de: "Die Datei konnte nicht entfernt werden; nichts wurde gelöscht. Bitte erneut versuchen.",
  },
  "Archived personnel documents cannot be changed": IMMUTABLE,
  "A deleted personnel document cannot be changed": IMMUTABLE,
  "Personnel documents cannot be deleted": IMMUTABLE,
  "A deleted document cannot get a new version": {
    ru: "Удалённый документ нельзя исправить.",
    de: "Ein gelöschtes Dokument kann nicht korrigiert werden.",
  },
  "Last name is required": { ru: "Укажите фамилию.", de: "Bitte den Nachnamen angeben." },
  "Unknown salutation": { ru: "Неизвестное обращение.", de: "Unbekannte Anrede." },
  "Unknown user": { ru: "Аккаунт не найден.", de: "Konto nicht gefunden." },
  "Only staff accounts can be linked to a personnel file": {
    ru: "Привязать можно только аккаунт сотрудника.",
    de: "Nur Mitarbeiterkonten können verknüpft werden.",
  },
  "This personnel number is already used": {
    ru: "Этот персональный номер уже занят.",
    de: "Diese Personalnummer ist bereits vergeben.",
  },
  "This user already has a personnel file": {
    ru: "У этого аккаунта уже есть личное дело.",
    de: "Dieses Konto hat bereits eine Personalakte.",
  },
  "Employment end is before its start": {
    ru: "Дата увольнения не может быть раньше даты приёма.",
    de: "Der Austritt darf nicht vor dem Eintritt liegen.",
  },
  "Employment start must be a date (YYYY-MM-DD)": { ru: "Неверная дата приёма.", de: "Ungültiges Eintrittsdatum." },
  "Employment end must be a date (YYYY-MM-DD)": { ru: "Неверная дата увольнения.", de: "Ungültiges Austrittsdatum." },
  "Retention must be between 1 and 50 years": { ru: "Укажите срок от 1 до 50 лет.", de: "Bitte 1 bis 50 Jahre angeben." },
  "Late threshold must be between 0 and 60 days": {
    ru: "Срок сдачи — от 0 до 60 дней.",
    de: "Die Abgabefrist muss zwischen 0 und 60 Tagen liegen.",
  },
  "The time-stamping authority needs an http(s) URL": {
    ru: "Укажите адрес сервиса, начинающийся с http:// или https://.",
    de: "Bitte eine Adresse mit http:// oder https:// angeben.",
  },
  "From must be YYYY-MM": { ru: "Неверный начальный месяц.", de: "Ungültiger Anfangsmonat." },
  "To must be YYYY-MM": { ru: "Неверный конечный месяц.", de: "Ungültiger Endmonat." },
  "The range starts after it ends": { ru: "Начальный месяц позже конечного.", de: "Der Anfangsmonat liegt nach dem Endmonat." },
  "No personnel file matches the export": {
    ru: "Нет личных дел для выгрузки.",
    de: "Keine Personalakten für den Export.",
  },
  "The export is larger than 1 GB; choose fewer employees or a shorter period": {
    ru: "Выгрузка больше 1 ГБ: выберите меньше сотрудников или короче период.",
    de: "Der Export ist größer als 1 GB: weniger Mitarbeitende oder einen kürzeren Zeitraum wählen.",
  },
  "The archive is empty; nothing to anchor": {
    ru: "В архиве ещё нет документов.",
    de: "Das Archiv enthält noch keine Dokumente.",
  },
  "This anchor has no time stamp yet": {
    ru: "У этой отметки ещё нет подписи TSA.",
    de: "Für diesen Zeitstempel liegt noch keine TSA-Signatur vor.",
  },
  "last name has no usable characters": {
    ru: "Фамилия не содержит букв, пригодных для имени файла.",
    de: "Der Nachname enthält keine für den Dateinamen nutzbaren Zeichen.",
  },
  "file type is not allowed": TYPES,
  "archive file name does not fit 64 characters": {
    ru: "Имя файла не помещается в 64 символа.",
    de: "Der Dateiname passt nicht in 64 Zeichen.",
  },
};

/** The message in the UI language, or the message itself when unknown. */
export function localizePersonnelError(message: string, lang: string): string {
  if (!Object.hasOwn(PERSONNEL_ERRORS, message)) return message;
  const localized = PERSONNEL_ERRORS[message];
  return lang === "de" ? localized.de : localized.ru;
}
