-- Seller data the EN 16931 e-invoice (ZUGFeRD / Factur-X) cannot be issued without.
-- Administrators fill the tax registration in; nothing is guessed here.
INSERT INTO system_settings (key, value, description)
VALUES
    ('agency_vat_id', '""', 'Agency VAT ID (USt-IdNr.) used in e-invoices'),
    ('agency_tax_number', '""', 'Agency tax number (Steuernummer) used in e-invoices'),
    ('agency_country_code', '"DE"', 'Agency ISO 3166-1 alpha-2 country code used in e-invoices')
ON CONFLICT (key) DO NOTHING;
