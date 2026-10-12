import { COUNTRY_CODES } from "@/components/ui/country-select";

/** Public EU Sanctions Map feed. No patient data or login credentials are sent. */
export const EU_REGIMES_URL = "https://www.sanctionsmap.eu/api/v1/regime";
export const EU_COUNTRIES_SOURCE_URL = "https://www.sanctionsmap.eu/";
const KNOWN_COUNTRIES = new Set(COUNTRY_CODES);
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
// These are claims remaining from repealed sanctions (Serbia/Montenegro),
// and the EU Blocking Statute (US), rather than current sanctions regimes.
const NON_SANCTION_MEASURES = new Set([17, 65]);

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nestedData = (value: unknown) => record(value)?.data;

/** Geographic regimes with at least one current, non-suspended sanction. */
export function regimeCountryCodes(value: unknown, now = Date.now()): string[] {
  const regimes = record(value)?.data;
  if (!Array.isArray(regimes)) throw new Error("Invalid EU sanctions regimes response");
  const countries = new Set<string>();
  for (const value of regimes) {
    const regime = record(value);
    // Type 1 is a worldwide thematic regime, not a country policy.
    if (!regime || regime.type !== 0) continue;
    const country = record(nestedData(regime.country));
    const code = typeof country?.code === "string" ? country.code.trim().toUpperCase() : "";
    if (!KNOWN_COUNTRIES.has(code)) continue;
    if (regime.expiration !== null && regime.expiration !== undefined) {
      if (typeof regime.expiration !== "number" || !Number.isFinite(regime.expiration)) {
        throw new Error("Invalid EU sanctions regime expiration");
      }
      if (regime.expiration * 1000 <= now) continue;
    }
    const measures = nestedData(regime.measures);
    if (!Array.isArray(measures)) throw new Error("Invalid EU sanctions measures response");
    const active = measures.some((value) => {
      const measure = record(value);
      const type = record(nestedData(measure?.type));
      return measure && (measure.suspend === false || measure.suspend === 0)
        && typeof type?.id === "number" && !NON_SANCTION_MEASURES.has(type.id);
    });
    if (active) countries.add(code);
  }
  // Never replace or save a policy from an empty or unrecognisable source.
  if (countries.size === 0) throw new Error("No active EU sanctions countries found");
  return [...countries].sort();
}

export async function fetchEuCountryCodes(fetcher: typeof fetch = fetch): Promise<string[]> {
  const response = await fetcher(EU_REGIMES_URL, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("EU sanctions countries download failed");
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > MAX_SOURCE_BYTES) throw new Error("EU sanctions countries response is too large");
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_SOURCE_BYTES) throw new Error("EU sanctions countries response is too large");
  return regimeCountryCodes(JSON.parse(new TextDecoder().decode(body)));
}

type CountryPolicyApi = {
  listStatus: () => Promise<{ blocked_countries: string[] }>;
  setBlockedCountries: (countries: string[]) => Promise<{ blocked_countries: string[] }>;
};

/** Add downloaded countries to the latest saved policy; preserve manual additions. */
export async function syncEuBlockedCountries(api: CountryPolicyApi, fetcher: typeof fetch = fetch) {
  const sourceCountries = await fetchEuCountryCodes(fetcher);
  const current = (await api.listStatus()).blocked_countries;
  const countries = [...new Set([...current, ...sourceCountries])].sort();
  const added = countries.length - new Set(current).size;
  if (added === 0) return { countries, added, sourceCount: sourceCountries.length };
  const saved = await api.setBlockedCountries(countries);
  return { countries: saved.blocked_countries, added, sourceCount: sourceCountries.length };
}
