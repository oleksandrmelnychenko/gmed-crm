-- German-aware search normalization.
--
-- Folds the German umlauts and eszett to their standard digraph substitutions and
-- lowercases, so that a query typed without a German keyboard still matches stored
-- text that contains umlauts (and vice versa):
--
--     "Müller" / "Mueller" / "MÜLLER"  -> "mueller"
--     "Straße" / "Strasse"             -> "strasse"
--     "Köln"   / "Koeln"   / "KÖLN"    -> "koeln"
--
-- Applied to BOTH the stored column(s) and the search query inside list search
-- predicates (de_normalize(haystack) LIKE de_normalize(needle)).
--
-- lower(), replace() are IMMUTABLE in PostgreSQL, so this function is IMMUTABLE and
-- can later back an expression index (e.g. GIN pg_trgm on de_normalize(name)) if a
-- hot list needs it.
CREATE OR REPLACE FUNCTION de_normalize(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT replace(replace(replace(replace(
    lower(coalesce(input, '')),
    'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')
$$;
