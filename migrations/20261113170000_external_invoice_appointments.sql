-- «После приёмов» (planning stage 7, owner 2026-11-13): a clinic invoice may
-- be sorted under the visits it covers. The link is optional (an invoice may
-- stay with the order alone) and one invoice may cover several visits of the
-- same order.
CREATE TABLE IF NOT EXISTS external_invoice_appointments (
    external_invoice_id UUID NOT NULL REFERENCES external_invoices(id) ON DELETE CASCADE,
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (external_invoice_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_external_invoice_appointments_appointment
    ON external_invoice_appointments(appointment_id);

-- Invoice and visit belong to the same order.
CREATE OR REPLACE FUNCTION external_invoice_appointment_same_order()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM external_invoices ei
        JOIN appointments a ON a.order_id = ei.order_id
        WHERE ei.id = NEW.external_invoice_id
          AND a.id = NEW.appointment_id
    ) THEN
        RAISE EXCEPTION 'external invoice and appointment belong to different orders'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS external_invoice_appointment_same_order ON external_invoice_appointments;
CREATE TRIGGER external_invoice_appointment_same_order
    BEFORE INSERT OR UPDATE ON external_invoice_appointments
    FOR EACH ROW EXECUTE FUNCTION external_invoice_appointment_same_order();
