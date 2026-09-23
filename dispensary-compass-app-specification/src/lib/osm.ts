import { bearingDegrees, haversineMeters, type Dispensary } from "./geo";

export interface ProviderConfig {
  tiles: string;
  darkTiles: string;
  poiEndpoints: string[];
  geocoderEndpoint: string;
  apiEndpoint?: string;
}

export const DEFAULT_PROVIDERS: ProviderConfig = {
  tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  darkTiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  poiEndpoints: [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
  ],
  geocoderEndpoint: "https://nominatim.openstreetmap.org",
  apiEndpoint: "https://ninja-ops-guy-compass-api.vercel.app/api/dispensaries",
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

function coarseCoordinate(value: number): number {
  return Math.round(value / 0.02) * 0.02;
}

async function fetchFromCompassApi(
  apiEndpoint: string,
  lat: number,
  lon: number,
  radiusM: number,
  signal?: AbortSignal
): Promise<{ pois: Dispensary[]; endpoint: string }> {
  const base = new URL(apiEndpoint);
  if (base.protocol !== "https:") throw new Error("COMPASS API must use HTTPS");
  base.searchParams.set("lat", coarseCoordinate(lat).toFixed(2));
  base.searchParams.set("lon", coarseCoordinate(lon).toFixed(2));
  base.searchParams.set("radiusMiles", Math.max(1, Math.ceil(radiusM / 1609.344)).toString());

  const ctrl = new AbortController();
  const timeoutId = window.setTimeout(() => ctrl.abort(), 8000);
  const forwardAbort = () => ctrl.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });

  let res: Response;
  try {
    res = await fetch(base, { headers: { Accept: "application/json" }, signal: ctrl.signal });
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", forwardAbort);
  }
  if (!res.ok) throw new Error(`COMPASS API ${res.status}`);
  const json = (await res.json()) as { elements?: OverpassElement[] };
  const deduped = new Map<string, Dispensary>();
  for (const el of Array.isArray(json.elements) ? json.elements : []) {
    const d = normalizeElement(el, lat, lon);
    if (d) deduped.set(d.id, d);
  }
  return {
    pois: [...deduped.values()].sort((a, b) => a.distanceMeters - b.distanceMeters),
    endpoint: base.origin,
  };
}

export async function fetchDispensaries(
  lat: number,
  lon: number,
  radiusM: number,
  endpoints: string[],
  signal?: AbortSignal,
  apiEndpoint?: string
): Promise<{ pois: Dispensary[]; endpoint: string }> {
  if (apiEndpoint) {
    try {
      return await fetchFromCompassApi(apiEndpoint, lat, lon, radiusM, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      // Controlled API is preferred; public mirrors remain a continuity fallback.
    }
  }

  const body = `data=${encodeURIComponent(buildQuery(lat, lon, radiusM))}`;
  let lastErr: unknown = null;

  for (const ep of endpoints) {
    let parsed: URL;
    try {
      parsed = new URL(ep);
      if (parsed.protocol !== "https:") {
        lastErr = new Error(`Refusing non-HTTPS Overpass endpoint: ${ep}`);
        continue;
      }
    } catch {
      lastErr = new Error(`Invalid Overpass endpoint: ${ep}`);
      continue;
    }

    const requestController = new AbortController();
    const timeoutId = window.setTimeout(() => requestController.abort(), 12000);
    const forwardAbort = () => requestController.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });

    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Accept": "application/json",
        },
        body,
        signal: requestController.signal,
      });

      if (!res.ok) {
        lastErr = new Error(`Overpass ${res.status} @ ${parsed.hostname}`);
        continue;
      }

      const json = (await res.json()) as { elements?: OverpassElement[] };
      const els = Array.isArray(json.elements) ? json.elements : [];
      const deduped = new Map<string, Dispensary>();

      for (const el of els) {
        try {
          const d = normalizeElement(el, lat, lon);
          if (d) deduped.set(d.id, d);
        } catch {
          // Malformed community data is ignored rather than crashing the locator.
        }
      }

      const pois = [...deduped.values()].sort((a, b) => a.distanceMeters - b.distanceMeters);
      return { pois, endpoint: ep };
    } catch (e) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      lastErr = (e as Error)?.name === "AbortError"
        ? new Error(`Overpass timeout @ ${parsed.hostname}`)
        : e;
    } finally {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", forwardAbort);
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
  signal?: AbortSignal,
  apiEndpoint?: string
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
    const r = await fetchDispensaries(lat, lon, radiusM, endpoints, signal, apiEndpoint);
    endpoint = r.endpoint;
    onTier(radiusMiles, r.pois.length);
    if (r.pois.length > 0) {
      return { pois: r.pois, radiusMiles, tiersTried, endpoint };
    }
  }
  return { pois: [], radiusMiles: 50, tiersTried, endpoint };
}
