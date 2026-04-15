# Source-Derived Documents Regression Matrix

Цей файл фіксує тести, зібрані не “зі стелі”, а з вихідних джерел:

- `Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf`
- `1 (Update 2) User Story Salesforce.xlsx`
- нормалізованих markdown-артефактів у `docs/requirements/*` і `docs/backlog/*`

> **Трасованість:** після `python scripts/generate_product_backlog_from_excel.py` номери рядків у посиланнях на `03_product-backlog_ua.md` нижче можуть не збігатися; орієнтуйтесь на **ряд. Excel** у згенерованому беклозі або `docs/testing/user-stories-excel-backlog-audit_ua.md`.

## Source signals

- `Process Mapping PDF`: `Daten- und Dokumentenupdate`, `Execution`, `Arztbriefe`.
- `User Stories.xlsx / Patientenmanager`: структурована обробка візиту з `benötigte Dokumente und Dateien`, письмовим перекладом висновків, `Arztbrief`, `Follow-up`.
- `User Stories.xlsx / Auftragsdurchführung`: `Datensammlung (Befunde, Arztbriefe, andere Medizinische Dateien)`, `Vorbereitung und Weiterleitung von med. Daten`.
- `KPIs.xlsx`: час від терміну до письмового `Arztbrief/Befund`, follow-up після замовлення.

## Automated tests

- `document_upload_list_get_and_download_work`
  Source:
  `docs/requirements/03_product-backlog_ua.md:100`
  `docs/requirements/03_product-backlog_ua.md:242`
  Covers:
  upload, list, open detail, download of visit-linked file.

- `document_upload_without_explicit_art_is_auto_classified_from_filename`
  Source:
  `docs/requirements/03_product-backlog_ua.md:139`
  Covers:
  upload without manual document type, filename-based auto-classification, inferred category and medical flag, and no unnecessary intake-queue residue for high-confidence matches.

- `uncategorized_uploads_land_in_document_intake_queue`
  Source:
  `docs/requirements/03_product-backlog_ua.md:137`
  `docs/requirements/03_product-backlog_ua.md:139`
  `docs/requirements/03_product-backlog_ua.md:203`
  Covers:
  generic scan/import uploads stay storable without manual art, remain flagged for categorization and appear in the staff intake queue for follow-up review.

- `interpreter_uploads_land_in_teamlead_review_queue_and_teamlead_can_release_them`
  Source:
  `docs/requirements/03_product-backlog_ua.md:297`
  `docs/requirements/03_product-backlog_ua.md:301`
  `docs/backlog/04_implementation-tasks_ua.md:215`
  `docs/backlog/04_implementation-tasks_ua.md:219`
  Covers:
  interpreter can upload an internal draft document for an assigned patient, the upload surfaces in the teamlead review queue, and teamlead can classify and release it without getting full document-management powers.

- `teamlead_cannot_release_interpreter_upload_without_classification`
  Source:
  `docs/requirements/03_product-backlog_ua.md:301`
  `docs/backlog/04_implementation-tasks_ua.md:219`
  Covers:
  teamlead cannot release an interpreter-origin draft into active status while the document still remains uncategorized or generic.

- `interpreter_sees_only_released_medical_documents_for_assigned_patient`
  Source:
  `docs/requirements/03_product-backlog_ua.md:100`
  `docs/architecture/02_field-level-access-control.md:46`
  Covers:
  medical visibility for interpreter only after release and assignment.

- `billing_can_access_financial_documents_but_not_medical_ones`
  Source:
  `docs/requirements/03_product-backlog_ua.md:100`
  `docs/architecture/02_field-level-access-control.md:46`
  Covers:
  billing role sees invoice-like docs but not medical findings.

- `billing can inspect financial documents but not medical ones and gets no document mutation controls`
  Source:
  `docs/requirements/03_product-backlog_ua.md:100`
  `docs/architecture/02_field-level-access-control.md:46`
  Covers:
  browser-level billing shell sees invoice-like financial documents for the patient context, keeps medical documents hidden, and the financial-document detail still exposes no translation, share, portal-release, metadata-save or file-delete mutation controls.

