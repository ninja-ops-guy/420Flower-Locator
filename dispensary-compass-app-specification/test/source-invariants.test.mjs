import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("mobile geolocation retries invalidate stale callbacks", () => {
  assert.match(app, /locationRequestSeq/);
  assert.match(app, /requestSeq !== locationRequestSeq\.current/);
});

test("fresh GPS forces the first POI search of a session", () => {
  assert.match(app, /searchedCenter\.current = null;\s*runSearch\(fix\.lat, fix\.lon, \{ force: true \}\)/);
});

test("location errors are visible in the primary location-required UI", () => {
  assert.match(app, /\{locError && \(/);
  assert.match(app, /iPhone blocked location for this website/);
});

test("service worker uses a versioned shell cache", () => {
  assert.match(sw, /const CACHE = "compass-shell-v\d+";/);
});
