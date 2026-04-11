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

- `ceo_assistant_only_sees_released_medical_documents`
  Source:
  `docs/architecture/02_field-level-access-control.md`
  Covers:
  CEO assistant can work only with released sensitive docs, not internal medical files.

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

- `patient_can_upload_document_for_self_and_download_it`
  Source:
  `docs/requirements/03_product-backlog_ua.md:203`
  `docs/backlog/04_implementation-tasks_ua.md:282`
  Covers:
  patient portal supports self-upload for internal care-team intake, keeps the upload patient-bound and lets the patient re-download the submitted file.

## Not automated yet

- file replace/delete lifecycle
- external provider messaging around documents
- OCR/categorization pipeline
- patient-requested revoke of third-party medical sharing outside portal document scope
