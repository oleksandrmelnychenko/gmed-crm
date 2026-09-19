-- Seller identity for EN 16931 e-invoices (ZUGFeRD / XRechnung): a structured
-- postal address and the tax identifiers. The free-text agency_address stays
-- the print block for letters; these fields feed the machine-readable invoice.
INSERT INTO system_settings (key, value, description)
VALUES
    ('agency_street', to_jsonb('Albert-Schweitzer-Straße 56'::text), 'Agency street and number for e-invoices (BT-35)'),
    ('agency_postal_code', to_jsonb('81735'::text), 'Agency postal code for e-invoices (BT-38)'),
    ('agency_city', to_jsonb('München'::text), 'Agency city for e-invoices (BT-37)'),
    ('agency_country', to_jsonb('DE'::text), 'Agency country, ISO 3166-1 alpha-2, for e-invoices (BT-40)'),
    ('agency_vat_id', to_jsonb(''::text), 'Agency USt-IdNr. for e-invoices (BT-31); required once any line carries VAT'),
    ('agency_tax_number', to_jsonb(''::text), 'Agency Steuernummer for e-invoices (BT-32); identifies a seller without USt-IdNr.')
ON CONFLICT (key) DO NOTHING;
