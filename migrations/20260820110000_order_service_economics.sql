-- Order economics needs an explicit planned provider cost and a durable link
-- from an actual provider invoice to the service that incurred it.

ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS planned_partner_cost_net NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS planned_partner_cost_vat NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS planned_partner_cost_gross NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE order_leistungen
    DROP CONSTRAINT IF EXISTS order_leistungen_planned_partner_cost_nonnegative,
    DROP CONSTRAINT IF EXISTS order_leistungen_planned_partner_cost_arithmetic;

ALTER TABLE order_leistungen
    ADD CONSTRAINT order_leistungen_planned_partner_cost_nonnegative
        CHECK (
            planned_partner_cost_net >= 0
            AND planned_partner_cost_vat >= 0
            AND planned_partner_cost_gross >= 0
        ),
    ADD CONSTRAINT order_leistungen_planned_partner_cost_arithmetic
        CHECK (
            planned_partner_cost_net + planned_partner_cost_vat
                = planned_partner_cost_gross
        );

CREATE TABLE IF NOT EXISTS order_leistung_planned_cost_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID NOT NULL,
    order_leistung_id UUID NOT NULL
        REFERENCES order_leistungen(id) ON DELETE RESTRICT,
    previous_net NUMERIC(12, 2) NOT NULL CHECK (previous_net >= 0),
    previous_vat NUMERIC(12, 2) NOT NULL CHECK (previous_vat >= 0),
    previous_gross NUMERIC(12, 2) NOT NULL CHECK (previous_gross >= 0),
    next_net NUMERIC(12, 2) NOT NULL CHECK (next_net >= 0),
    next_vat NUMERIC(12, 2) NOT NULL CHECK (next_vat >= 0),
    next_gross NUMERIC(12, 2) NOT NULL CHECK (next_gross >= 0),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
    changed_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT order_leistung_planned_cost_change_previous_arithmetic
        CHECK (previous_net + previous_vat = previous_gross),
    CONSTRAINT order_leistung_planned_cost_change_next_arithmetic
        CHECK (next_net + next_vat = next_gross),
    CONSTRAINT order_leistung_planned_cost_change_request_unique
        UNIQUE (order_leistung_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_order_leistung_planned_cost_changes_history
    ON order_leistung_planned_cost_changes(order_leistung_id, created_at DESC);

CREATE OR REPLACE FUNCTION protect_order_leistung_planned_cost_change()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Planned cost history is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_order_leistung_planned_cost_change_trigger
    ON order_leistung_planned_cost_changes;
CREATE TRIGGER protect_order_leistung_planned_cost_change_trigger
    BEFORE UPDATE OR DELETE ON order_leistung_planned_cost_changes
    FOR EACH ROW
    EXECUTE FUNCTION protect_order_leistung_planned_cost_change();

CREATE OR REPLACE FUNCTION require_order_leistung_planned_cost_journal()
RETURNS trigger AS $$
BEGIN
    IF (
        NEW.planned_partner_cost_net,
        NEW.planned_partner_cost_vat,
        NEW.planned_partner_cost_gross
    ) IS DISTINCT FROM (
        OLD.planned_partner_cost_net,
        OLD.planned_partner_cost_vat,
        OLD.planned_partner_cost_gross
    ) AND NOT EXISTS (
        SELECT 1
        FROM order_leistung_planned_cost_changes history
        WHERE history.order_leistung_id = OLD.id
          AND history.previous_net = OLD.planned_partner_cost_net
          AND history.previous_vat = OLD.planned_partner_cost_vat
          AND history.previous_gross = OLD.planned_partner_cost_gross
          AND history.next_net = NEW.planned_partner_cost_net
          AND history.next_vat = NEW.planned_partner_cost_vat
          AND history.next_gross = NEW.planned_partner_cost_gross
          AND history.created_at >= transaction_timestamp()
    ) THEN
        RAISE EXCEPTION 'Planned partner cost changes require an append-only journal entry';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS require_order_leistung_planned_cost_journal_trigger
    ON order_leistungen;
CREATE TRIGGER require_order_leistung_planned_cost_journal_trigger
    BEFORE UPDATE OF planned_partner_cost_net, planned_partner_cost_vat,
        planned_partner_cost_gross
    ON order_leistungen
    FOR EACH ROW
    EXECUTE FUNCTION require_order_leistung_planned_cost_journal();

ALTER TABLE external_invoices
    ADD COLUMN IF NOT EXISTS order_leistung_id UUID
        REFERENCES order_leistungen(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_external_invoices_order_leistung
    ON external_invoices(order_leistung_id)
    WHERE order_leistung_id IS NOT NULL;

-- NOT VALID preserves deployability if legacy rows were imported with rounded
-- components, while still enforcing the invariant for every new/changed row.
ALTER TABLE external_invoices
    DROP CONSTRAINT IF EXISTS external_invoices_amounts_nonnegative,
    DROP CONSTRAINT IF EXISTS external_invoices_amount_arithmetic;

ALTER TABLE external_invoices
    ADD CONSTRAINT external_invoices_amounts_nonnegative
        CHECK (amount_net >= 0 AND amount_vat >= 0 AND amount_gross >= 0)
        NOT VALID,
    ADD CONSTRAINT external_invoices_amount_arithmetic
        CHECK (amount_net + amount_vat = amount_gross)
        NOT VALID;

CREATE OR REPLACE FUNCTION validate_external_invoice_service_economics()
RETURNS trigger AS $$
DECLARE
    service_order_id UUID;
    service_currency TEXT;
    service_provider_id UUID;
    order_currency TEXT;
BEGIN
    SELECT UPPER(currency)
    INTO order_currency
    FROM orders
    WHERE id = NEW.order_id
    FOR SHARE;

    IF order_currency IS NULL OR UPPER(NEW.currency) <> order_currency THEN
        RAISE EXCEPTION 'External invoice currency must match order currency';
    END IF;

    IF NEW.order_leistung_id IS NOT NULL THEN
        SELECT order_id, UPPER(currency), provider_id
        INTO service_order_id, service_currency, service_provider_id
        FROM order_leistungen
        WHERE id = NEW.order_leistung_id
        FOR UPDATE;

        IF service_order_id IS NULL THEN
            RAISE EXCEPTION 'Order service not found';
        END IF;
        IF service_order_id <> NEW.order_id THEN
            RAISE EXCEPTION 'External invoice service must belong to the same order';
        END IF;
        IF service_currency <> order_currency THEN
            RAISE EXCEPTION 'Order service currency must match order currency';
        END IF;
        IF NEW.provider_id IS NOT NULL
           AND service_provider_id IS NOT NULL
           AND NEW.provider_id <> service_provider_id THEN
            RAISE EXCEPTION 'External invoice provider must match order service provider';
        END IF;
    END IF;

    NEW.currency := order_currency;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_external_invoice_service_economics_trigger
    ON external_invoices;
CREATE TRIGGER validate_external_invoice_service_economics_trigger
    BEFORE INSERT OR UPDATE OF order_id, order_leistung_id, currency, provider_id
    ON external_invoices
    FOR EACH ROW
    EXECUTE FUNCTION validate_external_invoice_service_economics();

CREATE OR REPLACE FUNCTION validate_order_service_currency()
RETURNS trigger AS $$
DECLARE
    order_currency TEXT;
BEGIN
    SELECT UPPER(currency)
    INTO order_currency
    FROM orders
    WHERE id = NEW.order_id
    FOR SHARE;

    IF order_currency IS NULL OR UPPER(NEW.currency) <> order_currency THEN
        RAISE EXCEPTION 'Order service currency must match order currency';
    END IF;

    NEW.currency := order_currency;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_order_service_currency_trigger
    ON order_leistungen;
CREATE TRIGGER validate_order_service_currency_trigger
    BEFORE INSERT OR UPDATE OF order_id, currency
    ON order_leistungen
    FOR EACH ROW
    EXECUTE FUNCTION validate_order_service_currency();

CREATE OR REPLACE FUNCTION protect_order_service_external_invoice_link()
RETURNS trigger AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM external_invoices external
        WHERE external.order_leistung_id = OLD.id
          AND (
              external.order_id <> NEW.order_id
              OR UPPER(external.currency) <> UPPER(NEW.currency)
              OR (
                  external.provider_id IS NOT NULL
                  AND NEW.provider_id IS NOT NULL
                  AND external.provider_id <> NEW.provider_id
              )
          )
    ) THEN
        RAISE EXCEPTION 'Order service changes would invalidate a linked external invoice';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_order_service_external_invoice_link_trigger
    ON order_leistungen;
CREATE TRIGGER protect_order_service_external_invoice_link_trigger
    BEFORE UPDATE OF order_id, currency, provider_id
    ON order_leistungen
    FOR EACH ROW
    EXECUTE FUNCTION protect_order_service_external_invoice_link();

COMMENT ON COLUMN order_leistungen.planned_partner_cost_net IS
    'Current planned provider/partner cost excluding VAT; changes are journaled.';
COMMENT ON COLUMN external_invoices.order_leistung_id IS
    'Optional attribution of an actual provider invoice to one order service.';
