# COMPASS — Nearest Dispensary Finder (SPEC-COMPASS-001 · v0.1)

**Open → locate → find the nearest dispensary → point toward it.**

A compass whose target happens to be the nearest shop tagged `shop=cannabis` on OpenStreetMap.
Implemented as a mobile web app (React + TypeScript + Vite + Tailwind). It runs in iOS Safari and
Android Chrome from one codebase and builds to a single `dist/index.html`.

## Architecture (spec §2)

```
src/
├── types.ts                 Domain model (Poi, Dispensary §10, Phase §11)
├── lib/
│   ├── geo.ts               Geo engine: Haversine, initial bearing, deterministic nearest-neighbour
│   ├── declination.ts       Magnetic → true heading (NOAA WMM 2025–2030 via `magvar`)
│   ├── openingHours.ts      Conservative OSM opening_hours subset → "Open until 9 PM"
│   ├── format.ts            Distance presentation rules (§4), clocks
│   ├── filters.ts           Rec / Med / CBD-only filters (explicit tags only)
│   └── platform.ts          Directions hand-off (Apple Maps / geo: / Google / OSM / Waze)
├── providers/               ◀ swappable infrastructure (§14)
│   ├── types.ts             PoiProvider · GeocoderProvider · MapProvider · ProviderConfig
│   ├── overpass.ts          Overpass `nwr["shop"="cannabis"](around:…)` + normalisation
│   ├── nominatim.ts         Lookup-by-OSM-id address fill (≤1 req/s, cached)
│   └── config.ts            Defaults, validation, remote config loading
├── services/
│   ├── location.ts          Foreground geolocation + permission states (§9)
│   ├── heading.ts           Sensor abstraction + circular smoothing (iOS / Android / Firefox)
│   └── poiCache.ts          POI cache with the "guaranteed nearest" refresh rule
├── state/                   Settings, providers and the §11 state machine (compass.tsx)
└── screens/                 Compass · Map (Leaflet + OSM tiles) · Settings
```

### Refresh rule (no re-query on every GPS tick)

If radius **R** was searched around **S** and the user has since moved **m**, every shop within
**R − m** of the user was part of that search. The cached nearest result at distance **d** is
*provably* still the nearest while **d ≤ R − m**; only then is a new query skipped. Otherwise a
new query runs (throttled), plus on TTL expiry (12 h) or manual refresh. Search expands
10 → 25 → 50 mi.

### Heading

Device headings are magnetic; destination bearings are geographic. The app corrects with the
World Magnetic Model declination for the current position, so the arrow points at the true
bearing. Without a heading sensor the dial switches to north-up and shows the absolute bearing.

## Provider configuration (no rebuild required)

Effective config = built-in defaults ← remote JSON ← local overrides (Settings → Providers).
Set a remote URL in Settings or at build time with `VITE_PROVIDER_CONFIG_URL`:

```json
{
  "tiles": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  "tilesDark": null,
  "tileAttribution": "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors",
  "poiEndpoint": "https://overpass.private.coffee/api/interpreter",
  "poiFallbackEndpoints": ["https://maps.mail.ru/osm/tools/overpass/api/interpreter"],
  "geocoderEndpoint": "https://nominatim.openstreetmap.org"
}
```

Public OSM infrastructure is best-effort with usage policies. For production, point these at
self-hosted or commercial OSM-derived services.

## Privacy (§13)

No account, analytics, background location or location history. Stored locally: preferences,
cached shops (search centre rounded to ~1 km), last refresh time, provider config and a consent flag.

## Acceptance checklist (§15)

| # | Criterion | Where |
|---|-----------|-------|
| 2 | Foreground location only | `services/location.ts` (watch paused when hidden) |
| 4–6 | `shop=cannabis` discovery, normalised, deterministic ranking | `providers/overpass.ts`, `lib/geo.ts` |
| 7 | Miles (km optional) | `lib/format.ts` |
| 8–9 | True-bearing arrow, smooth rotation | `components/CompassDial.tsx`, `services/heading.ts` |
| 10 | OSM map | `screens/MapScreen.tsx` |
| 11–12 | Day / Night / System, persisted | `state/settings.tsx` + no-flash boot script |
| 13 | Denial recovery | `LocationRequiredPanel` + permission change listener |
| 14–15 | Sensor / network failures never crash | north-up fallback, error boundaries, cached results |
| 16 | Visible OSM attribution | Compass footer + map control |
| 19 | Swappable providers | `providers/*`, Settings → Providers |
| 20 | Device smoke tests | Settings → Diagnostics shows state, heading source, declination |

**Try it without GPS:** use "Try a sample location" (clearly labelled; results are still live OSM data).
