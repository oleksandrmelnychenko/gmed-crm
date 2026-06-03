-- Phone-number search normalization.
--
-- Strips every non-digit so that formatting differences (spaces, dashes, parentheses,
-- a leading "+") do not break a phone search:
--
--     "+49 170 1234567"  -> "491701234567"
--     "0170-123 45 67"   -> "017012345 67" stripped -> "01701234567"
--
-- Applied to both the stored phone column(s) and the digit-stripped query in list search
-- predicates. NOTE: this does NOT canonicalize the country-code vs. national-prefix
-- ("+49 170" vs "0170"); that needs full phone parsing and is out of scope.
CREATE OR REPLACE FUNCTION phone_digits(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(coalesce(input, ''), '\D', '', 'g')
$$;
