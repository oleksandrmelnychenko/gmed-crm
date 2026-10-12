/**
 * Texts of the QA round-3 fixes for orders, appointments and concierge
 * services (group C, 2026-10-12). Merged into `uiText`; every key exists in
 * German and Russian.
 */
export const ordersRound3UiDe = {
  // The client's signature covers the signed terms (QA C3-01, lib/order-api-errors.ts)
  "api_orders_signed_terms_change": "Der Kunde hat den Auftrag über {signed_total_label} unterschrieben. Mit dieser Änderung beträgt der Auftrag {new_total_label}. Die Unterschrift des Kunden und die Bestätigung durch GMED werden zurückgesetzt: Der Kunde muss eine neue Fassung des Einzelauftrags unterschreiben (QES oder Scan). Änderung speichern?",
  "api_orders_document_outdated": "Der Auftrag wurde nach dem Erstellen dieses Dokuments geändert: Es zeigt alte Leistungen oder einen alten Zeitraum. Erstellen Sie eine neue Fassung des Einzelauftrags und lassen Sie diese unterschreiben.",
  "orders_signed_terms_change_cancelled": "Änderung nicht gespeichert: Die Unterschrift des Kunden bleibt bestehen.",
  "orders_client_signature_changes_await": "Änderungen warten auf die Unterschrift des Kunden: Unterschrieben ist die Fassung über {signed_total} vom {signed_at}. Erstellen Sie eine neue Fassung des Einzelauftrags und lassen Sie sie unterschreiben (QES oder Scan).",
  "orders_client_signature_signed_total_actuals": "Vom Kunden unterschrieben: {signed_total} · aktuell nach erbrachten Leistungen: {current_total}",
  // Appointment → Koordination → package follow-up counter (QA C3-08)
  "appointments_package_items_count_one": "{count} Paketelement",
  "appointments_package_items_count_few": "{count} Paketelemente",
  "appointments_package_items_count_many": "{count} Paketelemente",
  "appointments_package_items_count_other": "{count} Paketelemente",
} as const satisfies Record<string, string>;

export const ordersRound3UiRu = {
  "api_orders_signed_terms_change": "Клиент подписал заказ на {signed_total_label}. С этим изменением сумма заказа — {new_total_label}. Подпись клиента и подтверждение GMED будут сброшены: клиенту нужно подписать новую версию документа заказа (QES или скан). Сохранить изменение?",
  "api_orders_document_outdated": "Заказ изменён после создания этого документа: в нём старые услуги или период. Создайте новую версию документа заказа и подпишите её.",
  "orders_signed_terms_change_cancelled": "Изменение не сохранено: подпись клиента сохранена.",
  "orders_client_signature_changes_await": "Изменения ждут подписи клиента: подписана версия на {signed_total} от {signed_at}. Создайте новую версию документа заказа и получите подпись (QES или скан).",
  "orders_client_signature_signed_total_actuals": "Подписано клиентом: {signed_total} · сейчас по оказанным услугам: {current_total}",
  "appointments_package_items_count_one": "{count} пункт пакета",
  "appointments_package_items_count_few": "{count} пункта пакета",
  "appointments_package_items_count_many": "{count} пунктов пакета",
  "appointments_package_items_count_other": "{count} пункта пакета",
} as const satisfies Record<keyof typeof ordersRound3UiDe, string>;
