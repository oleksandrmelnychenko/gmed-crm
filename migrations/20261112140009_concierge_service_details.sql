-- Owner decision 2026-11-12 (concierge QA D-6): a concierge service gets the
-- own fields of its kind instead of one form for all — restaurant (persons,
-- dietary notes, preferred time), transfer (flight or train number, pickup
-- place, drop-off place, luggage or wheelchair note), tickets for an event
-- (event name, seats, seat category). The kind is derived, not stored: rides
-- by `service_kind` (transfer, chauffeur), everything else by the partner
-- category (`taxonomy_node_id`). The server validates the fields per kind
-- (crates/server/src/routes/concierge_services/details.rs); the column only
-- guarantees an object of bounded size.
--
-- Additive: every existing service gets an empty object, nothing is changed
-- or deleted.

ALTER TABLE concierge_services
    ADD COLUMN details JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE concierge_services
    ADD CONSTRAINT concierge_services_details_object
        CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 8000);

COMMENT ON COLUMN concierge_services.details IS
    'Own fields of the service kind (restaurant, transfer, tickets); shown to staff and to the patient, never an internal note.';
