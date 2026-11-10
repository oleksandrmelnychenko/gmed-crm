-- Security review 2026-11-10: a questionnaire upload stayed in
-- lead_attachments.data as plaintext after its import into the documents,
-- where the same file is stored sealed. The import now empties `data` with
-- the import mark; this does the same for the rows imported before.
--
-- Only where the imported document still exists and still holds its file
-- (`storage_key` set, file not deleted): the download of the upload is then
-- served from that document. A row whose document is gone or lost its file
-- keeps what it has, and so does one whose document recorded another size
-- than the upload (`file_size` is the stored file's plaintext length): the
-- copy goes only where the document provably took the whole file.
-- `size_bytes` stays, as the list of uploads shows it.
UPDATE lead_attachments AS attachment
SET data = ''::bytea
FROM documents AS imported
WHERE imported.id = attachment.imported_document_id
  AND attachment.imported_at IS NOT NULL
  AND imported.storage_key IS NOT NULL
  AND imported.file_deleted_at IS NULL
  AND octet_length(attachment.data) > 0
  AND imported.file_size = octet_length(attachment.data);
