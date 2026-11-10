-- The visit's own mark «an interpreter is needed» (owner 2026-11-10, QA fix
-- FX8). Until now only the ORDER's planning said so
-- (`order_planning_preparation.interpreter_required`), so a visit without an
-- order, or of an order without that mark, never reached the interpreter
-- team lead for the first assignment.
--
--   NULL  — nobody decided for this visit: the order's planning counts
--           (the default of a visit created from an order, and of every
--           visit that exists today);
--   true  — the visit needs an interpreter, with or without an order;
--   false — the visit needs none although its order's planning asks for one.
--
-- No backfill on purpose: an existing visit stays NULL and keeps following
-- its order's planning, also when that planning changes later. A copied
-- value would freeze today's answer and hide the visit from the team lead
-- as soon as the order is marked afterwards. Nothing that is visible today
-- disappears, nothing new appears.
--
-- Additive only: a nullable column without a default does not rewrite the
-- table; no trigger, no constraint, no index.
ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS interpreter_needed BOOLEAN;

COMMENT ON COLUMN appointments.interpreter_needed IS
    'The visit needs an interpreter. NULL = follows order_planning_preparation.interpreter_required of its order.';
