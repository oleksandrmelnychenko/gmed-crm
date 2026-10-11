/**
 * Search in the wizard's patient pickers («Рекомендовавший клиент», a
 * guardian who is a patient). The server searches too, but the list shown is
 * always filtered by what is typed now (QA 2026-10-11, N-16: typing «Anna
 * Portal» still listed every patient): a slow or stale response for an older
 * query never shows patients that do not match.
 */

type SearchablePatient = {
  patient_id: string;
  title?: string | null;
  first_name: string;
  last_name: string;
};

/** Lower case with German umlauts spelt out, as the server's `de_normalize`. */
export function normalizePatientSearch(value: string): string {
  return value
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What a patient option is found by: the patient number and the name in
 * both orders, as typed and with umlauts spelt out.
 */
export function patientSearchText(patient: SearchablePatient): string {
  const parts = (values: Array<string | null | undefined>) =>
    values.map((value) => value?.trim()).filter(Boolean).join(" ");
  const forward = parts([patient.patient_id, patient.title, patient.first_name, patient.last_name]);
  const backward = parts([patient.last_name, patient.first_name, patient.patient_id]);
  const raw = `${forward} ${backward}`.toLocaleLowerCase("de-DE");
  return `${raw} ${normalizePatientSearch(raw)}`;
}

/** Every word typed must occur in the patient's number or name; an empty query matches all. */
export function matchesPatientSearch(patient: SearchablePatient, query: string): boolean {
  const words = normalizePatientSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizePatientSearch(patientSearchText(patient));
  return words.every((word) => haystack.includes(word));
}

export function filterPatientsBySearch<T extends SearchablePatient>(patients: readonly T[], query: string): T[] {
  return patients.filter((patient) => matchesPatientSearch(patient, query));
}
