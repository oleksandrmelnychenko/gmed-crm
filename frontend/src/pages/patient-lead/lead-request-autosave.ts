/** Fields the user changed before a queued save. Include a return to the last
 * saved value while an earlier, different value is still being written. */
export function queuedDraftFields<Patch extends object>(fromSaved: Patch, fromQueued: Patch): ReadonlySet<string> {
  return new Set([...Object.keys(fromSaved), ...Object.keys(fromQueued)]);
}

/** A queued snapshot must not overwrite unrelated fields returned by a newer
 * server response while it was waiting its turn. */
export function scopedDraftPatch<Patch extends object>(patch: Patch, fields: ReadonlySet<string>): Patch {
  return Object.fromEntries(Object.entries(patch).filter(([field]) => fields.has(field))) as Patch;
}

/** Adopt server corrections for untouched/submitted fields, preserving typing
 * that happened after the request was queued. Arrays are form values too. */
export function mergeSavedDraft<Draft extends object>(
  current: Draft,
  submitted: Draft,
  fresh: Draft,
  baseline: Draft,
  writtenFields: readonly string[],
  editedFields: ReadonlySet<string> = new Set(Object.keys(submitted)),
): Draft {
  const next = { ...current };
  for (const field of Object.keys(fresh) as Array<keyof Draft>) {
    // The snapshot may have waited behind another save. Unedited values now
    // belong to the baseline at execution time, not that earlier snapshot.
    const submittedValue = editedFields.has(String(field)) ? submitted[field] : baseline[field];
    const unchangedWhileSaving = JSON.stringify(current[field]) === JSON.stringify(submittedValue);
    const untouched = JSON.stringify(submittedValue) === JSON.stringify(baseline[field]);
    // Refused/empty required fields were not written; keep the user's input
    // and its validation message while saving the independently valid fields.
    if (unchangedWhileSaving && (untouched || writtenFields.includes(String(field)))) next[field] = fresh[field];
  }
  return next;
}
