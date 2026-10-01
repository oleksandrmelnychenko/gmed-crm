-- Invoice to the payer instead of the patient (Rechnungsempfänger).
--
-- 1. A payer can be a relative (patient relation), another patient record or
--    a free-text contact. Relations get their own e-mail and postal address
--    and one of them can be the patient's default payer (e.g. a parent of a
--    minor); orders carry the payer's address and a payer patient record like
--    invoices do.
-- 2. The recipient of a released invoice is frozen (§ 14 Abs. 4 Nr. 1 UStG,
--    GoBD): `recipient_snapshot` is written in the releasing transaction and
--    every document issued afterwards (invoice copy, ZUGFeRD, dunning letter,
--    credit note, cancellation) names that recipient. The payer columns and
--    the snapshot of a released invoice cannot change; deleting a relation a
--    released invoice is addressed to is therefore refused as well.
-- 3. A payment records who remitted it when that is not the recipient.

ALTER TABLE patient_relations
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS address_street TEXT,
    ADD COLUMN IF NOT EXISTS address_zip TEXT,
    ADD COLUMN IF NOT EXISTS address_city TEXT,
    ADD COLUMN IF NOT EXISTS address_country TEXT,
    ADD COLUMN IF NOT EXISTS is_default_payer BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_relations_default_payer
    ON patient_relations(patient_id)
    WHERE is_default_payer;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS payer_patient_id UUID REFERENCES patients(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS payer_address_street TEXT,
    ADD COLUMN IF NOT EXISTS payer_address_zip TEXT,
    ADD COLUMN IF NOT EXISTS payer_address_city TEXT,
    ADD COLUMN IF NOT EXISTS payer_address_country TEXT;

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS payer_patient_id UUID REFERENCES patients(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS recipient_snapshot JSONB;

-- A payer is either a relation or a patient record, never both; a patient
-- does not pay "for themselves" through a payer record.
ALTER TABLE orders
    ADD CONSTRAINT orders_payer_single_record_chk
    CHECK (payer_patient_id IS NULL OR payer_patient_relation_id IS NULL),
    ADD CONSTRAINT orders_payer_patient_not_self_chk
    CHECK (payer_patient_id IS NULL OR payer_patient_id IS DISTINCT FROM patient_id);

ALTER TABLE invoices
    ADD CONSTRAINT invoices_payer_single_record_chk
    CHECK (payer_patient_id IS NULL OR payer_patient_relation_id IS NULL),
    ADD CONSTRAINT invoices_payer_patient_not_self_chk
    CHECK (payer_patient_id IS NULL OR payer_patient_id <> patient_id),
    ADD CONSTRAINT invoices_recipient_snapshot_object_chk
    CHECK (recipient_snapshot IS NULL OR jsonb_typeof(recipient_snapshot) = 'object');

CREATE INDEX IF NOT EXISTS idx_invoices_payer_patient
    ON invoices(payer_patient_id)
    WHERE payer_patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_payer_patient
    ON orders(payer_patient_id)
    WHERE payer_patient_id IS NOT NULL;

ALTER TABLE invoice_payment_transactions
    ADD COLUMN IF NOT EXISTS payer_name TEXT;

-- Contracting party (Auftraggeber) of a framework contract and of an order.
--   patient                — the patient contracts in their own name;
--   patient_represented    — a minor patient is the party, "gesetzlich
--                            vertreten durch" the guardians (§ 1629 BGB);
--   legal_representatives  — the guardians contract in their own name for
--                            the benefit of the patient (§ 328 BGB); they are
--                            the debtors (two of them jointly, § 421 BGB).
-- NULL derives the party: an order follows its framework contract, a minor
-- (at the contract date) gets `legal_representatives`, an adult `patient`.
-- `contracting_relation_ids` names the representatives (patient relations);
-- empty means every recorded parent/guardian.
ALTER TABLE framework_contracts
    ADD COLUMN IF NOT EXISTS contracting_party TEXT
        CHECK (contracting_party IN ('patient', 'patient_represented', 'legal_representatives')),
    ADD COLUMN IF NOT EXISTS contracting_relation_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS contracting_party TEXT
        CHECK (contracting_party IN ('patient', 'patient_represented', 'legal_representatives')),
    ADD COLUMN IF NOT EXISTS contracting_relation_ids UUID[] NOT NULL DEFAULT '{}',
    -- How the order payer relates to the contracting party: the party itself,
    -- or a deliberately chosen different recipient (Kostenübernehmer).
    ADD COLUMN IF NOT EXISTS payer_role TEXT
        CHECK (payer_role IN ('contracting_party', 'cost_bearer'));

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS payer_role TEXT
        CHECK (payer_role IN ('contracting_party', 'cost_bearer'));

-- Title, first and last name joined, NULL when all are blank.
CREATE OR REPLACE FUNCTION gmed_person_display_name(p_title TEXT, p_first TEXT, p_last TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(
        concat_ws(' ', NULLIF(btrim(p_title), ''), NULLIF(btrim(p_first), ''), NULLIF(btrim(p_last), '')),
        ''
    )
$$;

-- The recipient an invoice is addressed to, as stored in `recipient_snapshot`.
--
-- Without a payer it is the patient. With a payer the name is the free-text
-- contact name, else the payer's patient record, else the relation's name.
-- The address is the one entered for the payer on the invoice, else the
-- relation's own address, else the payer's patient record; a payer is never
-- given the patient's address. The e-mail follows the same order.
--
-- The application reads every recipient through this function (drafts live,
-- released invoices from their snapshot), so the printed invoice, the
-- e-invoice and all later documents agree.
CREATE OR REPLACE FUNCTION invoice_recipient_resolve(
    p_patient_id UUID,
    p_payer_patient_id UUID,
    p_payer_relation_id UUID,
    p_contact_name TEXT,
    p_contact_email TEXT,
    p_street TEXT,
    p_zip TEXT,
    p_city TEXT,
    p_country TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    contact_name TEXT := NULLIF(btrim(p_contact_name), '');
    patient_name TEXT;
    patient_email TEXT;
    patient_street TEXT;
    patient_zip TEXT;
    patient_city TEXT;
    patient_country TEXT;
    patient_residence TEXT;
    relation_found BOOLEAN := false;
    relation_name TEXT;
    relation_patient_id UUID;
    relation_email TEXT;
    relation_street TEXT;
    relation_zip TEXT;
    relation_city TEXT;
    relation_country TEXT;
    person_id UUID;
    person_found BOOLEAN := false;
    person_name TEXT;
    person_email TEXT;
    person_street TEXT;
    person_zip TEXT;
    person_city TEXT;
    person_country TEXT;
    person_residence TEXT;
    recipient_kind TEXT;
    result_street TEXT;
    result_zip TEXT;
    result_city TEXT;
    result_country TEXT;
    result_residence TEXT;
BEGIN
    SELECT gmed_person_display_name(title, first_name, last_name),
           NULLIF(btrim(email), ''),
           NULLIF(btrim(address_street), ''), NULLIF(btrim(address_zip), ''),
           NULLIF(btrim(address_city), ''), NULLIF(btrim(address_country), ''),
           NULLIF(btrim(residence_country), '')
      INTO patient_name, patient_email, patient_street, patient_zip, patient_city,
           patient_country, patient_residence
      FROM patients
     WHERE id = p_patient_id;

    IF contact_name IS NULL AND p_payer_patient_id IS NULL AND p_payer_relation_id IS NULL THEN
        RETURN jsonb_build_object(
            'version', 1,
            'kind', 'patient',
            'is_payer', false,
            'name', COALESCE(patient_name, ''),
            'street', patient_street,
            'zip', patient_zip,
            'city', patient_city,
            'country', patient_country,
            'residence_country', patient_residence,
            'email', patient_email,
            'payer_patient_id', NULL,
            'payer_patient_relation_id', NULL,
            'person_patient_id', NULL
        );
    END IF;

    IF p_payer_relation_id IS NOT NULL THEN
        SELECT NULLIF(btrim(related_name), ''), related_patient_id,
               NULLIF(btrim(email), ''),
               NULLIF(btrim(address_street), ''), NULLIF(btrim(address_zip), ''),
               NULLIF(btrim(address_city), ''), NULLIF(btrim(address_country), '')
          INTO relation_name, relation_patient_id, relation_email, relation_street,
               relation_zip, relation_city, relation_country
          FROM patient_relations
         WHERE id = p_payer_relation_id;
        relation_found := FOUND;
    END IF;

    IF p_payer_patient_id IS NOT NULL THEN
        person_id := p_payer_patient_id;
        recipient_kind := 'payer_patient';
    ELSIF relation_found THEN
        person_id := relation_patient_id;
        recipient_kind := 'relation';
    ELSE
        recipient_kind := 'contact';
    END IF;

    IF person_id IS NOT NULL THEN
        SELECT gmed_person_display_name(title, first_name, last_name),
               NULLIF(btrim(email), ''),
               NULLIF(btrim(address_street), ''), NULLIF(btrim(address_zip), ''),
               NULLIF(btrim(address_city), ''), NULLIF(btrim(address_country), ''),
               NULLIF(btrim(residence_country), '')
          INTO person_name, person_email, person_street, person_zip, person_city,
               person_country, person_residence
          FROM patients
         WHERE id = person_id;
        person_found := FOUND;
    END IF;

    IF COALESCE(NULLIF(btrim(p_street), ''), NULLIF(btrim(p_zip), ''),
                NULLIF(btrim(p_city), ''), NULLIF(btrim(p_country), '')) IS NOT NULL THEN
        result_street := NULLIF(btrim(p_street), '');
        result_zip := NULLIF(btrim(p_zip), '');
        result_city := NULLIF(btrim(p_city), '');
        result_country := NULLIF(btrim(p_country), '');
    ELSIF COALESCE(relation_street, relation_zip, relation_city, relation_country) IS NOT NULL THEN
        result_street := relation_street;
        result_zip := relation_zip;
        result_city := relation_city;
        result_country := relation_country;
    ELSIF person_found THEN
        result_street := person_street;
        result_zip := person_zip;
        result_city := person_city;
        result_country := person_country;
        result_residence := person_residence;
    END IF;

    RETURN jsonb_build_object(
        'version', 1,
        'kind', recipient_kind,
        'is_payer', true,
        'name', COALESCE(contact_name, person_name, relation_name, patient_name, ''),
        'street', result_street,
        'zip', result_zip,
        'city', result_city,
        'country', result_country,
        'residence_country', result_residence,
        'email', COALESCE(NULLIF(btrim(p_contact_email), ''), relation_email, person_email),
        'payer_patient_id', p_payer_patient_id,
        'payer_patient_relation_id', CASE WHEN relation_found THEN p_payer_relation_id END,
        -- The patient record of the person who pays (directly or as the
        -- relative's own record): identifies the same payer across invoices.
        'person_patient_id', CASE WHEN person_found THEN person_id END
    );
END;
$$;

-- Who a recipient is, for comparing invoices of one patient: the patient,
-- the paying person's patient record, the relation, else the name. Advances
-- are deducted (§ 14 Abs. 5 Satz 2 UStG) and credit is moved only between
-- invoices of the same recipient.
CREATE OR REPLACE FUNCTION invoice_recipient_identity(p_recipient JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_recipient IS NULL THEN NULL
        WHEN COALESCE(p_recipient ->> 'kind', 'patient') = 'patient' THEN 'patient'
        WHEN p_recipient ->> 'person_patient_id' IS NOT NULL
            THEN 'person:' || (p_recipient ->> 'person_patient_id')
        WHEN p_recipient ->> 'payer_patient_relation_id' IS NOT NULL
            THEN 'relation:' || (p_recipient ->> 'payer_patient_relation_id')
        ELSE 'name:' || lower(regexp_replace(btrim(COALESCE(p_recipient ->> 'name', '')), '\s+', ' ', 'g'))
    END
$$;

-- Already released invoices keep the recipient they name today.
ALTER TABLE invoices DISABLE TRIGGER set_updated_at_invoices;

UPDATE invoices
SET recipient_snapshot = invoice_recipient_resolve(
        patient_id, payer_patient_id, payer_patient_relation_id,
        payer_contact_name, payer_contact_email,
        payer_address_street, payer_address_zip, payer_address_city, payer_address_country
    ) || jsonb_build_object('captured', 'migration', 'captured_at', now())
WHERE released_at IS NOT NULL
  AND recipient_snapshot IS NULL;

ALTER TABLE invoices ENABLE TRIGGER set_updated_at_invoices;

-- Freezes the recipient once an invoice is released and captures it when the
-- release did not (any release path, including direct inserts). Runs after
-- `invoices_release_guard`, which sets `released_at` (triggers fire in name
-- order).
CREATE OR REPLACE FUNCTION invoices_release_recipient_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.released_at IS NOT NULL THEN
        IF NEW.payer_patient_relation_id IS DISTINCT FROM OLD.payer_patient_relation_id
           OR NEW.payer_patient_id IS DISTINCT FROM OLD.payer_patient_id
           OR NEW.payer_contact_name IS DISTINCT FROM OLD.payer_contact_name
           OR NEW.payer_contact_email IS DISTINCT FROM OLD.payer_contact_email
           OR NEW.payer_address_street IS DISTINCT FROM OLD.payer_address_street
           OR NEW.payer_address_zip IS DISTINCT FROM OLD.payer_address_zip
           OR NEW.payer_address_city IS DISTINCT FROM OLD.payer_address_city
           OR NEW.payer_address_country IS DISTINCT FROM OLD.payer_address_country
           OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
           OR NEW.payer_role IS DISTINCT FROM OLD.payer_role
           OR (OLD.recipient_snapshot IS NOT NULL
               AND NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot)
        THEN
            RAISE EXCEPTION 'The recipient of a released invoice cannot change'
                USING ERRCODE = 'P0001', CONSTRAINT = 'invoice_recipient_frozen';
        END IF;
    END IF;

    IF NEW.released_at IS NOT NULL AND NEW.recipient_snapshot IS NULL THEN
        NEW.recipient_snapshot := invoice_recipient_resolve(
            NEW.patient_id, NEW.payer_patient_id, NEW.payer_patient_relation_id,
            NEW.payer_contact_name, NEW.payer_contact_email,
            NEW.payer_address_street, NEW.payer_address_zip,
            NEW.payer_address_city, NEW.payer_address_country
        ) || jsonb_build_object('captured', 'release', 'captured_at', now());
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_release_recipient_snapshot ON invoices;
CREATE TRIGGER invoices_release_recipient_snapshot
    BEFORE INSERT OR UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION invoices_release_recipient_snapshot();
