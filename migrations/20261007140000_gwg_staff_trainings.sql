-- GwG instruction and reliability check of the staff (§ 6 Abs. 2 Nr. 5, 6
-- GwG), owner request 2026-10-05: the "Dokumentation interner
-- Sicherungsmaßnahmen" sheet lives in "SOP und Lernen", one record per
-- employee and instruction. The generated sheet (template
-- `gwg_staff_training`) and its signed scan are archived in the employee's
-- personnel file. See docs/architecture/gwg-staff-training_ua.md.

-- The personnel file category of the sheet. Five years from the end of the
-- year of the instruction, as the records of § 8 Abs. 4 GwG; deletion stays
-- disabled until the retention periods are confirmed.
INSERT INTO personnel_document_categories
    (code, file_label, monthly, is_health, expected_monthly, retention_years, retention_from, legal_basis, sort_order)
VALUES
    ('gwg_unterweisung', 'GwG Unterweisung', false, false, false, 5, 'document',
     '§ 6 Abs. 2 Nr. 5, 6 GwG; § 8 Abs. 4 GwG', 125)
ON CONFLICT (code) DO NOTHING;

-- A sheet GMED generates itself is archived with the source `generated`.
ALTER TABLE personnel_documents DROP CONSTRAINT IF EXISTS personnel_documents_source_check;
ALTER TABLE personnel_documents ADD CONSTRAINT personnel_documents_source_check
    CHECK (source IN ('upload', 'scan', 'import', 'generated'));

CREATE TABLE gwg_staff_trainings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    -- 1. Unterrichtung: when, by whom and in which form.
    instructed_on DATE NOT NULL,
    -- "als" and "im Bereich" as printed on the sheet (prefilled from the role).
    position TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    delivered_by TEXT NOT NULL CHECK (delivered_by IN ('internal', 'other')),
    delivered_by_other TEXT,
    form_oral BOOLEAN NOT NULL DEFAULT false,
    form_material BOOLEAN NOT NULL DEFAULT false,
    form_other BOOLEAN NOT NULL DEFAULT false,
    form_other_text TEXT,
    -- 2. The instructions given (codes of the six points of the sheet).
    instructions TEXT[] NOT NULL CHECK (
        cardinality(instructions) BETWEEN 1 AND 6
        AND instructions <@ ARRAY[
            'identify_partner', 'identify_acting_person', 'beneficial_owner',
            'enhanced_due_diligence', 'suspicious_activity_report', 'record_keeping'
        ]::text[]
    ),
    -- 3. Zuverlässigkeit: a) long-standing employee, b) new employee checked by …
    reliability TEXT NOT NULL CHECK (reliability IN ('long_standing', 'new_employee')),
    reliability_interview BOOLEAN NOT NULL DEFAULT false,
    reliability_certificate BOOLEAN NOT NULL DEFAULT false,
    reliability_other BOOLEAN NOT NULL DEFAULT false,
    reliability_other_text TEXT,
    -- Printed under the management's signature line.
    management_name TEXT NOT NULL,
    -- The generated sheet (version 1) and the newest signed scan in the
    -- personnel file.
    document_id UUID NOT NULL UNIQUE REFERENCES personnel_documents(id),
    signed_document_id UUID REFERENCES personnel_documents(id),
    signed_at TIMESTAMPTZ,
    signed_by UUID REFERENCES users(id),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT gwg_staff_trainings_delivery CHECK (
        delivered_by = 'internal'
        OR (delivered_by_other IS NOT NULL AND btrim(delivered_by_other) <> '')
    ),
    CONSTRAINT gwg_staff_trainings_form CHECK (
        (form_oral OR form_material OR form_other)
        AND (NOT form_other OR (form_other_text IS NOT NULL AND btrim(form_other_text) <> ''))
    ),
    CONSTRAINT gwg_staff_trainings_reliability CHECK (
        (reliability = 'long_standing'
            AND NOT reliability_interview AND NOT reliability_certificate AND NOT reliability_other)
        OR (reliability = 'new_employee'
            AND (reliability_interview OR reliability_certificate OR reliability_other)
            AND (NOT reliability_other
                OR (reliability_other_text IS NOT NULL AND btrim(reliability_other_text) <> '')))
    ),
    CONSTRAINT gwg_staff_trainings_signed_shape CHECK (
        (signed_document_id IS NULL AND signed_at IS NULL AND signed_by IS NULL)
        OR (signed_document_id IS NOT NULL AND signed_at IS NOT NULL AND signed_by IS NOT NULL)
    )
);

CREATE INDEX idx_gwg_staff_trainings_employee
    ON gwg_staff_trainings (employee_id, instructed_on DESC, created_at DESC);

-- A record is evidence: what was instructed never changes and no record is
-- deleted. Only the signed copy may be attached (and replaced by a newer scan).
CREATE OR REPLACE FUNCTION gwg_staff_trainings_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'GwG instruction records cannot be deleted'
            USING ERRCODE = 'P0001';
    END IF;
    IF (NEW.id, NEW.employee_id, NEW.instructed_on, NEW.position, NEW.department,
        NEW.delivered_by, NEW.delivered_by_other, NEW.form_oral, NEW.form_material,
        NEW.form_other, NEW.form_other_text, NEW.instructions, NEW.reliability,
        NEW.reliability_interview, NEW.reliability_certificate, NEW.reliability_other,
        NEW.reliability_other_text, NEW.management_name, NEW.document_id,
        NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.employee_id, OLD.instructed_on, OLD.position, OLD.department,
        OLD.delivered_by, OLD.delivered_by_other, OLD.form_oral, OLD.form_material,
        OLD.form_other, OLD.form_other_text, OLD.instructions, OLD.reliability,
        OLD.reliability_interview, OLD.reliability_certificate, OLD.reliability_other,
        OLD.reliability_other_text, OLD.management_name, OLD.document_id,
        OLD.created_by, OLD.created_at)
       OR NEW.signed_document_id IS NULL THEN
        RAISE EXCEPTION 'A GwG instruction record cannot be changed; only a signed copy can be attached'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER gwg_staff_trainings_immutable
BEFORE UPDATE OR DELETE ON gwg_staff_trainings
FOR EACH ROW EXECUTE FUNCTION gwg_staff_trainings_immutable();
