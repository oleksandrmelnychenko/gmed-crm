-- A dunning event sends a letter (Zahlungserinnerung, 1. and 2. Mahnung) with
-- a new payment deadline; the letter itself is stored in invoice_documents.
-- Events recorded before letters existed get their letter on first download
-- and a deadline derived from the day they were sent.
ALTER TABLE invoice_dunning_events
    ADD COLUMN IF NOT EXISTS payment_due_date DATE;
