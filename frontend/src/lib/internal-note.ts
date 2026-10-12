/**
 * Staff-only internal note of a quote or an invoice (owner 2026-10-12): never
 * printed, never copied into invoices, never shown to the patient or a payer.
 * The server and the database refuse longer notes (`internal_note_too_long`).
 */
export const INTERNAL_NOTE_MAX_LENGTH = 4000;
