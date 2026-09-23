const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter"
];

const PROD_ORIGIN = "https://ninja-ops-guy.github.io";
const DEV_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);

function allowOrigin(origin) {
  return origin === PROD_ORIGIN || DEV_ORIGINS.has(origin);
}

function numberParam(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildQuery(lat, lon, radiusMeters) {
  return `[out:json][timeout:20];(nwr["shop"="cannabis"](around:${Math.round(radiusMeters)},${lat},${lon}););out center 200;`;
}

function buildQueryPayload(formBody) {
  const params = new URLSearchParams(formBody);
  return params.get("data") ?? "";
}

async function queryOverpass(endpoint, body, outerSignal) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  const forwardAbort = () => ctrl.abort();
  outerSignal?.addEventListener?.("abort", forwardAbort, { once: true });

  try {
    const url = new URL(endpoint);
    url.searchParams.set("data", buildQueryPayload(body));
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "COMPASS/1.0 (https://github.com/ninja-ops-guy/420Flower-Locator)"
      },
      signal: ctrl.signal
    });

    if (!response.ok) throw new Error(`Overpass ${response.status}`);
    const json = await response.json();
    return {
      elements: Array.isArray(json?.elements) ? json.elements : [],
      provider: new URL(endpoint).hostname
    };
  } finally {
    clearTimeout(timeout);
    outerSignal?.removeEventListener?.("abort", forwardAbort);
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin ?? "";
  if (origin && !allowOrigin(origin)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(403).json({ error: "origin_not_allowed" });
  }

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const lat = numberParam(req.query.lat);
  const lon = numberParam(req.query.lon);
  const radiusMiles = numberParam(req.query.radiusMiles);

  if (
    lat === null || lon === null || radiusMiles === null ||
    lat < -90 || lat > 90 || lon < -180 || lon > 180 ||
    radiusMiles < 1 || radiusMiles > 55
  ) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ error: "invalid_query" });
  }

  // The client is expected to send a coarse center rather than its precise GPS
  // fix. The API adds a buffer so edge-of-cell POIs are not accidentally lost.
  const radiusMeters = radiusMiles * 1609.344 + 2500;
  const body = `data=${encodeURIComponent(buildQuery(lat, lon, radiusMeters))}`;

  let lastError = "provider_unavailable";
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const result = await queryOverpass(endpoint, body, req.signal);
      res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
      return res.status(200).json({
        ...result,
        radiusMiles,
        privacy: {
          preciseLocationRequired: false,
          expectedCenterPrecisionDegrees: 0.02
        }
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "provider_unavailable";
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(503).json({ error: "provider_unavailable", detail: lastError });
}
