/**
 * Texts of the fixes after the global browser QA of 2026-11-10 for the
 * patient's cabinet: survey, documents, visits, recommendations, privacy,
 * chat and the account page. Merged into `uiText`; every key exists in German
 * and Russian.
 */
export const portalQaUiDe = {
  // Server refusals of the portal (lib/care-api-errors.ts)
  "api_feedback_visit_not_held": "Bewertet werden kann nur ein Termin, der stattgefunden hat: Dieser Termin wurde abgesagt oder liegt noch in der Zukunft.",
  "api_appointment_request_dates_inverted": "Das Datum „bis“ liegt vor dem Datum „ab“. Bitte prüfen Sie den Wunschzeitraum.",
  "api_appointment_request_date_in_past": "Das Wunschdatum darf nicht in der Vergangenheit liegen. Bitte wählen Sie heute oder ein späteres Datum.",
  "api_portal_service_period_inverted": "Das Ende muss nach dem Beginn liegen. Bitte prüfen Sie Datum und Uhrzeit.",
  "api_portal_service_start_in_past": "Der gewünschte Beginn liegt in der Vergangenheit. Bitte wählen Sie heute oder ein späteres Datum.",
  "api_concierge_service_details_invalid": "Die Angaben zur Reservierung, zum Transfer oder zu den Tickets sind ungültig. Bitte prüfen Sie Anzahl, Uhrzeit und Länge der Texte.",
  "api_concierge_service_completion_before_start": "Der Service kann erst ab seinem Starttag abgeschlossen werden.",
  "api_portal_upload_no_file": "Es wurde keine Datei empfangen oder die Datei ist leer. Bitte wählen Sie eine Datei und senden Sie sie erneut.",
  "api_portal_upload_type_not_allowed": "Dieser Dateityp kann nicht hochgeladen werden. Möglich sind PDF, Bilder (JPG, PNG, GIF, WEBP, HEIC), Word- und Excel-Dokumente, TXT, CSV und DICOM.",
  "api_portal_upload_content_mismatch": "Der Inhalt der Datei passt nicht zu ihrem Typ oder ihrer Endung. Bitte speichern Sie das Dokument erneut als PDF oder Bild und laden Sie es noch einmal hoch.",
  // Document upload
  "portal_upload_type_not_allowed": "Dieser Dateityp kann nicht hochgeladen werden. Möglich sind PDF, Bilder (JPG, PNG, GIF, WEBP, HEIC), Word- und Excel-Dokumente, TXT, CSV und DICOM.",
  "portal_upload_empty_file": "Die Datei ist leer. Bitte wählen Sie eine andere Datei.",
  "portal_upload_too_large": "Die Datei ist zu groß: höchstens 25 MB.",
  "portal_upload_types_hint": "PDF, Bilder (JPG, PNG, GIF, WEBP, HEIC), Word, Excel, TXT, CSV oder DICOM, höchstens 25 MB.",
  // Required documents: a consent is signed, not uploaded
  "portal_documents_own_complete_consents_pending": "Ihre Unterlagen sind vollständig. Offen sind nur noch Einwilligungen, die GMED Ihnen zur Unterschrift schickt.",
  // Translation request: the languages a patient may need
  "portal_translation_language_ru": "Russisch",
  "portal_translation_language_uk": "Ukrainisch",
  "portal_translation_language_en": "Englisch",
  "portal_translation_language_es": "Spanisch",
  "portal_translation_language_de": "Deutsch",
  // Satisfaction survey
  "feedback_score_not_chosen": "Nicht gewählt",
  "feedback_optional_scores_hint": "Bewerten Sie nur, was Sie beurteilen können – die übrigen Skalen bleiben leer. Ein erneuter Klick auf die gewählte Bewertung entfernt sie.",
  "feedback_required_scores_missing": "Bitte wählen Sie die Gesamtbewertung und die NPS-Bewertung (0–10): Ohne sie kann die Rückmeldung nicht gesendet werden.",
  "feedback_required_scale": "Pflichtangabe",
  "feedback_rateable_visits_hint": "Bewertet werden kann nur ein Termin, der bereits stattgefunden hat. Abgesagte und bevorstehende Termine erscheinen nicht in der Liste.",
  // Visits and requests
  "portal_appointment_request_title_medical": "Medizinische Anfrage",
  "portal_appointment_request_title_non_medical": "Nicht medizinische Anfrage",
  "portal_request_visit_cancelled_badge": "Termin abgesagt",
  "portal_request_visit_cancelled_note": "Der Termin „{title}“ am {date} wurde abgesagt. Wenn Sie weiterhin einen Termin wünschen, senden Sie bitte eine neue Anfrage.",
  // Recommendations
  "portal_recommendation_recommended_on": "Empfohlen am {date}",
  "portal_recommendation_valid_period": "Gültig vom {from} bis {to}",
  "portal_recommendation_valid_to": "Gültig bis {date}",
  "portal_recommendation_valid_from": "Gültig ab {date}",
  "portal_recommendation_decline_confirm_title": "Empfehlung ablehnen?",
  "portal_recommendation_decline_confirm_body": "Ihr Betreuungsteam sieht, dass Sie abgelehnt haben. Eine offene Terminanfrage zu dieser Empfehlung wird zurückgezogen.",
  "portal_recommendation_decline_confirm_yes": "Ja, ablehnen",
  "portal_recommendation_decline_confirm_no": "Nicht ablehnen",
  "portal_recommendation_declined_note": "Sie haben diese Empfehlung abgelehnt. Wenn Sie es sich anders überlegt haben, wählen Sie „Beratung nötig“: Die Empfehlung wird wieder aktiv und Ihr Team meldet sich bei Ihnen.",
  // Privacy requests
  "portal_privacy_data_copy_hint": "Die Kopie wird der Anfrage nicht beigefügt: Laden Sie sie mit „Meine Daten exportieren“ herunter (auch auf der Startseite des Portals).",
  // Chat
  "chat_connection_own_hint": "Ihre Verbindung zum Chat: Neue Nachrichten kommen sofort an. Das ist nicht der Status Ihres Gesprächspartners.",
  // Paused subscription (owner decision 2026-11-10)
  "portal_paused_appointments_note": "Ihr Abonnement ist pausiert: Bereits vereinbarte Termine sehen Sie hier weiterhin, neue Anfragen und Änderungen sind bis zur Fortsetzung nicht möglich. Bei Fragen schreiben Sie Ihrem Manager im Chat.",
  "portal_paused_services_note": "Ihr Abonnement ist pausiert: Ihre Serviceanfragen sehen Sie hier weiterhin, und eine offene Anfrage können Sie stornieren. Neue Anfragen sind bis zur Fortsetzung nicht möglich. Bei Fragen schreiben Sie Ihrem Manager im Chat.",
  "portal_paused_subscriptions_note": "Ihr Abonnement ist pausiert. Neue Termin- und Serviceanfragen sind bis zur Fortsetzung geschlossen; vereinbarte Termine, Dokumente, Rechnungen und der Chat mit Ihrem Manager bleiben verfügbar.",
  // No order tariff (owner decision 9, 2026-11-13)
  "portal_services_tariff_note": "Die für Sie gebuchten Services sehen Sie hier. Neue Serviceanfragen und der Chat mit dem Team sind mit einem Tarif in Ihrem Auftrag möglich (GMED One, Reserve oder Behandlung). Bitte wenden Sie sich an GMED.",
  // Account
  "account_profile_error_name_required": "Bitte geben Sie Ihren Namen an.",
} as const satisfies Record<string, string>;

