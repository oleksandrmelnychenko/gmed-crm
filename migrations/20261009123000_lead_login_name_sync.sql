-- Owner request 2026-10-09: a renamed lead is renamed in its cabinet and in
-- Users & Roles. A lead's patient login carries the lead's name (first and last
-- name), but the name was copied only when the login was issued; a later
-- rename, by staff or in the cabinet, left the old name in the cabinet's
-- account page and in the user list. New renames now reach the login in the
-- same transaction (lead_portal_account::sync_name_in_tx). This brings the
-- logins that drifted before into line, as long as they still belong to a
-- request: a converted lead's login is the patient's account and keeps its name.
UPDATE users u
SET name = lead_name.name,
    updated_at = now()
FROM (
    SELECT portal_user_id AS user_id,
           NULLIF(btrim(concat_ws(' ', btrim(first_name), btrim(last_name))), '') AS name
    FROM leads
    WHERE portal_user_id IS NOT NULL
      AND qualification_status <> 'deleted'
      AND converted_patient_id IS NULL
) lead_name
WHERE u.id = lead_name.user_id
  AND u.role = 'patient'
  AND lead_name.name IS NOT NULL
  AND u.name IS DISTINCT FROM lead_name.name;
