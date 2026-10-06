import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function section(start, end) {
  const first = app.indexOf(start);
  const last = app.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Source section not found: ${start}`);
  return app.slice(first, last);
}

const locationUI = section("{/* LOCATION_REQUIRED */}", "{/* main app grid */}");
const requestBlock = section("const requestLocation = useCallback", "const useDemo =");

test("mobile geolocation retries invalidate stale callbacks", () => {
  assert.match(app, /locationRequestSeq/);
  assert.match(app, /requestSeq !== locationRequestSeq\.current/);
});

test("fresh GPS forces the first POI search of a session", () => {
  assert.match(app, /searchedCenter\.current = null;\s*runSearch\(fix\.lat, fix\.lon, \{ force: true \}\)/);
});

test("location failure message and raw diagnostics are in the location-required UI", () => {
  assert.match(locationUI, /\{locError && \(/);
  assert.match(locationUI, /geo-code=\{geoDiag\.code/);
  assert.match(locationUI, /geo-msg=\{geoDiag\.message/);
  assert.match(locationUI, /secure=\{geoDiag\.secure/);
  assert.match(locationUI, /standalone=\{geoDiag\.standalone/);
  assert.match(locationUI, /visibility=\{document\.visibilityState\}/);
  assert.match(requestBlock, /Safari denied this geolocation request/);
  assert.match(requestBlock, /If Website Settings already shows Location: Allow/);
  assert.doesNotMatch(app, /Safari reports location permission denied for this site/);
});

test("Settings bypasses the location gate in every application phase", () => {
  const gate = locationUI.match(/\{(phase === "LOCATION_REQUIRED"[^\n]+) && \(/);
  const grid = app.match(/\{\((phase !== "LOCATION_REQUIRED"[^\n]+)\) && \(/);
  assert.ok(gate && grid, "Both actual JSX visibility expressions must be present");
  // Evaluate the real source expressions, rather than a duplicated visibility policy.
  const showGate = new Function("phase", "view", `return (${gate[1]});`);
  const showGrid = new Function("phase", "view", `return (${grid[1]});`);
  for (const phase of ["BOOT", "CHECK_PERMISSION", "LOCATING", "SEARCHING", "EXPAND_RADIUS", "NO_RESULTS", "DESTINATION_FOUND", "LOCATION_REQUIRED"]) {
    assert.equal(showGate(phase, "settings"), false, `${phase}: Settings must not show the gate`);
    assert.equal(showGrid(phase, "settings"), true, `${phase}: Settings must remain reachable`);
  }
  for (const view of ["compass", "map", "nearby"]) {
    assert.equal(showGate("LOCATION_REQUIRED", view), true);
    assert.equal(showGrid("LOCATION_REQUIRED", view), false);
    assert.equal(showGrid("DESTINATION_FOUND", view), true);
  }
  assert.match(app, /\{view === "settings" && \(/);
});

test("service worker uses a versioned shell cache", () => {
  assert.match(sw, /const CACHE = "compass-shell-v\d+";/);
});

test("iOS permission acquisition is serialized before live watch starts", () => {
  const oneShot = requestBlock.indexOf("navigator.geolocation.getCurrentPosition(");
  const successHandler = requestBlock.indexOf("const acceptFix");
  const watch = requestBlock.indexOf("navigator.geolocation.watchPosition(", successHandler);
  assert.ok(oneShot >= 0 && watch >= 0);
  assert.match(requestBlock, /Start continuous tracking only after Safari has successfully completed/);
  assert.match(requestBlock, /getCurrentPosition\(\s*acceptFix/);
});

// Execute the actual TypeScript request callback using controlled browser/React
// substitutes. These are deterministic unit tests, not real iPhone GPS tests.
function locationHarness() {
  const requests = [];
  const watches = [];
  const fixes = [];
  const cleared = [];
  const watchId = { current: null };
  const state = { perm: "UNKNOWN", error: null, diag: {}, demo: false, label: null };
  const geolocation = {
    getCurrentPosition(success, error, options) { requests.push({ success, error, options }); },
    watchPosition(success, error, options) {
      watches.push({ success, error, options });
      return watches.length;
    },
    clearWatch(id) { cleared.push(id); },
  };
  const source = ts.transpileModule(`${requestBlock}\nrequestLocation;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  const request = runInNewContext(source, {
    window: { isSecureContext: true },
    navigator: { geolocation },
    useCallback: (fn) => fn,
    watchId,
    locationRequestSeq: { current: 0 },
    setPerm: (value) => { state.perm = value; },
    setLocError: (value) => { state.error = value; },
    setGeoDiag: (update) => { state.diag = update(state.diag); },
    setIsDemo: (value) => { state.demo = value; },
    setDemoLabel: (value) => { state.label = value; },
    applyFix: (...value) => { fixes.push(value); },
    stopWatch: () => {
      if (watchId.current !== null) geolocation.clearWatch(watchId.current);
      watchId.current = null;
    },
  });
  return { request, requests, watches, fixes, cleared, state };
}

