-- Concierge expense receipts are operational submissions first and financial
-- records only after an explicit finance review.  The submission and every
-- review decision are append-only; approved amounts are posted through the
-- existing external invoice/provider settlement ledgers.

CREATE TABLE concierge_expense_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concierge_service_id UUID NOT NULL
        REFERENCES concierge_services(id) ON DELETE RESTRICT,
    request_id UUID NOT NULL,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
    order_leistung_id UUID REFERENCES order_leistungen(id) ON DELETE RESTRICT,
    receipt_document_id UUID NOT NULL UNIQUE
        REFERENCES documents(id) ON DELETE RESTRICT,
    vendor_name TEXT NOT NULL CHECK (length(trim(vendor_name)) BETWEEN 1 AND 200),
    expense_date DATE NOT NULL CHECK (expense_date <= CURRENT_DATE),
    amount_net NUMERIC(12, 2) NOT NULL CHECK (amount_net >= 0),
    amount_vat NUMERIC(12, 2) NOT NULL CHECK (amount_vat >= 0),
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross > 0),
    currency TEXT NOT NULL CHECK (
        currency = upper(currency)
        AND currency ~ '^[A-Z]{3}$'
    ),
    paid_by TEXT NOT NULL CHECK (paid_by IN ('patient', 'agency', 'unpaid')),
    service_delivered BOOLEAN NOT NULL DEFAULT false,
    note TEXT CHECK (note IS NULL OR length(note) <= 2000),
    payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    receipt_sha256 TEXT NOT NULL CHECK (receipt_sha256 ~ '^[0-9a-f]{64}$'),
    submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT concierge_expense_line_requires_order
        CHECK (order_leistung_id IS NULL OR order_id IS NOT NULL),
    CONSTRAINT concierge_expense_amount_arithmetic
        CHECK (amount_net + amount_vat = amount_gross),
    CONSTRAINT concierge_expense_service_request_unique
        UNIQUE (concierge_service_id, request_id),
    CONSTRAINT concierge_expense_service_receipt_unique
        UNIQUE (concierge_service_id, receipt_sha256)
);

CREATE INDEX idx_concierge_expense_submissions_service
    ON concierge_expense_submissions(concierge_service_id, created_at DESC);
CREATE INDEX idx_concierge_expense_submissions_patient
    ON concierge_expense_submissions(patient_id, created_at DESC);
CREATE INDEX idx_concierge_expense_submissions_order
    ON concierge_expense_submissions(order_id, created_at DESC);

CREATE TABLE concierge_expense_review_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id UUID NOT NULL
        REFERENCES concierge_expense_submissions(id) ON DELETE RESTRICT,
    request_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('posted', 'rejected', 'reversed')),
    reason TEXT,
    reverses_event_id UUID
        REFERENCES concierge_expense_review_events(id) ON DELETE RESTRICT,
    external_invoice_id UUID REFERENCES external_invoices(id) ON DELETE RESTRICT,
    provider_payment_transaction_id UUID
        REFERENCES external_invoice_provider_payment_transactions(id) ON DELETE RESTRICT,
    payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    decided_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT concierge_expense_review_shape CHECK (
        (
            action = 'posted'
            AND reverses_event_id IS NULL
            AND external_invoice_id IS NOT NULL
            AND (reason IS NULL OR length(trim(reason)) <= 2000)
        ) OR (
            action = 'rejected'
            AND reverses_event_id IS NULL
            AND external_invoice_id IS NULL
            AND provider_payment_transaction_id IS NULL
            AND length(trim(reason)) BETWEEN 1 AND 2000
        ) OR (
            action = 'reversed'
            AND reverses_event_id IS NOT NULL
            AND external_invoice_id IS NOT NULL
            AND provider_payment_transaction_id IS NULL
            AND length(trim(reason)) BETWEEN 1 AND 2000
        )
    ),
    UNIQUE (expense_id, request_id)
);

CREATE UNIQUE INDEX uq_concierge_expense_initial_review
    ON concierge_expense_review_events(expense_id)
    WHERE action IN ('posted', 'rejected');
