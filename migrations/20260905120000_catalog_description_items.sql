-- Preserve the paragraph boundaries used by the legacy document renderer.
CREATE FUNCTION legacy_service_description_items(source TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    result JSONB := '[]'::JSONB;
    current_point TEXT := '';
    line TEXT;
    content TEXT;
    starts_point BOOLEAN;
BEGIN
    FOREACH line IN ARRAY string_to_array(replace(COALESCE(source, ''), E'\r', ''), E'\n') LOOP
        line := btrim(line, E' \t');
        starts_point := line ~ '^([-•] |[0-9]+[.)][[:space:]]*).+';
        IF line = '' OR starts_point THEN
            IF current_point <> '' THEN
                result := result || jsonb_build_array(jsonb_build_object(
                    'id', 'legacy-' || (jsonb_array_length(result) + 1), 'text', current_point));
                current_point := '';
            END IF;
        END IF;
        IF line <> '' THEN
            content := CASE WHEN starts_point THEN
                btrim(regexp_replace(line, '^([-•] |[0-9]+[.)][[:space:]]*)', ''), E' \t')
                ELSE line END;
            current_point := current_point || CASE WHEN current_point <> '' THEN ' ' ELSE '' END || content;
        END IF;
    END LOOP;
    IF current_point <> '' THEN
        result := result || jsonb_build_array(jsonb_build_object(
            'id', 'legacy-' || (jsonb_array_length(result) + 1), 'text', current_point));
    END IF;
    RETURN result;
END;
$$;

ALTER TABLE agency_service_catalog ADD COLUMN description_items JSONB;
UPDATE agency_service_catalog SET description_items = legacy_service_description_items(description);
ALTER TABLE agency_service_catalog ALTER COLUMN description_items SET NOT NULL;
ALTER TABLE agency_service_catalog ADD CONSTRAINT agency_service_description_items_array
    CHECK (jsonb_typeof(description_items) = 'array');

-- Keep older clients compatible; structured writes also maintain the display text.
CREATE FUNCTION sync_agency_service_description_items() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.description_items IS NULL THEN
            NEW.description_items := legacy_service_description_items(NEW.description);
        ELSE
            SELECT string_agg(item->>'text', E'\n\n' ORDER BY ord)
            INTO NEW.description FROM jsonb_array_elements(NEW.description_items) WITH ORDINALITY AS entries(item, ord);
        END IF;
    ELSIF NEW.description_items IS DISTINCT FROM OLD.description_items THEN
        SELECT string_agg(item->>'text', E'\n\n' ORDER BY ord)
        INTO NEW.description FROM jsonb_array_elements(NEW.description_items) WITH ORDINALITY AS entries(item, ord);
    ELSIF NEW.description IS DISTINCT FROM OLD.description THEN
        NEW.description_items := legacy_service_description_items(NEW.description);
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER sync_agency_service_description_items BEFORE INSERT OR UPDATE OF description, description_items
    ON agency_service_catalog FOR EACH ROW EXECUTE FUNCTION sync_agency_service_description_items();

ALTER TABLE order_leistungen ADD COLUMN agency_service_description_items_snapshot JSONB;
UPDATE order_leistungen SET agency_service_description_items_snapshot =
    legacy_service_description_items(COALESCE(agency_service_description_snapshot, description))
    WHERE agency_service_id IS NOT NULL;
ALTER TABLE order_leistungen ADD CONSTRAINT order_description_items_array
    CHECK (jsonb_typeof(agency_service_description_items_snapshot) = 'array');

CREATE FUNCTION snapshot_order_description_items() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.agency_service_id IS NULL THEN
        NEW.agency_service_description_items_snapshot := NULL;
    ELSIF TG_OP = 'INSERT' THEN
        SELECT description_items INTO NEW.agency_service_description_items_snapshot
        FROM agency_service_catalog WHERE id = NEW.agency_service_id;
    ELSIF NEW.agency_service_id IS DISTINCT FROM OLD.agency_service_id THEN
        SELECT description_items INTO NEW.agency_service_description_items_snapshot
        FROM agency_service_catalog WHERE id = NEW.agency_service_id;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER snapshot_order_description_items BEFORE INSERT OR UPDATE OF agency_service_id
    ON order_leistungen FOR EACH ROW EXECUTE FUNCTION snapshot_order_description_items();
