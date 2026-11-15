-- Optional validity date of a document, «Действует до» / «Gültig bis»
-- (owner decision 2026-11-15). Never required: a document without it is not
-- tracked at all. With it the server derives the status by the Berlin day
-- (valid, expiring within 30 days, expired; services::document_validity) and
-- tells the patient's manager 30 days before and on the day it expires.
-- Additive: one nullable column, one notice table, one prefill trigger.

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS valid_until DATE;

COMMENT ON COLUMN documents.valid_until IS
    'Optional «Gültig bis» of the document; NULL = not tracked. Staff set, change or clear it; identity documents and cost estimates are prefilled from the known date.';

CREATE INDEX IF NOT EXISTS idx_documents_valid_until
    ON documents (valid_until)
    WHERE valid_until IS NOT NULL;

-- One row per notice the daily job sent: once per document, stage and date.
-- A changed date is a new deadline and is told again.
CREATE TABLE IF NOT EXISTS document_validity_notices (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('expiring', 'expired')),
    valid_until DATE NOT NULL,
    recipients UUID[] NOT NULL DEFAULT '{}'::uuid[],
    notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, stage, valid_until)
);

-- The «gültig bis» the records already know for a document, or NULL when it
-- is not unambiguous:
-- - a Kostenvoranschlag: the validity of the quote whose number it prints
--   (`_quote_number` of its bindings, or of the version it replaces);
-- - the identity document of the patient or lead (types of the PERS branch;
--   a typed passport, ID card or residence permit only when the stored
--   document type is the same or unknown): the recorded validity
--   (`patients.passport_expiry`, `lead_gwg_declarations.id_valid_until`);
-- - the payer's identity document: the payer's submitted statement.
-- Representatives' copies stay empty: the upload row naming the person is
-- written after the document.
CREATE OR REPLACE FUNCTION document_known_valid_until(
    p_patient_id UUID,
    p_lead_id UUID,
    p_order_id UUID,
    p_art TEXT,
    p_template TEXT,
    p_bindings JSONB,
    p_replaces UUID
)
RETURNS DATE
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    art_code TEXT := lower(btrim(COALESCE(p_art, '')));
    template_code TEXT := COALESCE(p_template, '');
    kind TEXT;
    quote_no TEXT;
    found DATE;
BEGIN
    IF p_replaces IS NOT NULL AND template_code = '' THEN
        SELECT COALESCE(original.generated_template_id, '') INTO template_code
        FROM documents original WHERE original.id = p_replaces;
        template_code := COALESCE(template_code, '');
    END IF;

    IF (template_code = 'order_cost_estimate' OR art_code = 'order_cost_estimate')
       AND p_order_id IS NOT NULL THEN
        quote_no := NULLIF(btrim(COALESCE(p_bindings ->> '_quote_number', '')), '');
        IF quote_no IS NULL AND p_replaces IS NOT NULL THEN
            SELECT NULLIF(btrim(COALESCE(original.generated_bindings ->> '_quote_number', '')), '')
            INTO quote_no
            FROM documents original WHERE original.id = p_replaces;
        END IF;
        IF quote_no IS NULL THEN
            RETURN NULL;
        END IF;
        SELECT q.valid_until INTO found
        FROM quotes q
        WHERE q.order_id = p_order_id AND q.quote_number = quote_no;
        RETURN found;
    END IF;

    IF art_code = 'payer_identity' THEN
        IF p_lead_id IS NULL THEN
            RETURN NULL;
        END IF;
        SELECT s.id_valid_until INTO found
        FROM lead_payer_statements s
        WHERE s.lead_id = p_lead_id AND s.submitted_at IS NOT NULL;
        RETURN found;
    END IF;

    kind := CASE
        WHEN art_code IN ('identity', 'passport_scan') THEN 'any'
        WHEN art_code IN ('passport', 'personal_passport', 'reisepass') THEN 'passport'
        WHEN art_code IN ('id_card', 'identity_card') THEN 'id_card'
        WHEN art_code IN ('residence_permit', 'personal_residence_permit') THEN 'residence_permit'
        ELSE NULL
    END;
    IF kind IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_patient_id IS NOT NULL THEN
        SELECT p.passport_expiry INTO found
        FROM patients p
        WHERE p.id = p_patient_id
          AND (kind = 'any' OR p.id_document_type IS NULL OR p.id_document_type = kind);
        RETURN found;
    END IF;

    IF p_lead_id IS NOT NULL THEN
        SELECT g.id_valid_until INTO found
        FROM lead_gwg_declarations g
        WHERE g.lead_id = p_lead_id
          AND (kind = 'any' OR g.id_document_type IS NULL OR g.id_document_type = kind);
        RETURN found;
    END IF;

    RETURN NULL;
