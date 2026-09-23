# COMPASS Production Runbook

## Release gates

A production release is accepted only when the GitHub Pages workflow passes all of the following:

1. clean `npm ci`
2. dependency audit with no high-or-critical finding
3. TypeScript validation
4. production Vite build
5. GitHub Pages deployment
6. public-site smoke test against the canonical URL

A green build alone is not a production acceptance signal.

## Public endpoint

https://ninja-ops-guy.github.io/420Flower-Locator/

## Data dependencies

COMPASS uses OpenStreetMap community data and public Overpass endpoints. These services are external, best-effort dependencies and are not a commercial SLA.

Current mitigations:

- progressive 10 / 25 / 50 mile searches
- multiple HTTPS Overpass mirrors
- bounded request timeout
- malformed-record isolation
- POI deduplication
- five-minute local cache
- stale-cache continuity
- explicit provider-unavailable state

Before commercial-scale traffic, introduce a controlled POI/cache service and monitor its availability independently.

## Incident modes

### Application does not render
Check the Pages workflow and public smoke gate. The React error boundary provides a local recovery action for unexpected render failures.

### README appears instead of application
Confirm repository Pages source is GitHub Actions, not branch/Jekyll publishing.

### Map tiles show provider/API-key placeholders
Clear obsolete provider configuration. Current production defaults are keyless OpenStreetMap tiles under `compass:providers-v2`.

### Search fails
Check network connectivity and public Overpass availability. COMPASS attempts mirrors in order and preserves cached POIs when available.

### Location unavailable
Do not infer or fabricate a destination. Ask the user to grant foreground location or use an explicit demo location.

### Cached results exist before a GPS fix
Cached POIs are continuity data only. They must not be promoted to an active destination until a current location fix exists.

## Rollback

Use GitHub to revert the offending production commit on `main`. The authoritative Pages workflow will rebuild, deploy, and smoke-test the reverted head. Do not manually publish a branch to Pages.

## Manual release qualification

At minimum test:

- iPhone Safari: location allow/deny, motion permission, rotate device
- Android Chrome: location allow/deny, heading updates
- desktop Chromium: demo mode, map, nearby, settings
- Firefox: demo mode and map
- 10 → 25 → 50 mile expansion
- all Overpass endpoints unavailable
- offline restart after a previously successful session
- theme: light / dark / system
- PWA installation and standalone launch
- directions and OpenStreetMap outbound links
- no active destination before a current GPS fix

Record device/browser versions and PASS/FAIL evidence for release candidates.
