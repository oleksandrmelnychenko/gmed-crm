export const breakfastCopy = {
  ru: {
    title: "Завтраки", all: "Все условия завтрака", edit: "Условия завтрака", unknown: "Не указано", included: "Включён в проживание", hotel_extra: "В отеле за доплату", self: "Самостоятельно вне отеля", none: "Без завтрака",
    payer: "Кто оплачивает", patient: "Пациент", company: "GMED", split: "Совместно", count: "Количество завтраков за всё проживание", amount: "Общая стоимость завтраков", notes: "Условия и комментарий", save: "Сохранить завтраки", saving: "Сохранение…", cancel: "Отмена",
    countHint: "Количество порций, не дней. Оставьте пустым, если неизвестно.", amountHint: "Фактическая сумма за всё проживание. Если сумма неизвестна, оставьте поле пустым.", definition: "Отдельный учёт по выбранным проживаниям, без отменённых. Эти суммы не прибавляются к стоимости проживания и не создают оплат. Сумма за завтраки может уже входить в стоимость брони.",
    meals: "Порций учтено", hotelCost: "Завтраки в отеле · доплата", selfCost: "Завтраки вне отеля", known: "Стоимость указана", otherCurrency: "Не включены суммы в другой валюте", noExtra: "Входит в стоимость проживания — отдельная сумма не нужна.",
    invalid: "Проверьте количество (1–100 000) и сумму (до 9 999 999 999,99, максимум 2 знака после запятой).", error: "Не удалось сохранить завтраки. Проверьте доступ и валюту брони; введённые данные сохранены в форме.", currencyChanged: "Сохранённая сумма в другой валюте. Укажите сумму в текущей валюте брони перед сохранением.",
  },
  de: {
    title: "Frühstück", all: "Alle Frühstücksarten", edit: "Frühstücksbedingungen", unknown: "Nicht erfasst", included: "Im Aufenthalt enthalten", hotel_extra: "Im Hotel gegen Aufpreis", self: "Selbst organisiert außerhalb", none: "Ohne Frühstück",
    payer: "Wer bezahlt", patient: "Patient", company: "GMED", split: "Gemeinsam", count: "Frühstücke für den gesamten Aufenthalt", amount: "Gesamtkosten für Frühstück", notes: "Bedingungen und Kommentar", save: "Frühstück speichern", saving: "Wird gespeichert…", cancel: "Abbrechen",
    countHint: "Anzahl der Portionen, nicht Tage. Leer lassen, wenn unbekannt.", amountHint: "Ist-Kosten für den gesamten Aufenthalt. Leer lassen, wenn unbekannt.", definition: "Separate Erfassung der ausgewählten Aufenthalte ohne Stornierungen. Diese Beträge werden den Aufenthaltskosten nicht hinzugefügt und erzeugen keine Zahlungen. Frühstück kann bereits im Buchungspreis enthalten sein.",
    meals: "Erfasste Portionen", hotelCost: "Frühstück im Hotel · Aufpreis", selfCost: "Frühstück außerhalb", known: "Kosten erfasst", otherCurrency: "Beträge in anderer Währung nicht enthalten", noExtra: "Im Aufenthaltspreis enthalten — kein separater Betrag nötig.",
    invalid: "Anzahl (1–100.000) und Betrag prüfen (bis 9.999.999.999,99, höchstens 2 Nachkommastellen).", error: "Frühstück konnte nicht gespeichert werden. Zugriff und Buchungswährung prüfen; Eingaben bleiben erhalten.", currencyChanged: "Gespeicherter Betrag in anderer Währung. Vor dem Speichern einen Betrag in der aktuellen Buchungswährung angeben.",
  },
} as const;