CREATE UNIQUE INDEX uq_concierge_expense_review_reversal
    ON concierge_expense_review_events(reverses_event_id)
    WHERE action = 'reversed';
CREATE INDEX idx_concierge_expense_review_external_invoice
    ON concierge_expense_review_events(external_invoice_id)
    WHERE external_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX uq_concierge_expense_posted_external_invoice
    ON concierge_expense_review_events(external_invoice_id)
    WHERE action = 'posted';

CREATE OR REPLACE FUNCTION validate_concierge_expense_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    service_patient UUID;
    order_patient UUID;
    order_currency TEXT;
    leistung_order UUID;
    leistung_currency TEXT;
    document_patient UUID;
    document_order UUID;
    document_visibility TEXT;
    document_is_medical BOOLEAN;
BEGIN
    SELECT patient_id
    INTO service_patient
    FROM concierge_services
    WHERE id = NEW.concierge_service_id
    FOR UPDATE;

    IF service_patient IS NULL OR NEW.patient_id <> service_patient
    THEN
        RAISE EXCEPTION 'concierge expense patient and service must match';
    END IF;

    IF NEW.order_id IS NOT NULL THEN
        SELECT patient_id, upper(currency)
        INTO order_patient, order_currency
        FROM orders
        WHERE id = NEW.order_id
        FOR UPDATE;
        IF order_patient IS NULL OR NEW.patient_id <> order_patient THEN
            RAISE EXCEPTION 'concierge expense order must belong to the same patient';
        END IF;
        IF order_currency <> NEW.currency THEN
            RAISE EXCEPTION 'concierge expense currency must match the order';
        END IF;
    END IF;

    IF NEW.order_leistung_id IS NOT NULL THEN
        SELECT order_id, upper(currency)
        INTO leistung_order, leistung_currency
        FROM order_leistungen
        WHERE id = NEW.order_leistung_id
        FOR UPDATE;
        IF leistung_order IS NULL
           OR leistung_order <> NEW.order_id
           OR leistung_currency <> NEW.currency
        THEN
            RAISE EXCEPTION 'concierge expense service line must match order and currency';
        END IF;
    END IF;

    SELECT patient_id, order_id, visibility, is_medical
    INTO document_patient, document_order, document_visibility, document_is_medical
    FROM documents
    WHERE id = NEW.receipt_document_id
    FOR UPDATE;
    IF document_patient IS NULL
       OR document_patient <> NEW.patient_id
       OR document_order IS DISTINCT FROM NEW.order_id
       OR document_visibility <> 'internal'
       OR document_is_medical
    THEN
        RAISE EXCEPTION 'receipt document must be internal, non-medical, and bound to the same patient and order';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_concierge_expense_submission_trigger
    BEFORE INSERT ON concierge_expense_submissions
    FOR EACH ROW EXECUTE FUNCTION validate_concierge_expense_submission();

CREATE OR REPLACE FUNCTION protect_concierge_expense_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'concierge expense records are append-only';
END;
$$;

CREATE TRIGGER protect_concierge_expense_submission_trigger
    BEFORE UPDATE OR DELETE ON concierge_expense_submissions
    FOR EACH ROW EXECUTE FUNCTION protect_concierge_expense_append_only();
CREATE TRIGGER protect_concierge_expense_review_event_trigger
    BEFORE UPDATE OR DELETE ON concierge_expense_review_events
    FOR EACH ROW EXECUTE FUNCTION protect_concierge_expense_append_only();

CREATE OR REPLACE FUNCTION validate_concierge_expense_review_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    submission concierge_expense_submissions%ROWTYPE;
    external_row external_invoices%ROWTYPE;
    original concierge_expense_review_events%ROWTYPE;
    provider_payment external_invoice_provider_payment_transactions%ROWTYPE;
    net_provider_paid NUMERIC(12, 2);
