-- Lead cabinet, step 3 "Versicherung & Rechnung" (owner spec 2026-10-11): the
-- invoice recipient comes first and absorbs "who pays".
--
--   "Wer ist Rechnungsempfänger?"   ich / eine andere Person oder Organisation
--   a third party: a person or an organisation, with its data
--   "Ist der Rechnungsempfänger der Zahler?"   ja / nein
--   only with "nein": the payer (lead_payer_declarations, as before)
--
-- The answers live in a table of their own because the lead answers them
-- before anybody is named as payer, and `lead_payer_declarations` needs
-- `payer_kind`. The payer declaration stays the one source of who pays (risk
-- triggers, payer link, payer package, GwG sheets); its section 7
-- (`invoice_to`, `invoice_name` … `invoice_email`) is derived from this row by
-- the server (`routes/lead_invoice_recipient.rs`): `self` for "ich", `payer`
-- for a third party who pays, `other` with the recipient's name and address
-- for a third party who does not pay. A lead without a row (sent before this
-- migration) keeps its section 7 as it is; the cabinet derives the answers
-- from it. See docs/architecture/lead-payer-declaration_ua.md.
CREATE TABLE IF NOT EXISTS lead_invoice_recipients (
    lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
    -- "Wer ist Rechnungsempfänger?": the patient side ('self'; for a minor
    -- the parents as contracting party) or a third party.
    recipient TEXT CHECK (recipient IS NULL OR recipient IN ('self', 'third_party')),
    -- "Ist der Rechnungsempfänger der Zahler?"
    recipient_is_payer BOOLEAN,
    -- A third-party recipient: a natural person or an organisation.
    recipient_type TEXT CHECK (
        recipient_type IS NULL OR recipient_type IN ('person', 'organisation')
    ),
    first_name TEXT CHECK (first_name IS NULL OR char_length(first_name) <= 100),
    last_name TEXT CHECK (last_name IS NULL OR char_length(last_name) <= 100),
    organisation_name TEXT CHECK (
        organisation_name IS NULL OR char_length(organisation_name) <= 200
    ),
    legal_form TEXT CHECK (legal_form IS NULL OR char_length(legal_form) <= 100),
    contact_name TEXT CHECK (contact_name IS NULL OR char_length(contact_name) <= 200),
    street TEXT CHECK (street IS NULL OR char_length(street) <= 200),
    zip TEXT CHECK (zip IS NULL OR char_length(zip) <= 20),
    city TEXT CHECK (city IS NULL OR char_length(city) <= 200),
    country TEXT CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
    -- The e-mail for invoices: of the patient side ('self') or of the
    -- third-party recipient.
    email TEXT CHECK (email IS NULL OR char_length(email) <= 254),
    phone TEXT CHECK (phone IS NULL OR char_length(phone) <= 40),
    -- A person: "Wer ist das für die Patientin / den Patienten?" (the payer's
    -- list of relationships; `other` in words).
    relationship_kind TEXT CHECK (
        relationship_kind IS NULL
        OR relationship_kind IN (
            'spouse', 'parent', 'child', 'sibling', 'grandparent', 'relative',
            'employer', 'friend', 'business_partner', 'other'
        )
    ),
    relationship TEXT CHECK (relationship IS NULL OR char_length(relationship) <= 200),
    -- An organisation that receives the invoice without paying it: why the
    -- invoice goes through it. An organisation that pays states the reason as
    -- `lead_gwg_declarations.payment_background` (block B).
    payment_reason TEXT CHECK (payment_reason IS NULL OR char_length(payment_reason) <= 2000),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
