# COMPASS

A privacy-first, compass-driven nearest-dispensary locator built with React, TypeScript, Leaflet, and OpenStreetMap community data.

**Live:** https://ninja-ops-guy.github.io/420Flower-Locator/

## Product

COMPASS answers one question quickly: **where is the nearest mapped cannabis dispensary, and which direction is it?**

The interface combines a live heading instrument with a map and nearby-results view. It is intentionally lightweight, account-free, and foreground-location-only.

## Core behavior

- Foreground geolocation with live position updates
- Device-orientation compass support, including iOS permission flow
- Great-circle distance via Haversine
- Initial bearing calculation and live relative-heading guidance
- Progressive POI search: 10 mi → 25 mi → 50 mi
- OpenStreetMap `shop=cannabis` discovery through multiple Overpass mirrors
- Automatic mirror failover, 12-second request timeout, HTTPS-only provider validation
- POI normalization, malformed-record isolation, deduplication, and distance sorting
- Five-minute / 300 m local search cache
- Stale-cache fallback when the network or public Overpass infrastructure is unavailable
- Day, night, and system themes
- Keyless OpenStreetMap tiles with a local low-light treatment in night mode
- Installable PWA shell with offline app startup
- No analytics, account, server profile, background tracking, or location-history collection

## Architecture

```text
Browser GPS ─────────────┐
                        ├─> live user fix
Device orientation ─────┘          │
                                   ├─> Haversine distance
                                   ├─> initial bearing
                                   └─> compass-relative direction

live user fix
      │
      └─> progressive search
            10 mi → 25 mi → 50 mi
                     │
                     └─> Overpass mirror failover
                           │
                           └─> normalize → dedupe → sort → cache
```

The map and compass remain separate from provider authority: provider failures degrade search availability but do not crash the application shell.

## Development

```bash
cd dispensary-compass-app-specification
npm ci
npm run dev
```

Production validation:

```bash
npm run check
```

`npm run check` performs a full TypeScript typecheck followed by a production Vite build. GitHub Pages runs the same gate before deployment.

## Deployment

There is one authoritative GitHub Pages workflow:

```text
.github/workflows/deploy-pages.yml
```

Every qualifying push to `main` runs:

1. clean dependency install
2. TypeScript validation
3. production build
4. Pages artifact upload
5. production deployment

## Data and reliability boundaries

COMPASS uses public OpenStreetMap community data. A result is only as complete as the underlying mapping coverage. Missing businesses are not fabricated, and the app explicitly reports no-result and provider-unavailable states.

Public Overpass infrastructure is best-effort. COMPASS mitigates this with multiple mirrors, bounded request timeouts, local caching, failover, and stale-result continuity. A high-volume commercial deployment should place a controlled POI/cache service in front of public data infrastructure.

Distances shown in COMPASS are straight-line distances, not road or driving distances.

## Privacy

COMPASS does not require an account and does not intentionally transmit location to an application-owned backend. Location is used in-browser to query selected OpenStreetMap infrastructure. Cached POIs, provider settings, refresh metadata, and theme preference are stored locally in the browser.

## Responsible-use note

21+ where applicable. Informational only. COMPASS does not sell cannabis, process payments, or determine local legality. Users are responsible for following local laws.

## Attribution

Map and POI data: © OpenStreetMap contributors.
