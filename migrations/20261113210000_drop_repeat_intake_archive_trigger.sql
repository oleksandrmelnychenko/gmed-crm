-- QA F10 (2026-11-13): the trigger from 20260913090000_repeat_intake_integrity
-- cancelled the draft orders of a repeat request when the lead failed, but set
-- only `status`: no `cancelled_at`, planned services stayed planned and the
-- order checklist stayed open. Every application path now withdraws such
-- orders itself through `withdraw_lead_orders_in_tx` (failed-lead archive and
-- delete, the 14-day purge, and the patient's DSGVO erasure), so the trigger
-- is redundant and only produced inconsistent cancellations.
-- Existing rows are not repaired here (owner decision pending).
DROP TRIGGER IF EXISTS repeat_intake_archive ON leads;
DROP FUNCTION IF EXISTS archive_repeat_intake_orders();
