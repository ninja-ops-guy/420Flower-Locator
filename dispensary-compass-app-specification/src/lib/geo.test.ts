import { describe, expect, it } from "vitest";
import {
  angularDelta,
  bearingDegrees,
  cardinalFromBearing,
  formatMiles,
  haversineMeters,
  normalize360,
  openStatus,
} from "./geo";

describe("geo primitives", () => {
  it("normalizes angles", () => {
    expect(normalize360(-10)).toBe(350);
    expect(normalize360(370)).toBe(10);
  });

  it("computes shortest angular delta across north", () => {
    expect(angularDelta(350, 10)).toBe(20);
    expect(angularDelta(10, 350)).toBe(-20);
  });

  it("computes a known great-circle distance", () => {
    const meters = haversineMeters(40.7128, -74.006, 42.3601, -71.0589);
    expect(meters / 1609.344).toBeGreaterThan(185);
    expect(meters / 1609.344).toBeLessThan(195);
  });

  it("computes sensible cardinal bearings", () => {
    expect(cardinalFromBearing(bearingDegrees(0, 0, 1, 0))).toBe("N");
    expect(cardinalFromBearing(bearingDegrees(0, 0, 0, 1))).toBe("E");
  });

  it("formats distance for the UI", () => {
    expect(formatMiles(50)).toBe("< 0.1 mi");
    expect(formatMiles(1609.344)).toBe("1.0 mi");
  });
});

describe("opening-hours safety", () => {
  it("handles 24/7", () => {
    expect(openStatus("24/7")).toEqual({ label: "OPEN 24 HOURS", open: true });
  });

  it("does not guess complex OSM schedules", () => {
    expect(openStatus("Mo-Fr 09:00-17:00; Sa 10:00-14:00")).toEqual({
      label: "HOURS AVAILABLE · VERIFY BEFORE TRAVEL",
      open: null,
    });
  });
});