BEGIN
    SELECT * INTO submission
    FROM concierge_expense_submissions
    WHERE id = NEW.expense_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'concierge expense submission does not exist';
    END IF;

    IF NEW.action = 'posted' THEN
        SELECT * INTO external_row
        FROM external_invoices
        WHERE id = NEW.external_invoice_id
        FOR UPDATE;
        IF NOT FOUND
           OR external_row.patient_id <> submission.patient_id
           OR (submission.order_id IS NOT NULL AND external_row.order_id <> submission.order_id)
           OR (submission.order_leistung_id IS NOT NULL
               AND external_row.order_leistung_id IS DISTINCT FROM submission.order_leistung_id)
           OR upper(external_row.currency) <> submission.currency
           OR external_row.amount_net <> submission.amount_net
           OR external_row.amount_vat <> submission.amount_vat
           OR external_row.amount_gross <> submission.amount_gross
           OR external_row.invoice_date IS DISTINCT FROM submission.expense_date
           OR external_row.service_delivered IS DISTINCT FROM submission.service_delivered
        THEN
            RAISE EXCEPTION 'posted external invoice must mirror the concierge expense';
        END IF;
        IF submission.paid_by = 'patient'
           AND NOT (external_row.status = 'paid' AND external_row.paid_by = 'patient')
        THEN
            RAISE EXCEPTION 'patient-paid expense must remain patient-paid';
        ELSIF submission.paid_by = 'agency'
           AND NOT (external_row.status = 'paid' AND external_row.paid_by = 'agency')
        THEN
            RAISE EXCEPTION 'agency-paid expense must be posted through provider settlement';
        ELSIF submission.paid_by = 'unpaid'
           AND NOT (
               external_row.paid_by = 'unpaid'
               AND external_row.status IN ('received', 'approved', 'overdue')
           )
        THEN
            RAISE EXCEPTION 'unpaid expense must remain unpaid';
        END IF;
        IF submission.paid_by <> 'patient'
           AND (
               external_row.provider_id IS NULL
               OR NOT EXISTS (
                   SELECT 1 FROM providers provider
                   WHERE provider.id = external_row.provider_id
                     AND provider.provider_type = 'non_medical'
                     AND provider.is_active
               )
           )
        THEN
            RAISE EXCEPTION 'posted concierge provider must be an active non-medical partner';
        END IF;
        IF NEW.provider_payment_transaction_id IS NOT NULL THEN
            SELECT * INTO provider_payment
            FROM external_invoice_provider_payment_transactions
            WHERE id = NEW.provider_payment_transaction_id
            FOR UPDATE;
            IF NOT FOUND
               OR provider_payment.external_invoice_id <> NEW.external_invoice_id
               OR provider_payment.transaction_type <> 'payment'
               OR provider_payment.amount_gross <> submission.amount_gross
               OR provider_payment.currency <> submission.currency
            THEN
                RAISE EXCEPTION 'provider payment must be the full payment for the posted expense';
            END IF;
        ELSIF submission.paid_by = 'agency' THEN
            RAISE EXCEPTION 'agency-paid expense requires its canonical provider payment';
        END IF;
    ELSIF NEW.action = 'reversed' THEN
        SELECT * INTO original
        FROM concierge_expense_review_events
        WHERE id = NEW.reverses_event_id
        FOR UPDATE;
        IF NOT FOUND
           OR original.expense_id <> NEW.expense_id
           OR original.action <> 'posted'
           OR original.external_invoice_id <> NEW.external_invoice_id
        THEN
            RAISE EXCEPTION 'reversal must reference the posted concierge expense';
        END IF;
        SELECT COALESCE(SUM(
            CASE WHEN payment.transaction_type = 'payment'
                 THEN payment.amount_gross ELSE -payment.amount_gross END
        ), 0)
        INTO net_provider_paid
        FROM external_invoice_provider_payment_transactions payment
        WHERE payment.external_invoice_id = NEW.external_invoice_id;
        IF net_provider_paid <> 0 THEN
            RAISE EXCEPTION 'reverse provider payments before reversing the concierge expense';
        END IF;
        PERFORM patient_invoice.id
        FROM external_invoice_patient_invoice_allocations allocation
        JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
        WHERE allocation.external_invoice_id = NEW.external_invoice_id
        ORDER BY patient_invoice.id
        FOR UPDATE OF patient_invoice;
        IF EXISTS (
            SELECT 1
            FROM external_invoice_patient_invoice_allocations allocation
            JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
            WHERE allocation.external_invoice_id = NEW.external_invoice_id
              AND allocation.reversed_at IS NULL
              AND patient_invoice.status NOT IN ('draft', 'cancelled')
        ) THEN
            RAISE EXCEPTION 'reverse patient invoice allocations before reversing the concierge expense';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM external_invoice_patient_invoice_allocations allocation
            JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
            WHERE allocation.external_invoice_id = NEW.external_invoice_id
              AND patient_invoice.status NOT IN ('draft', 'cancelled')
            GROUP BY allocation.patient_invoice_id, patient_invoice.credited_amount
            HAVING COALESCE(patient_invoice.credited_amount, 0)
                   < SUM(allocation.amount_gross)
        ) THEN
            RAISE EXCEPTION 'correct patient invoices before reversing the concierge expense';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_concierge_expense_review_event_trigger
    BEFORE INSERT ON concierge_expense_review_events
    FOR EACH ROW EXECUTE FUNCTION validate_concierge_expense_review_event();

