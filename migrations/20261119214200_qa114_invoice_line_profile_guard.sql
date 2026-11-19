-- QA3 D S2-2 (qa-fix-114): an invoice line stored the new tax profile of its
-- service («VAT exempt 0 %») with the old VAT rate of the estimate (19 %).
-- An invoice line that names a tax profile bills that profile's rate and
-- category, always: a new or changed line set of an invoice is refused when
-- a line's VAT rate or category contradicts its profile. Stored invoices
-- are not rewritten; the check runs when lines are written.

CREATE OR REPLACE FUNCTION validate_invoice_line_tax_profiles()
RETURNS trigger AS $$
DECLARE
    offending TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.line_items IS NOT DISTINCT FROM OLD.line_items THEN
        RETURN NEW;
    END IF;
    IF jsonb_typeof(NEW.line_items) <> 'array' THEN
        RETURN NEW;
    END IF;
    SELECT line.value ->> 'description'
    INTO offending
    FROM jsonb_array_elements(NEW.line_items) AS line(value)
    JOIN tax_profiles profile
      ON COALESCE(line.value ->> 'tax_profile_id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND profile.id = (line.value ->> 'tax_profile_id')::UUID
    WHERE ROUND(COALESCE(NULLIF(line.value ->> 'vat_rate', '')::NUMERIC, 0), 2)
              <> CASE WHEN profile.vat_category = 'pass_through' THEN 0
                      ELSE ROUND(profile.vat_rate, 2) END
       OR (NULLIF(line.value ->> 'vat_category', '') IS NOT NULL
           AND line.value ->> 'vat_category' <> profile.vat_category)
    LIMIT 1;
    IF offending IS NOT NULL THEN
        RAISE EXCEPTION 'Invoice line % contradicts its tax profile (VAT rate or category)', offending
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'invoice_line_tax_profile_consistent';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_invoice_line_tax_profiles ON invoices;
CREATE TRIGGER validate_invoice_line_tax_profiles
    BEFORE INSERT OR UPDATE OF line_items ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION validate_invoice_line_tax_profiles();
