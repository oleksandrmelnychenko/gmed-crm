-- Staff order the agency service catalog by hand (owner 2026-11-18); the
-- pickers of the order step list the services in that order. The initial
-- order is the one the catalog page showed until now (active first, then the
-- newest catalog validity, then the name), so nothing moves. A new position
-- takes the next value of the sequence: it goes to the end.

CREATE SEQUENCE agency_service_catalog_sort_order_seq;

ALTER TABLE agency_service_catalog
    ADD COLUMN sort_order INTEGER;

-- The backfill is no edit of a position: keep its updated_at.
ALTER TABLE agency_service_catalog DISABLE TRIGGER set_updated_at_agency_service_catalog;

WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               ORDER BY is_active DESC, valid_from DESC, service_name ASC, id
           ) AS position
    FROM agency_service_catalog
)
UPDATE agency_service_catalog catalog
SET sort_order = ranked.position
FROM ranked
WHERE catalog.id = ranked.id;

ALTER TABLE agency_service_catalog ENABLE TRIGGER set_updated_at_agency_service_catalog;

SELECT setval(
    'agency_service_catalog_sort_order_seq',
    (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM agency_service_catalog),
    false
);

ALTER TABLE agency_service_catalog
    ALTER COLUMN sort_order SET DEFAULT nextval('agency_service_catalog_sort_order_seq'),
    ALTER COLUMN sort_order SET NOT NULL;

ALTER SEQUENCE agency_service_catalog_sort_order_seq
    OWNED BY agency_service_catalog.sort_order;

CREATE INDEX idx_agency_service_catalog_sort_order
    ON agency_service_catalog(sort_order, service_name);
