-- Lead cabinet, step 3 (owner request 2026-10-11): "Der Rechnungsempfänger
-- ist auch der Zahler" is a checkbox, ticked as soon as a recipient is chosen.
-- The server stores `true` when a recipient is saved without an answer
-- (`routes/lead_invoice_recipient.rs`, `apply`); rows saved before that rule
-- with a recipient but no answer get the same default, so the missing list,
-- section 7 and the sanctions screening read one answer.
UPDATE lead_invoice_recipients
SET recipient_is_payer = TRUE
WHERE recipient IS NOT NULL
  AND recipient_is_payer IS NULL;