END;
$$;

-- Every insert path (upload, generated document, new version, signed result,
-- paper scan) gets the known date unless the insert names one. A signed
-- version of a document keeps the date of the version it replaces.
CREATE OR REPLACE FUNCTION documents_prefill_valid_until()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.valid_until IS NULL THEN
        NEW.valid_until := document_known_valid_until(
            NEW.patient_id, NEW.lead_id, NEW.order_id, NEW.art,
            NEW.generated_template_id, NEW.generated_bindings, NEW.replaces_document_id);
    END IF;
    IF NEW.valid_until IS NULL
       AND NEW.replaces_document_id IS NOT NULL
       AND NEW.ursprung IN ('electronic_signature', 'paper_signature') THEN
        SELECT original.valid_until INTO NEW.valid_until
        FROM documents original WHERE original.id = NEW.replaces_document_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_prefill_valid_until ON documents;
CREATE TRIGGER documents_prefill_valid_until
    BEFORE INSERT ON documents
    FOR EACH ROW
    EXECUTE FUNCTION documents_prefill_valid_until();

-- One-off backfill, only where it is unambiguous: the newest version of an
-- active document with its file, and for identity documents only when it is
-- the person's single such document (an older scan may show an earlier
-- passport). Cost estimates match their quote by number.
WITH candidates AS (
    SELECT d.id,
           document_known_valid_until(
               d.patient_id, d.lead_id, d.order_id, d.art,
               d.generated_template_id, d.generated_bindings, d.replaces_document_id
           ) AS known,
           lower(btrim(d.art)) AS art_code,
           CASE WHEN lower(btrim(d.art)) = 'payer_identity' THEN 'payer'
                ELSE 'identity' END AS art_group,
           d.patient_id,
           d.lead_id
    FROM documents d
    WHERE d.valid_until IS NULL
      AND d.status <> 'archived'
      AND d.file_deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM documents newer WHERE newer.replaces_document_id = d.id)
      AND (lower(btrim(d.art)) IN ('identity', 'passport_scan', 'passport', 'personal_passport',
                                   'reisepass', 'id_card', 'identity_card', 'residence_permit',
                                   'personal_residence_permit', 'payer_identity',
                                   'order_cost_estimate')
           OR d.generated_template_id = 'order_cost_estimate')
)
UPDATE documents d
SET valid_until = c.known
FROM candidates c
WHERE d.id = c.id
  AND c.known IS NOT NULL
  AND (
      c.art_code = 'order_cost_estimate'
      OR d.generated_template_id = 'order_cost_estimate'
      OR NOT EXISTS (
          SELECT 1 FROM documents other
          WHERE other.id <> d.id
            AND CASE WHEN c.art_group = 'payer'
                     THEN lower(btrim(other.art)) = 'payer_identity'
                     ELSE lower(btrim(other.art)) IN (
                         'identity', 'passport_scan', 'passport', 'personal_passport',
                         'reisepass', 'id_card', 'identity_card', 'residence_permit',
                         'personal_residence_permit')
                END
            AND other.status <> 'archived'
            AND other.file_deleted_at IS NULL
            AND COALESCE(other.version_root_document_id, other.id)
                <> COALESCE(d.version_root_document_id, d.id)
            AND NOT EXISTS (SELECT 1 FROM documents newer
                            WHERE newer.replaces_document_id = other.id)
            AND ((c.patient_id IS NOT NULL AND other.patient_id = c.patient_id)
                 OR (c.patient_id IS NULL AND other.patient_id IS NULL
                     AND other.lead_id = c.lead_id))
      )
  );
