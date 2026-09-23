# COMPASS API

This directory contains the controlled POI gateway intended to replace direct public-Overpass dependency for commercial-scale COMPASS traffic.

## Status

**Implementation-ready / not yet in the production consumer data path.**

The GitHub Pages application continues to query public Overpass mirrors directly until this API is independently deployed, qualified, and configured.

## Endpoints

### GET /api/health

Returns service identity and health state.

### GET /api/dispensaries

Parameters:

- `lat` — coarse center latitude
- `lon` — coarse center longitude
- `radiusMiles` — 1 through 55

The intended client contract is to send a coarse location cell instead of the user's exact GPS fix. The API adds a search buffer; the browser remains responsible for calculating exact distance and bearing locally.

## Controls

- fixed upstream allowlist; callers cannot supply arbitrary Overpass URLs
- HTTPS-only upstreams
- origin allowlist for the production GitHub Pages origin and local development
- bounded 8-second upstream requests
- upstream failover
- coordinate and radius validation
- CDN cache directives
- no user account or profile requirement

## Local verification

```bash
cd backend
npm run check
```

This performs syntax validation and network-free API contract tests.

## Vercel deployment

Create a Vercel project with **Root Directory** set to `backend`. No secrets are required for the initial gateway.

Before connecting the consumer application:

1. verify `/api/health`
2. verify CORS from the production COMPASS origin
3. load-test within upstream policy limits
4. verify coarse-location behavior at search-cell boundaries
5. enable runtime monitoring and rate controls
6. update the COMPASS privacy notice
7. configure the frontend API URL
8. retain direct-provider fallback only if its privacy/reliability behavior is explicitly desired
