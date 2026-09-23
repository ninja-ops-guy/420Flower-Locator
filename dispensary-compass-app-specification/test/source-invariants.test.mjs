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
  assert.match(app, /Safari reports location permission denied for this site/);
});

test("service worker uses a versioned shell cache", () => {
  assert.match(sw, /const CACHE = "compass-shell-v\d+";/);
});


test("iOS permission acquisition is serialized before live watch starts", () => {
  const requestStart = app.indexOf("const requestLocation = useCallback");
  const requestEnd = app.indexOf("const useDemo =", requestStart);
  const block = app.slice(requestStart, requestEnd);
  const oneShot = block.indexOf("navigator.geolocation.getCurrentPosition(");
  const successHandler = block.indexOf("const acceptFix");
  const watch = block.indexOf("navigator.geolocation.watchPosition(", successHandler);
  assert.ok(oneShot >= 0 && watch >= 0);
  assert.match(block, /Start continuous tracking only after Safari has successfully completed/);
  assert.match(block, /getCurrentPosition\(\s*acceptFix/);
});