- `sales_and_it_admin_cannot_access_documents_workspace_or_meta_routes`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:20`
  `docs/backlog/02_rbac-matrix_ua.md:21`
  `docs/architecture/02_field-level-access-control.md:257`
  Covers:
  roles outside patient-facing and operational document workflows stay blocked from document list/detail and lookup/template read paths instead of inheriting access through the generic staff shell.

- `document_user_share_can_be_confirmed_and_revoked`
  Source:
  `docs/architecture/02_field-level-access-control.md:92`
  `docs/architecture/02_field-level-access-control.md:257`
  Covers:
  explicit share lifecycle, confirmation and revoke trail.

- `medical_document_share_requires_involved_medical_provider`
  Source:
  `docs/requirements/03_product-backlog_ua.md:242`
  Covers:
  forwarding medical data only to a provider involved in the appointment/order context.

- `provider_share_requires_allowed_official_channel`
  Source:
  `docs/requirements/03_product-backlog_ua.md:82`
  `docs/backlog/04_implementation-tasks_ua.md:203`
  Covers:
  provider-facing external sharing is rejected when the selected communication channel is not part of the allowed official channel policy.

- `provider_document_share_requires_and_persists_cover_message`
  Source:
  `docs/backlog/04_implementation-tasks_ua.md:128`
  `docs/requirements/03_product-backlog_ua.md:82`
  Covers:
  provider-facing document sharing requires a cover message, stores that message in the share record and keeps the message visible in the document share trail together with the official delivery channel.

- `staff can share a document with provider and revoke it with cover message`
  Source:
  `docs/backlog/04_implementation-tasks_ua.md:128`
  `docs/requirements/03_product-backlog_ua.md:82`
  Covers:
  browser-level document detail can create a provider-facing share with a mandatory cover message, surface that message back in the share trail and revoke the same provider share through the staff UI.

- `medical_document_share_requires_matching_provider_specialty`
  Source:
  `docs/requirements/03_product-backlog_ua.md:242`
  Covers:
  appointment-linked medical documents cannot be forwarded to a different medical provider from the same order context when the provider specialty does not match the doctor specialty of the originating appointment.

- `appointment_linked_document_share_prefers_appointment_provider_over_order_context`
  Source:
  `docs/requirements/03_product-backlog_ua.md:242`
  Covers:
  when a medical document is linked to a concrete appointment, provider involvement is resolved against that appointment first; another provider from the same order must not pass sharing validation just because it appears elsewhere in the order scope.

- `patient_email_share_requires_active_channel_consent`
  Source:
  `docs/requirements/03_product-backlog_ua.md:82`
  Covers:
  patient-facing external sharing via non-portal channels requires an active patient-bound consent for that contractual channel.

- `bulk_document_share_creates_entries_for_multiple_documents`
  Source:
  `docs/requirements/03_product-backlog_ua.md:80`
  `docs/backlog/04_implementation-tasks_ua.md:77`
  Covers:
  multi-document sharing in one request, with share records created for each selected document.

- `patient_manager_cannot_manage_provider_shares_for_unassigned_documents`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:8`
  `docs/architecture/02_field-level-access-control.md`
  Covers:
  provider-share list/create/bulk/revoke routes stay assignment-bound for `patient_manager`; unassigned documents cannot be inspected or mutated through share endpoints.

- `patient_document_alerts_report_missing_required_documents`
  Source:
  `docs/requirements/03_product-backlog_ua.md:173`
  `docs/backlog/04_implementation-tasks_ua.md:83`
  Covers:
  configurable minimum patient document pack, evaluation against current patient files, missing-document alerts and computed document-pack completeness.

- `ceo_assistant_only_sees_released_medical_documents`
  Source:
  `docs/architecture/02_field-level-access-control.md`
  Covers:
  CEO assistant can work only with released sensitive docs, not internal medical files.

- `ceo_assistant_can_view_provider_share_trail_but_cannot_mutate_provider_shares`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:9`
  `docs/architecture/02_field-level-access-control.md`
  Covers:
  `ceo_assistant` gets read-only access to the provider-share trail for released documents, while create/revoke mutations remain limited to `ceo` and `patient_manager`.

- `ceo assistant can inspect released document share and translation history without mutation controls`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:9`
  `docs/architecture/02_field-level-access-control.md`
  Covers:
  browser-level document detail lets `ceo_assistant` inspect released provider-share trail and completed translation history, while share creation/revoke, translation request creation and translation workspace/status controls stay hidden in the UI shell.

- `interpreter can request document translation but cannot access share portal or translation-status controls`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:11`
  `docs/architecture/02_field-level-access-control.md`
  Covers:
  browser-level interpreter document shell stays request-only: the released patient document detail still exposes translation-request creation, but provider-share UI stays absent, portal release controls stay hidden behind the CEO/PM boundary, and translation status/workspace actions (`Starten`, `Abschließen`, `Abbrechen`, `Workspace speichern`) do not appear.

- `concierge can run translation workflow without provider-share or portal controls`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:13`
  `docs/architecture/02_field-level-access-control.md`
  Covers:
  browser-level concierge document shell keeps the same provider-share and patient-portal boundaries as interpreter-facing roles, but still allows the operational translation workflow: an existing released document translation request can be opened, `Starten` becomes actionable, the status flips to `In Bearbeitung`, and workspace/status controls remain available without exposing provider-share UI or portal-release controls.

