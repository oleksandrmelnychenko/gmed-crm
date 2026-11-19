-- QA3 (qa-fix-115, tester B S2-2, tester C S3-7): each tax profile carries
-- its own reason for a line without VAT, printed on the German documents and
-- written into the e-invoice (BT-120), and optionally its VATEX code (BT-121).
-- Before, every 0 % line that was not a pass-through cost printed
-- «Steuerfreie Heilbehandlung nach § 4 Nr. 14 UStG», also the generic
-- «VAT exempt» profile. Reasons are editable in «Налоговые профили»; issued
-- invoices keep the stored PDF they were released with.
--
-- Durchlaufende Posten are § 10 Abs. 1 Satz 5 UStG (Satz 6 is the
-- Mehrzweck-Gutschein rule since 2019): the description of
-- «Durchlaufender Posten 0 %» cited Satz 6 and now cites Satz 5 like the
-- documents and the e-invoice.

ALTER TABLE tax_profiles
    ADD COLUMN IF NOT EXISTS exemption_reason TEXT,
    ADD COLUMN IF NOT EXISTS exemption_reason_code TEXT;

COMMENT ON COLUMN tax_profiles.exemption_reason IS
    'German reason printed for lines of this profile without VAT (BT-120); none for a taxed profile.';
COMMENT ON COLUMN tax_profiles.exemption_reason_code IS
    'VATEX code of the reason (BT-121), e.g. VATEX-EU-132; optional.';

UPDATE tax_profiles
SET exemption_reason = 'Steuerfreie Heilbehandlung nach § 4 Nr. 14 UStG',
    exemption_reason_code = 'VATEX-EU-132'
WHERE profile_key = 'termin_fee_0'
  AND exemption_reason IS NULL;

UPDATE tax_profiles
SET exemption_reason = 'Steuerfreie Leistung'
WHERE profile_key = 'vat_exempt_0'
  AND exemption_reason IS NULL;

UPDATE tax_profiles
SET exemption_reason = 'Durchlaufender Posten gemäß § 10 Abs. 1 Satz 5 UStG',
    description = replace(description, '§ 10 Abs. 1 Satz 6 UStG', '§ 10 Abs. 1 Satz 5 UStG')
WHERE profile_key = 'pass_through_0';

-- QA3 C (legacy rows): pass-through costs stored with their purchase VAT and
-- no profile already bill 0 % (every invoice path bills a pass-through at
-- 0 %); they now carry «Durchlaufender Posten 0 %» too. Only the profile is
-- set: the stored rate and amounts the client signed stay as they were.
UPDATE order_leistungen line
SET tax_profile_id = profile.id,
    vat_source = 'tax_profile'
FROM tax_profiles profile
WHERE line.tax_profile_id IS NULL
  AND line.is_cost_passthrough
  AND profile.profile_key = 'pass_through_0';

-- QA3 C S2-4: a line planned for a visit («Добавить в смету») is linked to
-- the appointment, so its completion delivers that line instead of adding a
-- second one. A cancelled line gives the visit up: the link is cleared, the
-- visit can get a new line and its completion bills again.
CREATE OR REPLACE FUNCTION release_cancelled_order_line_appointment()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
        NEW.source_medical_appointment_id := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS release_cancelled_order_line_appointment ON order_leistungen;
CREATE TRIGGER release_cancelled_order_line_appointment
    BEFORE UPDATE OF status ON order_leistungen
    FOR EACH ROW
    WHEN (NEW.source_medical_appointment_id IS NOT NULL)
    EXECUTE FUNCTION release_cancelled_order_line_appointment();

UPDATE order_leistungen
SET source_medical_appointment_id = NULL
WHERE status = 'cancelled'
  AND source_medical_appointment_id IS NOT NULL;