-- The receipt is immutable provenance.  It stays available after rejection or
-- financial reversal and cannot be silently replaced through the documents API.
CREATE OR REPLACE FUNCTION protect_concierge_expense_receipt_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM concierge_expense_submissions submission
        WHERE submission.receipt_document_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'concierge expense receipt documents are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER protect_concierge_expense_receipt_document_trigger
    BEFORE UPDATE OR DELETE ON documents
    FOR EACH ROW EXECUTE FUNCTION protect_concierge_expense_receipt_document();

-- A posted unpaid expense remains payable through the canonical provider
-- settlement journal.  Lock all receipt/identity facts, but permit the exact
-- status/payer transitions justified by the current append-only net payment.
CREATE OR REPLACE FUNCTION protect_posted_concierge_expense_external_invoice()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    has_active_review BOOLEAN;
    net_provider_paid NUMERIC(12, 2);
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM concierge_expense_review_events posted
        WHERE posted.external_invoice_id = OLD.id
          AND posted.action = 'posted'
          AND NOT EXISTS (
              SELECT 1 FROM concierge_expense_review_events reversal
              WHERE reversal.reverses_event_id = posted.id
                AND reversal.action = 'reversed'
          )
    ) INTO has_active_review;
    IF NOT has_active_review THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'reverse the concierge expense review before deleting its posted invoice';
    END IF;
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
       OR NEW.order_leistung_id IS DISTINCT FROM OLD.order_leistung_id
       OR NEW.external_invoice_number IS DISTINCT FROM OLD.external_invoice_number
       OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.amount_net IS DISTINCT FROM OLD.amount_net
       OR NEW.amount_vat IS DISTINCT FROM OLD.amount_vat
       OR NEW.amount_gross IS DISTINCT FROM OLD.amount_gross
       OR upper(NEW.currency) IS DISTINCT FROM upper(OLD.currency)
       OR NEW.notes IS DISTINCT FROM OLD.notes
    THEN
        RAISE EXCEPTION 'posted concierge expense invoice facts are immutable';
    END IF;
    IF NEW.status = 'cancelled' THEN
        RAISE EXCEPTION 'reverse the concierge expense review before cancelling its posted invoice';
    END IF;
    IF OLD.service_delivered AND NOT NEW.service_delivered THEN
        RAISE EXCEPTION 'posted concierge expense delivery can only advance to delivered';
    END IF;

    SELECT COALESCE(SUM(
        CASE WHEN payment.transaction_type = 'payment'
             THEN payment.amount_gross ELSE -payment.amount_gross END
    ), 0)
    INTO net_provider_paid
    FROM external_invoice_provider_payment_transactions payment
    WHERE payment.external_invoice_id = OLD.id;

    IF OLD.status = 'paid' AND OLD.paid_by = 'patient' THEN
        IF NEW.status IS DISTINCT FROM OLD.status
           OR NEW.paid_by IS DISTINCT FROM OLD.paid_by
           OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
        THEN
            RAISE EXCEPTION 'patient-paid concierge expense settlement is immutable';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status = 'paid' AND NEW.paid_by = 'agency' THEN
        IF net_provider_paid <> NEW.amount_gross OR NEW.paid_at IS NULL THEN
            RAISE EXCEPTION 'agency-paid status requires the full provider payment journal';
        END IF;
    ELSIF NEW.status IN ('received', 'approved', 'overdue') AND NEW.paid_by = 'unpaid' THEN
        IF net_provider_paid >= NEW.amount_gross OR NEW.paid_at IS NOT NULL THEN
            RAISE EXCEPTION 'unpaid status must match the provider payment journal';
        END IF;
    ELSE
        RAISE EXCEPTION 'posted concierge expense only permits canonical provider settlement transitions';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER protect_posted_concierge_expense_external_invoice_trigger
    BEFORE UPDATE OR DELETE ON external_invoices
    FOR EACH ROW EXECUTE FUNCTION protect_posted_concierge_expense_external_invoice();