- `document_meta_endpoints_return_seeded_categories_and_staff`
  Source:
  `1 (Update 2) User Story Salesforce.xlsx`
  `docs/architecture/02_field-level-access-control.md:257`
  Covers:
  document taxonomy/staff lookup needed by the document workflow UI.

- `document_templates_can_generate_treatment_plan_pdf_document`
  Source:
  `docs/requirements/03_product-backlog_ua.md:51`
  `docs/backlog/04_implementation-tasks_ua.md:66`
  `docs/backlog/04_implementation-tasks_ua.md:76`
  Covers:
  template catalog, treatment-plan PDF generation with text blocks, saved PDF document and download flow.

- `ceo_assistant_can_list_document_templates_but_cannot_generate_documents`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:9`
  `docs/requirements/03_product-backlog_ua.md:51`
  Covers:
  `ceo_assistant` can open the document-template catalog in read-only mode, but the actual generation endpoint remains blocked so template execution stays limited to `ceo` and `patient_manager`.

- `staff can generate a document from template`
  Source:
  `docs/requirements/03_product-backlog_ua.md:51`
  `docs/backlog/04_implementation-tasks_ua.md:66`
  `docs/backlog/04_implementation-tasks_ua.md:76`
  Covers:
  browser-level document workspace can open the template dialog, pick a patient-bound template, submit generation and surface the new generated version in the staff detail sheet.

- `confirmed_appointment_auto_sends_only_flagged_provider_template_once_to_patient_portal`
  Source:
  `docs/requirements/03_product-backlog_ua.md:63`
  `docs/backlog/04_implementation-tasks_ua.md:43`
  Covers:
  provider-specific preparation templates flagged for auto-send generate exactly one appointment-bound PDF on `medical appointment -> confirmed`, release it to the patient portal, persist one `appointment_provider_template_deliveries` row and do not duplicate document/share delivery on repeated confirmation.

- `patient manager can create an auto-send provider template and the patient portal receives exactly one preparation document on repeated confirmation`
  Source:
  `docs/requirements/03_product-backlog_ua.md:63`
  `docs/backlog/04_implementation-tasks_ua.md:43`
  Covers:
  browser-level clinic template editor can create an `auto_send_on_confirmed_appointment` provider template, and repeated appointment confirmation still yields exactly one patient-visible preparation packet in the portal for that template.

- `patient can confirm receipt for an auto-sent provider preparation document`
  Source:
  `docs/requirements/03_product-backlog_ua.md:63`
  `docs/backlog/04_implementation-tasks_ua.md:43`
  Covers:
  patient portal browser flow can see the auto-sent provider preparation packet after repeated appointment confirmation, surface exactly one receipt card for that generated document and confirm the release without duplicating portal visibility.

- `document_templates_default_to_patient_language_when_omitted`
  Source:
  `docs/requirements/03_product-backlog_ua.md:69`
  Covers:
  generated treatment-plan templates inherit the patient language when the request does not override it explicitly.

- `document_templates_can_replace_previous_generated_version`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:94`
  Covers:
  generated document replace flow, archived previous version, ordered version history endpoint and explicit version metadata in document detail.

- `document_translation_requests_can_be_created_and_completed`
  Source:
  `docs/requirements/03_product-backlog_ua.md:149`
  Covers:
  document detail can register a translation request, keep it document-bound and move the request through operational statuses.

- `document_text_extraction_can_prefill_translation_request_workspace`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:131`
  `docs/requirements/03_product-backlog_ua.md:149`
  Covers:
  best-effort text extraction for uploaded source documents, persisted extraction metadata, manual rerun endpoint and automatic prefill of translation workspace source text.

- `image_document_text_extraction_uses_ocr_or_reports_runtime_unavailable`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:131`
  Covers:
  image-only uploads route through OCR-capable extraction, persist the active OCR/runtime method (`windows_ocr` or `tesseract_cli`) and keep rerun behavior stable when the environment does not provide OCR.

- `translation_workspace_can_store_source_and_translated_text`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:131`
  `docs/requirements/03_product-backlog_ua.md:149`
  Covers:
  translation workspace stores source language, source text, translated text and blocks completion without final translated content.

- `ceo_assistant_can_review_translation_requests_but_cannot_mutate_them`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:9`
  `docs/architecture/02_field-level-access-control.md`
  Covers:
  `ceo_assistant` can inspect translation-request history on released documents, but request creation and workspace/status mutations remain blocked.

