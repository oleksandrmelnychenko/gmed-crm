-- One-off repair: a document filed under a medical category or document type
-- is medical data. Until 2026-09-28 the client decided the medical flag, so a
-- staff member could file e.g. "Medical / Doctor letter" (medical_arztbrief)
-- with is_medical = false, and the concierge assigned to the patient and
-- billing could then list and download it. The server now stores such a
-- document with is_medical = true and access_category = 'medical' on every
-- write (crates/server/src/routes/documents.rs,
-- document_classification_is_medical / enforce_medical_classification): a
-- category or type is medical when its key is a category marked medical in
-- ref_document_categories. This applies the same rule to the documents stored
-- before.
--
-- Only the medical flag and the access category change. Visibility, shares and
-- portal releases stay: a release to the patient or an interpreter keeps
-- working under the medical-document rules, while roles without medical access
-- no longer see these documents. An invoice source document cannot be medical
-- (protect_external_invoice_document_context) and is left alone.
--
-- Every corrected document is audited in the same transaction with its
-- previous values; the audit row has no acting user because the migration,
-- not a person, made the change. Nothing is deleted.
WITH medical_keys AS (
    SELECT lower(id) AS key
    FROM ref_document_categories
    WHERE is_medical
),
misclassified AS (
    SELECT document.id, document.is_medical, document.access_category
    FROM documents document
    WHERE (NOT document.is_medical OR document.access_category IS DISTINCT FROM 'medical')
      AND (
          lower(btrim(COALESCE(document.category, ''))) IN (SELECT key FROM medical_keys)
          OR lower(btrim(document.art)) IN (SELECT key FROM medical_keys)
      )
      AND NOT EXISTS (
          SELECT 1
          FROM external_invoices invoice
          WHERE invoice.source_document_id = document.id
      )
    FOR UPDATE OF document
),
corrected AS (
    UPDATE documents document
    SET is_medical = true,
        access_category = 'medical'
    FROM misclassified
    WHERE document.id = misclassified.id
    RETURNING document.id, document.patient_id, document.lead_id, document.order_id,
              document.appointment_id, document.category, document.art, document.visibility,
              misclassified.is_medical AS previous_is_medical,
              misclassified.access_category AS previous_access_category
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
SELECT NULL,
       'enforce_medical_document_classification',
       'document',
       corrected.id,
       jsonb_build_object(
           'is_medical', corrected.previous_is_medical,
           'access_category', corrected.previous_access_category
       ),
       jsonb_build_object('is_medical', true, 'access_category', 'medical'),
       jsonb_build_object(
           'category', corrected.category,
           'art', corrected.art,
           'visibility', corrected.visibility,
           'patient_id', corrected.patient_id,
           'lead_id', corrected.lead_id,
           'order_id', corrected.order_id,
           'appointment_id', corrected.appointment_id,
           'reason', 'medical_document_classification',
           'repair', '20260928110000_enforce_medical_document_classification'
       )
FROM corrected;
