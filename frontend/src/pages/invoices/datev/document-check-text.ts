import { useLang } from "@/lib/i18n";

const ru = {
  title: "Проверка документов до подключения",
  hint: "Проверьте реальные PDF, сканы или XML через распознавание GMed. Результат не создаёт счёт и не отправляется в DATEV.",
  limits: "До 10 файлов в одной сессии: PDF, PNG, JPG до 25 МБ; XML UBL/CII до 5 МБ.",
  choose: "Выбрать документы", input: "Документы для проверки", stop: "Остановить", clear: "Очистить результаты",
  report: "Скачать отчёт проверки", empty: "Выберите документы, которые планируете импортировать.",
  session: "Результаты хранятся только до ухода с этой страницы. Проверка повторов охватывает эти файлы, а не базу счетов. Сверка с оригиналом и выбор клиента выполняются при импорте счёта.",
  disclaimer: "Распознавание GMed не подтверждает совместимость с DATEV. Для XML выполняются базовые проверки, а не полная проверка схемы и EN16931.",
  tooMany: "В этой сессии можно проверить до 10 файлов. Выберите меньше документов или очистите результаты.",
  noAccess: "Проверка документов доступна пользователям с правом работы со счетами. Настройки подключения доступны отдельно.",
  retry: "Повторить", progress: "Проверка документов…", checked: "Обработано", invoice: "Счёт", supplier: "Поставщик", net: "Без НДС", vat: "НДС", gross: "Итог", date: "Дата", absent: "Не распознано",
  duplicate: "Совпадает с файлом", related: "Похожие реквизиты у файла", warnings: "Предупреждений распознавания", noIssues: "Основные реквизиты распознаны. Перед импортом сверьте их с оригиналом.",
  required_fields: "Часть обязательных реквизитов не распознана.", invoice_date: "Нужно проверить дату счёта.", currency: "Не определён корректный код валюты.",
  totals: "Нетто, НДС и итог не заполнены или не совпадают.", incomplete: "Документ прочитан не полностью.", structure: "Структурированный документ не разрешён к импорту GMed.",
  source_difference: "Реквизиты в XML расходятся с видимым документом.", parser_warning: "Есть замечания распознавания; нужна ручная проверка.",
  matching_invoice: "Совпадают поставщик, номер счёта и валюта. Проверьте возможный повтор, даже если суммы отличаются.",
  tax: "Налоговый режим нужно проверить вручную.", lines: "Сумма позиций отличается от итога.", payable: "Сумма к оплате отличается от итога счёта.",
  derivedNet: "Нетто рассчитано из итога и НДС. Сверьте с оригиналом.", derivedDue: "Срок оплаты рассчитан из даты счёта и условий документа.",
  statuses: { queued: "В очереди", processing: "Распознавание", parsed: "Распознано — сверить", review: "Нужна проверка", duplicate: "Повторный файл", error: "Не проверено", cancelled: "Остановлено" },
  failures: { file: "Нужен непустой PDF/PNG/JPG до 25 МБ либо XML до 5 МБ.", unavailable: "Сервис распознавания недоступен. Можно повторить проверку.", busy: "Сервис занят. Повторите через несколько секунд.", access: "Нет доступа к проверке счетов. Проверьте вход и права пользователя.", parse: "Не удалось проверить документ. Проверьте формат или повторите попытку." },
  sources: { xml: "Структурированный XML", embedded_xml: "XML внутри PDF", pdf_text: "Текст PDF", ocr: "OCR скана", unknown: "Источник не определён" },
};
const de: typeof ru = {
  title: "Dokumente vor der Anbindung prüfen",
  hint: "Echte PDFs, Scans oder XML mit der GMed-Erkennung prüfen. Dabei wird keine Rechnung angelegt und nichts an DATEV gesendet.",
  limits: "Bis zu 10 Dateien pro Sitzung: PDF, PNG, JPG bis 25 MB; UBL/CII-XML bis 5 MB.",
  choose: "Dokumente auswählen", input: "Dokumente zur Prüfung", stop: "Stoppen", clear: "Ergebnisse löschen",
  report: "Prüfbericht herunterladen", empty: "Dokumente auswählen, die später importiert werden sollen.",
  session: "Ergebnisse bleiben nur bis zum Verlassen dieser Seite erhalten. Die Dublettenprüfung umfasst diese Dateien, nicht den Rechnungsbestand. Originalabgleich und Patientenzuordnung erfolgen beim Rechnungsimport.",
  disclaimer: "Die GMed-Erkennung bestätigt keine DATEV-Kompatibilität. XML wird grundlegend geprüft, nicht vollständig gegen Schema und EN16931 validiert.",
  tooMany: "Pro Sitzung können bis zu 10 Dateien geprüft werden. Weniger Dokumente auswählen oder Ergebnisse löschen.",
  noAccess: "Die Dokumentenprüfung erfordert Zugriff auf Rechnungen. Die Verbindungseinstellungen sind davon getrennt zugänglich.",
  retry: "Erneut prüfen", progress: "Dokumente werden geprüft…", checked: "Bearbeitet", invoice: "Rechnung", supplier: "Lieferant", net: "Netto", vat: "Umsatzsteuer", gross: "Brutto", date: "Datum", absent: "Nicht erkannt",
  duplicate: "Identisch mit Datei", related: "Ähnliche Rechnungsangaben in Datei", warnings: "Erkennungshinweise", noIssues: "Die wesentlichen Angaben wurden erkannt. Vor dem Import mit dem Original abgleichen.",
  required_fields: "Einige erforderliche Rechnungsangaben fehlen.", invoice_date: "Rechnungsdatum prüfen.", currency: "Kein gültiger Währungscode erkannt.",
  totals: "Netto, Umsatzsteuer und Brutto fehlen oder stimmen nicht überein.", incomplete: "Das Dokument wurde nicht vollständig gelesen.", structure: "Das strukturierte Dokument ist nicht für den GMed-Import zugelassen.",
  source_difference: "XML-Angaben weichen vom sichtbaren Dokument ab.", parser_warning: "Die Erkennung enthält Hinweise; manuelle Prüfung erforderlich.",
  matching_invoice: "Lieferant, Rechnungsnummer und Währung stimmen überein. Mögliche Dublette prüfen, auch bei abweichenden Beträgen.",
  tax: "Die steuerliche Behandlung muss manuell geprüft werden.", lines: "Die Positionssumme weicht vom Gesamtbetrag ab.", payable: "Der Zahlbetrag weicht vom Rechnungsbrutto ab.",
  derivedNet: "Netto wurde aus Brutto und Umsatzsteuer berechnet. Mit dem Original abgleichen.", derivedDue: "Die Fälligkeit wurde aus Rechnungsdatum und Zahlungsbedingungen berechnet.",
  statuses: { queued: "Wartend", processing: "Erkennung läuft", parsed: "Erkannt – abgleichen", review: "Prüfung erforderlich", duplicate: "Identische Datei", error: "Nicht geprüft", cancelled: "Gestoppt" },
  failures: { file: "Eine nicht leere PDF/PNG/JPG-Datei bis 25 MB oder XML bis 5 MB auswählen.", unavailable: "Die Erkennung ist nicht verfügbar. Die Prüfung kann wiederholt werden.", busy: "Die Erkennung ist ausgelastet. In einigen Sekunden erneut versuchen.", access: "Kein Zugriff auf die Rechnungsprüfung. Anmeldung und Benutzerrechte prüfen.", parse: "Das Dokument konnte nicht geprüft werden. Format prüfen oder erneut versuchen." },
  sources: { xml: "Strukturiertes XML", embedded_xml: "XML im PDF", pdf_text: "PDF-Text", ocr: "Scan-OCR", unknown: "Quelle nicht bestimmt" },
};
export function useDocumentCheckText() {
  const { lang } = useLang();
  return lang === "de" ? de : ru;
}
