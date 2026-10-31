-- QA 2026-10-31: the portal hands out the current version of a document only,
-- and a signature now moves the portal release to the signed version. A release
-- made before that still sits on the superseded version, and the patient would
-- lose the document: it moves to the current version once, like
-- `move_portal_release_to_version`. A confirmation is asked again, it was given
-- for the other file. A current version that was archived or lost its file
-- takes nothing over.
WITH RECURSIVE stale AS (
    SELECT ds.id AS share_id, ds.document_id AS version_id
    FROM document_shares ds
    JOIN documents d ON d.id = ds.document_id
    WHERE ds.channel = 'patient_portal'
      AND ds.revoked_at IS NULL
      AND d.visibility = 'patient_visible'
      AND EXISTS (SELECT 1 FROM documents newer WHERE newer.replaces_document_id = d.id)
    UNION
    SELECT stale.share_id, newer.id
    FROM stale
    JOIN documents newer ON newer.replaces_document_id = stale.version_id
), current_version AS (
    SELECT DISTINCT ON (stale.share_id) stale.share_id, d.id AS document_id
    FROM stale
    JOIN documents d ON d.id = stale.version_id
    WHERE NOT EXISTS (SELECT 1 FROM documents newer WHERE newer.replaces_document_id = d.id)
      AND d.status <> 'archived'
      AND d.file_deleted_at IS NULL
    ORDER BY stale.share_id, d.version_number DESC, d.created_at DESC
), ended AS (
    UPDATE document_shares ds
    SET revoked_at = now()
    FROM current_version moved
    WHERE ds.id = moved.share_id
    RETURNING moved.document_id, ds.shared_with_user_id, ds.shared_by, ds.requires_confirmation
), released AS (
    UPDATE documents d
    SET visibility = 'patient_visible'
    WHERE d.id IN (SELECT document_id FROM ended)
      AND d.visibility <> 'patient_visible'
)
INSERT INTO document_shares (
    document_id, shared_with_user_id, shared_by, channel, requires_confirmation
)
SELECT DISTINCT ended.document_id, ended.shared_with_user_id, ended.shared_by,
       'patient_portal', ended.requires_confirmation
FROM ended
WHERE NOT EXISTS (
    SELECT 1 FROM document_shares existing
    WHERE existing.document_id = ended.document_id
      AND existing.shared_with_user_id = ended.shared_with_user_id
      AND existing.revoked_at IS NULL
);
