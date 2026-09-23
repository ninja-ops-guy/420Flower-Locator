import test from "node:test";
import assert from "node:assert/strict";
import {
  angularDelta,
  bearingDegrees,
  cardinalFromBearing,
  formatMiles,
  haversineMeters,
  normalize360,
  openStatus,
} from "../.test-build/geo.js";

test("normalize360 wraps negative and overflow angles", () => {
  assert.equal(normalize360(-10), 350);
  assert.equal(normalize360(370), 10);
});

test("angularDelta crosses north by the shortest path", () => {
  assert.equal(angularDelta(350, 10), 20);
  assert.equal(angularDelta(10, 350), -20);
});

test("haversineMeters matches NYC to Boston within a useful tolerance", () => {
  const miles = haversineMeters(40.7128, -74.0060, 42.3601, -71.0589) / 1609.344;
  assert.ok(miles > 185 && miles < 195, `distance was ${miles.toFixed(2)} mi`);
});

test("bearingDegrees produces cardinal north and east", () => {
  assert.equal(cardinalFromBearing(bearingDegrees(0, 0, 1, 0)), "N");
  assert.equal(cardinalFromBearing(bearingDegrees(0, 0, 0, 1)), "E");
});

test("formatMiles keeps consumer-friendly precision", () => {
  assert.equal(formatMiles(50), "< 0.1 mi");
  assert.equal(formatMiles(1609.344), "1.0 mi");
});

test("opening-hours logic is conservative for complex OSM schedules", () => {
  assert.deepEqual(openStatus("24/7"), { label: "OPEN 24 HOURS", open: true });
  assert.deepEqual(openStatus("Mo-Fr 09:00-17:00; Sa 10:00-14:00"), {
    label: "HOURS AVAILABLE · VERIFY BEFORE TRAVEL",
    open: null,
  });
});
