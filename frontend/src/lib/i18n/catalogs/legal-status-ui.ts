/**
 * Texts of the "Правовой статус" checklist items that follow signed documents
 * only — DSGVO consent and the confidentiality release (owner decision
 * 2026-10-12). Merged into `uiText`; every key exists in German and Russian.
 */
export const legalStatusUiDe = {
  // Server refusal (crates/server/src/routes/patients.rs, `legal_status_requires_signed_document`)
  "api_patients_legal_status_requires_signed_document": "DSGVO-Einwilligung und Schweigepflichtentbindung gelten nur mit unterschriebenem Dokument: Laden Sie den Scan des unterschriebenen Exemplars hoch („Auf Papier unterschrieben“) oder lassen Sie das Dokument elektronisch unterschreiben. Von Hand lassen sie sich nicht setzen oder entfernen.",
  "patient_legal_doc_signed_on": "Unterschrieben am {date}",
  "patient_legal_doc_source_paper_signature": "Papierunterschrift (Scan)",
  "patient_legal_doc_source_electronic_signature": "elektronische Signatur",
  "patient_legal_doc_source_signed_document": "unterschriebenes Dokument",
  "patient_legal_doc_manual": "Manuell markiert, kein unterschriebenes Dokument vorhanden",
  "patient_legal_doc_manual_hint": "Die Markierung zählt weiterhin. Laden Sie den Scan des unterschriebenen Exemplars hoch.",
  "patient_legal_doc_missing": "Kein unterschriebenes Dokument",
  "patient_legal_doc_to_sign": "Zu unterschreiben: {name}",
  "patient_legal_doc_signature_pending": "Elektronische Signatur ausstehend",
  "patient_legal_doc_paper_signed": "Auf Papier unterschrieben",
  "patient_legal_doc_create": "Dokument erstellen",
  "patient_legal_doc_read_only_hint": "Wird nur über ein unterschriebenes Dokument gesetzt (Scan des Papierexemplars oder elektronische Signatur) – im Abschnitt „Rechtsstatus“ der Patientenakte.",
  "patient_legal_doc_status_signed": "Unterschrieben",
  "patient_legal_doc_status_manual": "Ohne Dokument",
  "patient_legal_doc_status_missing": "Ausstehend",
  // A consent the patient revoked in the consent register (Widerruf).
  "patient_legal_doc_status_revoked": "Widerrufen",
  "patient_legal_doc_revoked_on": "Einwilligung am {date} widerrufen",
  "patient_legal_doc_revoked_hint": "Neue Aufträge sind gesperrt, bis eine danach unterschriebene Einwilligung vorliegt.",
  // Re-check reasons (patients.rs `consent_revocation_reason`).
  "orders_blocking_dsgvo_consent_revoked": "DSGVO-Einwilligung am {date} widerrufen – neue Aufträge erst mit einer danach unterschriebenen Einwilligung",
  "orders_blocking_confidentiality_release_revoked": "Schweigepflichtentbindung am {date} widerrufen – neue Aufträge erst mit einer danach unterschriebenen Entbindung",
};

export const legalStatusUiRu = {
  "api_patients_legal_status_requires_signed_document": "DSGVO и разрешение на раскрытие врачебной тайны отмечаются только по подписанному документу: загрузите скан подписанного экземпляра («Подписано на бумаге») или подпишите документ электронно. Вручную их нельзя отметить или снять.",
  "patient_legal_doc_signed_on": "Подписано {date}",
  "patient_legal_doc_source_paper_signature": "скан на бумаге",
  "patient_legal_doc_source_electronic_signature": "электронная подпись",
  "patient_legal_doc_source_signed_document": "подписанный документ",
  "patient_legal_doc_manual": "Отмечено вручную, подписанный документ отсутствует",
  "patient_legal_doc_manual_hint": "Отметка продолжает действовать. Загрузите скан подписанного экземпляра.",
  "patient_legal_doc_missing": "Нет подписанного документа",
  "patient_legal_doc_to_sign": "К подписи: {name}",
  "patient_legal_doc_signature_pending": "Ожидает электронной подписи",
  "patient_legal_doc_paper_signed": "Подписано на бумаге",
  "patient_legal_doc_create": "Создать документ",
  "patient_legal_doc_read_only_hint": "Отмечается только по подписанному документу (скан бумажного экземпляра или электронная подпись) — в разделе «Правовой статус» карточки пациента.",
  "patient_legal_doc_status_signed": "Подписано",
  "patient_legal_doc_status_manual": "Без документа",
  "patient_legal_doc_status_missing": "В ожидании",
  "patient_legal_doc_status_revoked": "Отозвано",
  "patient_legal_doc_revoked_on": "Согласие отозвано {date}",
  "patient_legal_doc_revoked_hint": "Новые заказы заблокированы, пока нет согласия, подписанного после отзыва.",
  "orders_blocking_dsgvo_consent_revoked": "Согласие DSGVO отозвано {date} — новые заказы только после согласия, подписанного позже",
  "orders_blocking_confidentiality_release_revoked": "Разрешение на раскрытие врачебной тайны отозвано {date} — новые заказы только после разрешения, подписанного позже",
} satisfies Record<keyof typeof legalStatusUiDe, string>;