- `staff can create and complete a document translation workspace flow`
  Source:
  `docs/requirements/03_product-backlog_ua.md:149`
  `docs/requirements/04_non-functional-requirements_ua.md:131`
  Covers:
  browser-level document detail can create a translation request, move it into active work, reuse extracted text, save source and translated workspace content and complete the request through the same staff UI used in operations.

- `document_templates_can_generate_medication_summary_pdf_document`
  Source:
  `docs/requirements/03_product-backlog_ua.md:87`
  `docs/backlog/04_implementation-tasks_ua.md:123`
  Covers:
  template catalog, consolidated medication-summary PDF generation across active cases, saved PDF document and download flow.

- `document_templates_can_generate_framework_contract_pdf_document`
  Source:
  `docs/requirements/03_product-backlog_ua.md:150`
  `docs/backlog/04_implementation-tasks_ua.md:124`
  Covers:
  template catalog, framework-contract PDF generation from contract data plus linked quote/services, reusable clause blocks, saved PDF document and download flow.

- `document_templates_can_generate_patient_sticker_pdf_document`
  Source:
  `docs/requirements/03_product-backlog_ua.md:151`
  Covers:
  template catalog, patient sticker PDF generation with agency contact block, country code, format-specific layout and download flow.

- `document_can_be_released_to_patient_portal_and_confirmed_from_me_workspace`
  Source:
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/requirements/03_product-backlog_ua.md:164`
  `docs/requirements/04_non-functional-requirements_ua.md:53`
  Covers:
  patient-portal document publication, portal listing, patient confirmation and patient-side download over `/me/documents`.

- `revoking_patient_portal_release_hides_document_from_me_workspace`
  Source:
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/requirements/04_non-functional-requirements_ua.md:53`
  Covers:
  portal release revoke removes the document from patient self-service visibility and download access.

- `staff can release and revoke a document from patient portal scope`
  Source:
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/requirements/04_non-functional-requirements_ua.md:53`
  Covers:
  browser-level staff document detail can trigger portal release and revoke actions through the same UI controls used in daily operations, with visible success feedback for both transitions.

- `patient can confirm portal document receipt`
  Source:
  `docs/requirements/03_product-backlog_ua.md:164`
  `docs/requirements/04_non-functional-requirements_ua.md:53`
  Covers:
  browser-level patient portal document workspace can confirm receipt of a released file, reduce the pending-confirmation counter and surface the confirmed state back in the same card.

- `patient_can_upload_document_for_self_and_download_it`
  Source:
  `docs/requirements/03_product-backlog_ua.md:203`
  `docs/backlog/04_implementation-tasks_ua.md:282`
  Covers:
  patient portal supports self-upload for internal care-team intake, keeps the upload patient-bound and lets the patient re-download the submitted file.

- `patient can upload own document and download released plus uploaded files`
  Source:
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/requirements/03_product-backlog_ua.md:203`
  `docs/backlog/04_implementation-tasks_ua.md:282`
  Covers:
  browser-level patient portal document workspace can download an already released file, submit a new self-upload through the same form used in daily operations and immediately download that newly created portal upload back from the list.

- `deleting_document_file_revokes_shares_and_removes_stored_file`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:84`
  `docs/requirements/04_non-functional-requirements_ua.md:94`
  Covers:
  controlled document file-delete lifecycle archives the document row, revokes active shares, removes the stored binary from disk and blocks further download access without erasing audit/history metadata.

- `staff can delete a stored document file and keep metadata trail`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:84`
  `docs/requirements/04_non-functional-requirements_ua.md:94`
  Covers:
  browser-level document detail can open the delete-file dialog, submit a mandatory deletion reason, surface the deleted-file banner and keep the download action disabled while metadata and reason remain visible.

- `third_party_revoke_request_can_be_executed_by_patient_manager_and_revokes_only_external_consents_and_provider_document_shares`
  Source:
  `docs/requirements/03_product-backlog_ua.md:337`
  `docs/requirements/03_product-backlog_ua.md:355`
  Covers:
  patient-requested third-party revoke executes through the compliance workflow, revokes the external consent bundle and removes active provider-facing document shares without touching patient portal releases or assigned patient-manager communication paths.

- `deleting_portal_document_file_does_not_break_patient_manager_chat`
  Source:
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/requirements/04_non-functional-requirements_ua.md:84`
  Covers:
  deleting a patient-visible document file removes the portal listing/share path for the patient while leaving the patient-to-assigned-manager secure chat operational for follow-up coordination.