const position = { coords: { latitude: 39.7392, longitude: -104.9903, accuracy: 1500 } };
const geoError = (code, message) => ({ code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });

test("a tap issues one request and starts a watch only after success, accepting approximate fixes", () => {
  const h = locationHarness();
  assert.equal(h.requests.length, 0);
  h.request();
  assert.equal(h.requests.length, 1);
  assert.equal(h.watches.length, 0);
  assert.equal(h.state.perm, "REQUESTING");
  h.requests[0].success(position);
  assert.equal(h.state.perm, "GRANTED");
  assert.equal(h.state.error, null);
  assert.equal(h.watches.length, 1);
  assert.deepEqual(h.fixes[0], [39.7392, -104.9903, 1500]);
});

test("permission denial retains raw diagnostics without starting GPS updates", () => {
  const h = locationHarness();
  h.request();
  h.requests[0].error(geoError(1, "User denied Geolocation"));
  assert.equal(h.state.perm, "DENIED");
  assert.equal(h.state.diag.code, 1);
  assert.equal(h.state.diag.message, "User denied Geolocation");
  assert.match(h.state.error, /Website Settings already shows Location: Allow/);
  assert.equal(h.watches.length, 0);
});

test("retry ignores both success and error callbacks from the previous request", () => {
  const h = locationHarness();
  h.request();
  h.request();
  h.requests[0].success(position);
  h.requests[0].error(geoError(1, "stale denial"));
  assert.equal(h.state.perm, "REQUESTING");
  assert.equal(h.fixes.length, 0);
  assert.equal(h.watches.length, 0);
  h.requests[1].success(position);
  assert.equal(h.state.perm, "GRANTED");
  assert.equal(h.fixes.length, 1);
  assert.equal(h.watches.length, 1);
});

test("retry clears a prior watch and ignores its delayed callbacks", () => {
  const h = locationHarness();
  h.request();
  h.requests[0].success(position);
  h.request();
  assert.deepEqual(h.cleared, [1]);
  h.watches[0].success(position);
  h.watches[0].error(geoError(1, "stale watch denial"));
  assert.equal(h.fixes.length, 1);
  assert.equal(h.state.perm, "REQUESTING");
  assert.equal(h.state.error, "Waiting for location…");
});

for (const code of [2, 3]) {
  test(`geolocation error ${code} is retryable and is not mislabeled as denied`, () => {
    const h = locationHarness();
    h.request();
    h.requests[0].error(geoError(code, "test failure"));
    assert.equal(h.state.perm, "UNKNOWN");
    assert.equal(h.state.diag.code, code);
    assert.equal(h.state.diag.message, "test failure");
    assert.equal(h.watches.length, 0);
  });
}


test("cached POIs are validated before GPS makes them renderable", () => {
  assert.match(app, /Array\.isArray\(parsed\)/);
  assert.match(app, /Number\.isFinite\(d\.latitude\)/);
  assert.match(app, /Number\.isFinite\(d\.longitude\)/);
  assert.match(app, /malformed\/legacy cache is ignored/);
  assert.match(app, /Number\.isFinite\(p\.distanceMeters\)/);
  assert.match(app, /Number\.isFinite\(p\.bearingDegrees\)/);
});
