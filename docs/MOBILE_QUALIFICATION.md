# COMPASS Mobile Qualification

Status is evidence-based. A device family is not marked PASS until exercised on physical hardware.

## iPhone Safari

Verified September 23, 2026 on physical iPhone:

- [x] foreground location permission can be granted
- [x] denied permission is surfaced in the primary UI
- [x] permission can be changed and successfully retried
- [x] stale callbacks from an older denied request cannot overwrite a new request
- [x] initial GPS fix resolves a destination
- [x] exact distance and bearing recompute on-device
- [x] live device heading reaches the compass
- [x] fresh GPS forces a fresh first-session POI search

Still to qualify:

- [ ] background Safari for 30–60 seconds, return, verify live updates recover
- [ ] switch Compass → Map → Nearby → Compass and verify one consistent destination
- [ ] install to Home Screen and cold-launch PWA
- [ ] PWA background/foreground recovery
- [ ] offline restart after one successful online session
- [ ] disable controlled API and verify public-provider continuity fallback

## Android Chrome

Not yet physically qualified:

- [ ] allow/deny/re-enable location
- [ ] live GPS updates
- [ ] device heading
- [ ] Compass / Map / Nearby consistency
- [ ] install PWA and cold launch
- [ ] background/foreground recovery
- [ ] offline cached startup

## Acceptance rule

Screenshots or recorded operator observations count as device evidence. CI protects deterministic source invariants and browser-independent calculations, but it does not substitute for physical sensor/permission qualification.