export const portalQaUiRu = {
  "api_feedback_visit_not_held": "Оценить можно только состоявшийся визит: этот визит отменён или ещё не прошёл.",
  "api_appointment_request_dates_inverted": "Дата «до» раньше даты «с». Проверьте желаемый период.",
  "api_appointment_request_date_in_past": "Желаемая дата не может быть в прошлом. Выберите сегодняшний день или более позднюю дату.",
  "api_portal_service_period_inverted": "Окончание должно быть позже начала. Проверьте дату и время.",
  "api_portal_service_start_in_past": "Желаемое начало уже прошло. Выберите сегодняшний день или более позднюю дату.",
  "api_concierge_service_details_invalid": "Данные бронирования, трансфера или билетов заполнены неверно. Проверьте количество, время и длину текстов.",
  "api_concierge_service_completion_before_start": "Сервис можно завершить не раньше дня его начала.",
  "api_portal_upload_no_file": "Файл не получен или пуст. Выберите файл и отправьте ещё раз.",
  "api_portal_upload_type_not_allowed": "Этот тип файла нельзя загрузить. Подходят PDF, изображения (JPG, PNG, GIF, WEBP, HEIC), документы Word и Excel, TXT, CSV и DICOM.",
  "api_portal_upload_content_mismatch": "Содержимое файла не соответствует его типу или расширению. Сохраните документ заново как PDF или изображение и загрузите ещё раз.",
  "portal_upload_type_not_allowed": "Этот тип файла нельзя загрузить. Подходят PDF, изображения (JPG, PNG, GIF, WEBP, HEIC), документы Word и Excel, TXT, CSV и DICOM.",
  "portal_upload_empty_file": "Файл пуст. Выберите другой файл.",
  "portal_upload_too_large": "Файл слишком большой: не более 25 МБ.",
  "portal_upload_types_hint": "PDF, изображения (JPG, PNG, GIF, WEBP, HEIC), Word, Excel, TXT, CSV или DICOM, не более 25 МБ.",
  "portal_documents_own_complete_consents_pending": "Ваши документы загружены. Осталось подписать согласия — их пришлёт вам GMED.",
  "portal_translation_language_ru": "Русский",
  "portal_translation_language_uk": "Украинский",
  "portal_translation_language_en": "Английский",
  "portal_translation_language_es": "Испанский",
  "portal_translation_language_de": "Немецкий",
  "feedback_score_not_chosen": "Не выбрано",
  "feedback_optional_scores_hint": "Оценивайте только то, что можете оценить: остальные шкалы останутся пустыми. Повторное нажатие на выбранную оценку снимает её.",
  "feedback_required_scores_missing": "Выберите общую оценку и оценку NPS (0–10): без них отзыв нельзя отправить.",
  "feedback_required_scale": "Обязательная оценка",
  "feedback_rateable_visits_hint": "Оценить можно только визит, который уже состоялся. Отменённые и предстоящие визиты в списке не показываются.",
  "portal_appointment_request_title_medical": "Медицинский запрос",
  "portal_appointment_request_title_non_medical": "Немедицинский запрос",
  "portal_request_visit_cancelled_badge": "Визит отменён",
  "portal_request_visit_cancelled_note": "Визит «{title}» на {date} отменён. Если визит по-прежнему нужен, отправьте новый запрос.",
  "portal_recommendation_recommended_on": "Рекомендовано {date}",
  "portal_recommendation_valid_period": "Действует с {from} по {to}",
  "portal_recommendation_valid_to": "Действует до {date}",
  "portal_recommendation_valid_from": "Действует с {date}",
  "portal_recommendation_decline_confirm_title": "Отклонить рекомендацию?",
  "portal_recommendation_decline_confirm_body": "Команда сопровождения увидит, что вы отказались. Открытый запрос на визит по этой рекомендации будет отозван.",
  "portal_recommendation_decline_confirm_yes": "Да, отклонить",
  "portal_recommendation_decline_confirm_no": "Не отклонять",
  "portal_recommendation_declined_note": "Вы отклонили эту рекомендацию. Если передумали, нажмите «Нужна консультация»: рекомендация снова станет активной, и команда свяжется с вами.",
  "portal_privacy_data_copy_hint": "Копия данных не прикладывается к запросу: скачайте её кнопкой «Экспортировать мои данные» (она есть и на главной странице портала).",
  "chat_connection_own_hint": "Ваше соединение с чатом: новые сообщения приходят сразу. Это не статус собеседника.",
  "portal_paused_appointments_note": "Ваша подписка приостановлена: уже согласованные визиты по-прежнему видны здесь, новые запросы и изменения недоступны до возобновления. С вопросами напишите менеджеру в чате.",
  "portal_paused_services_note": "Ваша подписка приостановлена: ваши запросы на сервисы по-прежнему видны здесь, открытый запрос можно отменить. Новые запросы недоступны до возобновления. С вопросами напишите менеджеру в чате.",
  "portal_paused_subscriptions_note": "Ваша подписка приостановлена. Новые запросы на визиты и сервисы закрыты до возобновления; согласованные визиты, документы, счета и чат с менеджером остаются доступными.",
  "portal_services_tariff_note": "Здесь видны сервисы, заказанные для вас. Новые запросы на сервисы и чат с командой доступны с тарифом в вашем заказе (GMED One, Reserve или Behandlung). Обратитесь в GMED.",
  "account_profile_error_name_required": "Укажите имя.",
} as const satisfies Record<keyof typeof portalQaUiDe, string>;
