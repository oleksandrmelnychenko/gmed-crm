-- Owner decision 2026-11-19: every order position carries an explicit tax
-- profile; a pass-through cost (durchlaufender Posten, § 10 Abs. 1 Satz 6
-- UStG) carries «Durchlaufender Posten 0 %». Issued invoices, quotes and
-- credit notes are not touched: they keep the lines they were issued with.

ALTER TABLE tax_profiles DROP CONSTRAINT IF EXISTS tax_profiles_vat_category_check;
ALTER TABLE tax_profiles ADD CONSTRAINT tax_profiles_vat_category_check
    CHECK (vat_category IN ('standard', 'zero_rated', 'exempt', 'reverse_charge', 'custom', 'pass_through'));

INSERT INTO tax_profiles (profile_key, name, description, vat_rate, vat_category, is_default)
VALUES (
    'pass_through_0',
    'Durchlaufender Posten 0 %',
    'Kosten, die GMED im Namen und für Rechnung des Patienten verauslagt (§ 10 Abs. 1 Satz 6 UStG): ohne Umsatzsteuer weiterberechnet; die Vorsteuer des Einkaufs ist nicht die des Patienten.',
    0,
    'pass_through',
    false
)
ON CONFLICT (profile_key) DO NOTHING;

-- Positions without a profile get the one that unambiguously matches. Rows
-- that do not match (a pass-through stored with its purchase VAT, a 0 %
-- line that is neither § 4 Nr. 14 nor exempt by its catalogue item, other
-- rates) stay as they are and are listed for review (read-only SQL in the
-- qa-fix-111 report); the invoice paths bill a pass-through at 0 % anyway.
UPDATE order_leistungen line
SET tax_profile_id = profile.id,
    vat_source = 'tax_profile'
FROM tax_profiles profile
WHERE line.tax_profile_id IS NULL
  AND profile.profile_key = 'pass_through_0'
  AND line.is_cost_passthrough
  AND COALESCE(line.vat_rate, 0) = 0;

UPDATE order_leistungen line
SET tax_profile_id = profile.id,
    vat_source = 'tax_profile'
FROM tax_profiles profile
WHERE line.tax_profile_id IS NULL
  AND profile.profile_key = 'standard_vat'
  AND profile.vat_rate = 19
  AND NOT line.is_cost_passthrough
  AND line.vat_rate = 19;

UPDATE order_leistungen line
SET tax_profile_id = profile.id,
    vat_source = 'tax_profile'
FROM tax_profiles profile, agency_service_catalog catalog
WHERE line.tax_profile_id IS NULL
  AND profile.profile_key = 'termin_fee_0'
  AND catalog.id = line.agency_service_id
  AND catalog.service_key = 'treatment_organization'
  AND NOT line.is_cost_passthrough
  AND COALESCE(line.vat_rate, 0) = 0;
