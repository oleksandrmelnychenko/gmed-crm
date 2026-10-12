-- Word-wise list search (QA 2026-10-12, A2-05): "Mia MusterAR" found
-- nothing in the lead list although it is the row's title, because the
-- whole query had to occur as one piece in the searched text (an empty
-- middle name already adds a second space between first and last name, and
-- "MusterAR Mia" never matched). Now every word of the query must occur
-- somewhere in the text, in any order; the comparison folds case and German
-- umlauts like `de_normalize` (20260603130000_de_search_normalize.sql).
--
-- `strpos` instead of LIKE: a "%" or "_" typed into the search box is a
-- character, not a wildcard. An empty or blank query matches everything.
CREATE OR REPLACE FUNCTION search_tokens_match(haystack text, needle text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM regexp_split_to_table(btrim(de_normalize(needle)), '\s+') AS token
    WHERE token <> ''
      AND strpos(de_normalize(haystack), token) = 0
  )
$$;

COMMENT ON FUNCTION search_tokens_match(text, text) IS
    'True when every whitespace-separated word of the query occurs in the text (de_normalize folding, any order)';
