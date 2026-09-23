import { bearingDegrees, haversineMeters, type Dispensary } from "./geo";

export interface ProviderConfig {
  tiles: string;
  darkTiles: string;
  poiEndpoints: string[];
  geocoderEndpoint: string;
}

export const DEFAULT_PROVIDERS: ProviderConfig = {
  tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  darkTiles: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  poiEndpoints: [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
  ],
  geocoderEndpoint: "https://nominatim.openstreetmap.org",
};

export const SEARCH_RADII_MILES = [10, 25, 50];
export const SEARCH_RADII_METERS = SEARCH_RADII_MILES.map((m) => m * 1609.344);

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function triState(v?: string): boolean | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (["yes", "only", "true", "1"].includes(s)) return true;
  if (["no", "false", "0"].includes(s)) return false;
  return undefined;
}

function buildAddress(tags: Record<string, string>): string | undefined {
  const num = tags["addr:housenumber"] ?? "";
  const street = tags["addr:street"] ?? "";
  const city = tags["addr:city"] ?? tags["addr:suburb"] ?? "";
  const line1 = [num, street].filter(Boolean).join(" ").trim();
  if (line1 && city) return `${line1}, ${city}`;
  if (line1) return line1;
  if (city) return city;
  return undefined;
}

export function normalizeElement(
  el: OverpassElement,
  userLat: number,
  userLon: number
): Dispensary | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const tags = el.tags ?? {};
  // Only shop=cannabis (query already filters, but double-guard)
  if (tags.shop !== "cannabis") return null;

  const distanceMeters = haversineMeters(userLat, userLon, lat, lon);
  const bearing = bearingDegrees(userLat, userLon, lat, lon);

  return {
    id: `${el.type}/${el.id}`,
    name: tags.name ?? null,
    latitude: lat,
    longitude: lon,
    distanceMeters,
    bearingDegrees: bearing,
    address: buildAddress(tags),
    openingHours: tags.opening_hours,
    website: tags.website ?? tags["contact:website"] ?? tags.url,
    recreational: triState(tags["cannabis:recreational"]),
    medical: triState(tags["cannabis:medical"]),
    cbd: triState(tags["cannabis:cbd"]),
    osmType: el.type,
    osmId: el.id,
  };
}

function buildQuery(lat: number, lon: number, radiusM: number): string {
  const r = Math.round(radiusM);
  return `[out:json][timeout:25];(nwr["shop"="cannabis"](around:${r},${lat},${lon}););out center 60;`;
}

export async function fetchDispensaries(
  lat: number,
  lon: number,
  radiusM: number,
  endpoints: string[],
  signal?: AbortSignal
): Promise<{ pois: Dispensary[]; endpoint: string }> {
  const body = `data=${encodeURIComponent(buildQuery(lat, lon, radiusM))}`;
  let lastErr: unknown = null;
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body,
        signal,
      });
      if (!res.ok) {
        // 429 / 504 are common on public overpass — try next mirror
        lastErr = new Error(`Overpass ${res.status} @ ${ep}`);
        continue;
      }
      const json = (await res.json()) as { elements?: OverpassElement[] };
      const els = Array.isArray(json.elements) ? json.elements : [];
      const pois: Dispensary[] = [];
      for (const el of els) {
        try {
          const d = normalizeElement(el, lat, lon);
          if (d) pois.push(d);
        } catch {
          // skip malformed object, never crash
        }
      }
      pois.sort((a, b) => a.distanceMeters - b.distanceMeters);
      return { pois, endpoint: ep };
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      lastErr = e;
      continue;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("All OSM POI providers unavailable");
}

/** Progressive search: 10mi → 25mi → 50mi, returns first non-empty tier */
export async function searchExpanding(
  lat: number,
  lon: number,
  endpoints: string[],
  onTier: (radiusMiles: number, count: number) => void,
  signal?: AbortSignal
): Promise<{
  pois: Dispensary[];
  radiusMiles: number;
  tiersTried: number[];
  endpoint: string;
}> {
  const tiersTried: number[] = [];
  let endpoint = endpoints[0] ?? "";
  for (let i = 0; i < SEARCH_RADII_METERS.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const radiusM = SEARCH_RADII_METERS[i];
    const radiusMiles = SEARCH_RADII_MILES[i];
    tiersTried.push(radiusMiles);
    const r = await fetchDispensaries(lat, lon, radiusM, endpoints, signal);
    endpoint = r.endpoint;
    onTier(radiusMiles, r.pois.length);
    if (r.pois.length > 0) {
      return { pois: r.pois, radiusMiles, tiersTried, endpoint };
    }
  }
  return { pois: [], radiusMiles: 50, tiersTried, endpoint };
}
