-- DSGVO Art. 17: the erasure of a patient also removes the patient's data
-- from the history of the patient's tasks (owner decision 2026-10-12). The
-- history repeats earlier texts in its payloads: the previous body of an
-- edited or deleted comment, the previous text of a checklist item, the names
-- of attached files, earlier titles.
--
-- The history stays append-only. The one exception is narrow: inside the
-- erasure transaction (transaction-local setting `gmed.dsgvo_erasure = on`,
-- set by the erasure only), an UPDATE may change the text values of an
-- event's payload, nothing else - same keys, same structure, same numbers,
-- flags and nulls, no other column. A DELETE is never allowed. The erasure
-- itself is recorded in audit_log (`dsgvo_anonymize`, counter
-- `scrubbed_free_text.task_events`).

-- True when `new_value` differs from `old_value` in text values only.
CREATE OR REPLACE FUNCTION gmed_jsonb_only_text_changed(old_value JSONB, new_value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    item RECORD;
    position_index INTEGER;
BEGIN
    IF jsonb_typeof(old_value) IS DISTINCT FROM jsonb_typeof(new_value) THEN
        RETURN FALSE;
    END IF;
    CASE jsonb_typeof(old_value)
        WHEN 'string' THEN
            RETURN TRUE;
        WHEN 'object' THEN
            IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(old_value) AS key)
               IS DISTINCT FROM
               (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(new_value) AS key) THEN
                RETURN FALSE;
            END IF;
            FOR item IN SELECT key, value FROM jsonb_each(old_value) LOOP
                IF NOT gmed_jsonb_only_text_changed(item.value, new_value -> item.key) THEN
                    RETURN FALSE;
                END IF;
            END LOOP;
            RETURN TRUE;
        WHEN 'array' THEN
            IF jsonb_array_length(old_value) <> jsonb_array_length(new_value) THEN
                RETURN FALSE;
            END IF;
            FOR position_index IN 0 .. jsonb_array_length(old_value) - 1 LOOP
                IF NOT gmed_jsonb_only_text_changed(
                    old_value -> position_index,
                    new_value -> position_index
                ) THEN
                    RETURN FALSE;
                END IF;
            END LOOP;
            RETURN TRUE;
        ELSE
            RETURN old_value = new_value;
    END CASE;
END;
$$;

COMMENT ON FUNCTION gmed_jsonb_only_text_changed(JSONB, JSONB) IS
    'True when two JSON values differ in text values only (same keys, structure and non-text values).';

-- Replaces `pattern` (PostgreSQL regular expression, case-insensitive) with
-- `replacement` in every text value of `input`, at any depth. A text that
-- changed and sits under a key named in `limits` is cut to that length (the
-- limit of the column it mirrors).
CREATE OR REPLACE FUNCTION gmed_scrub_jsonb_text(
    input JSONB,
    pattern TEXT,
    replacement TEXT,
    limits JSONB DEFAULT '{}'::jsonb,
    parent_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    original TEXT;
    replaced TEXT;
    result JSONB;
BEGIN
    CASE jsonb_typeof(input)
        WHEN 'string' THEN
            original := input #>> '{}';
            replaced := regexp_replace(original, pattern, replacement, 'gi');
            IF replaced = original THEN
                RETURN input;
            END IF;
            IF parent_key IS NOT NULL AND limits ? parent_key THEN
                replaced := left(replaced, (limits ->> parent_key)::INTEGER);
            END IF;
            RETURN to_jsonb(replaced);
        WHEN 'object' THEN
            SELECT COALESCE(
                       jsonb_object_agg(
                           entry.key,
                           gmed_scrub_jsonb_text(entry.value, pattern, replacement, limits, entry.key)
                       ),
                       '{}'::jsonb
                   )
            INTO result
            FROM jsonb_each(input) AS entry;
            RETURN result;
        WHEN 'array' THEN
            SELECT COALESCE(
                       jsonb_agg(
                           gmed_scrub_jsonb_text(entry.value, pattern, replacement, limits, parent_key)
                           ORDER BY entry.ordinality
                       ),
                       '[]'::jsonb
                   )
            INTO result
            FROM jsonb_array_elements(input) WITH ORDINALITY AS entry(value, ordinality);
            RETURN result;
        ELSE
            RETURN input;
    END CASE;
END;
$$;

COMMENT ON FUNCTION gmed_scrub_jsonb_text(JSONB, TEXT, TEXT, JSONB, TEXT) IS
    'Replaces a pattern in every text value of a JSON value; changed texts under keys in limits are cut to that length.';

CREATE OR REPLACE FUNCTION prevent_concierge_task_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Art. 17 DSGVO exception: only inside the erasure transaction, only an
    -- UPDATE of the history, only text values of the payload.
    IF TG_OP = 'UPDATE'
       AND TG_TABLE_NAME = 'concierge_operational_task_events'
       AND current_setting('gmed.dsgvo_erasure', true) = 'on'
       AND (to_jsonb(NEW) - 'payload') = (to_jsonb(OLD) - 'payload')
       AND gmed_jsonb_only_text_changed(OLD.payload, NEW.payload) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'concierge task comments and events are append-only';
END;
$$;

COMMENT ON FUNCTION prevent_concierge_task_append_only_mutation() IS
    'Keeps the task history append-only; inside a DSGVO erasure (gmed.dsgvo_erasure = on) only text values of an event payload may change.';