-- Accounting entries normally require an active account. A reversal must stay
-- on the historical account even when finance deactivated it after payment.
-- Permit only an exact provider-payment reversal entry already validated by
-- the append-only provider settlement trigger; all new outflows remain blocked.
CREATE OR REPLACE FUNCTION assign_and_validate_accounting_entry_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    account_currency TEXT;
    account_active BOOLEAN;
    provider_tx external_invoice_provider_payment_transactions%ROWTYPE;
BEGIN
    NEW.currency := upper(NEW.currency);
    IF NEW.financial_account_id IS NULL THEN
        SELECT account.id
        INTO NEW.financial_account_id
        FROM company_financial_accounts account
        WHERE account.currency = NEW.currency
          AND account.is_default
          AND account.is_active
        LIMIT 1;
        RETURN NEW;
    END IF;

    SELECT currency, is_active
    INTO account_currency, account_active
    FROM company_financial_accounts
    WHERE id = NEW.financial_account_id
    FOR SHARE;

    IF NOT FOUND OR account_currency <> NEW.currency THEN
        RAISE EXCEPTION 'Financial account must use the accounting entry currency';
    END IF;
    IF TG_OP = 'INSERT' AND NOT account_active THEN
        IF NEW.entry_kind <> 'external_invoice_payment'
           OR NEW.direction <> 'expense'
           OR NEW.category <> 'provider_expense'
           OR NEW.source_external_provider_payment_transaction_id IS NULL
        THEN
            RAISE EXCEPTION 'Financial account is inactive';
        END IF;
        SELECT * INTO provider_tx
        FROM external_invoice_provider_payment_transactions
        WHERE id = NEW.source_external_provider_payment_transaction_id
        FOR SHARE;
        IF NOT FOUND
           OR provider_tx.transaction_type <> 'reversal'
           OR provider_tx.financial_account_id <> NEW.financial_account_id
           OR provider_tx.external_invoice_id IS DISTINCT FROM NEW.source_external_invoice_id
           OR provider_tx.currency <> NEW.currency
           OR NEW.amount_gross <> -provider_tx.amount_gross
        THEN
            RAISE EXCEPTION 'Inactive account only accepts its exact provider payment reversal';
        END IF;
    ELSIF TG_OP = 'UPDATE'
          AND OLD.financial_account_id IS DISTINCT FROM NEW.financial_account_id
          AND NOT account_active THEN
        RAISE EXCEPTION 'Financial account is inactive';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON TABLE concierge_expense_submissions IS
    'Immutable Concierge receipt submissions pending an authorized finance review.';
COMMENT ON TABLE concierge_expense_review_events IS
    'Append-only post, rejection, and reversal decisions for Concierge expense receipts.';
