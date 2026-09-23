export interface Dispensary {
  id: string;
  name: string | null;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  bearingDegrees: number;
  address?: string;
  openingHours?: string;
  website?: string;
  recreational?: boolean;
  medical?: boolean;
  cbd?: boolean;
  osmType: "node" | "way" | "relation";
  osmId: number;
}

export interface UserFix {
  lat: number;
  lon: number;
  accuracyMeters: number | null;
  timestamp: number;
}

export const EARTH_R = 6371000;
export const M_PER_MILE = 1609.344;

export const toRad = (d: number) => (d * Math.PI) / 180;
export const toDeg = (r: number) => (r * 180) / Math.PI;

export function normalize360(deg: number): number {
  let n = deg % 360;
  if (n < 0) n += 360;
  return n;
}

/** Shortest signed delta from `from` to `to` in (-180, 180] */
export function angularDelta(from: number, to: number): number {
  let d = normalize360(to) - normalize360(from);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_R * c;
}

export function bearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return normalize360(toDeg(Math.atan2(y, x)));
}

export function relativeAngle(
  destinationBearing: number,
  deviceHeading: number
): number {
  return normalize360(destinationBearing - deviceHeading);
}

export function formatMiles(meters: number): string {
  const miles = meters / M_PER_MILE;
  if (miles < 0.1) return "< 0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export function formatMetersShort(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

const CARDINALS = [
  "N", "NNE", "NE", "ENE",
  "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW",
  "W", "WNW", "NW", "NNW",
];

export function cardinalFromBearing(b: number): string {
  const i = Math.round(normalize360(b) / 22.5) % 16;
  return CARDINALS[i];
}

export function displayName(d: Dispensary): string {
  return d.name?.trim() ? d.name : "Cannabis dispensary";
}

/** Very small opening_hours interpreter for common patterns */
export function openStatus(openingHours?: string): {
  label: string;
  open: boolean | null;
} {
  if (!openingHours) return { label: "", open: null };
  const s = openingHours.trim();
  // 24/7
  if (/24\s*\/\s*7/i.test(s)) return { label: "OPEN 24 HOURS", open: true };
  // Try "Mo-Su 09:00-21:00" / "09:00-21:00" — take closing time of last range today
  const timeRanges = [...s.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];
  if (timeRanges.length > 0) {
    const last = timeRanges[timeRanges.length - 1];
    const closeH = parseInt(last[3], 10);
    const closeM = last[4];
    const now = new Date();
    const close = new Date(now);
    close.setHours(closeH, parseInt(closeM, 10), 0, 0);
    // crude: if now before close, assume open
    const openH = parseInt(last[1], 10);
    const open = new Date(now);
    open.setHours(openH, parseInt(last[2], 10), 0, 0);
    let isOpen: boolean | null = null;
    if (now >= open && now <= close) isOpen = true;
    else if (now < open) isOpen = false;
    else {
      // after close — may reopen tomorrow
      isOpen = false;
    }
    if (isOpen === true) {
      const h12 = closeH % 12 === 0 ? 12 : closeH % 12;
      const ap = closeH >= 12 ? "PM" : "AM";
      return { label: `OPEN UNTIL ${h12}:${closeM} ${ap}`, open: true };
    }
    return { label: "CURRENTLY CLOSED", open: false };
  }
  return { label: s.toUpperCase().slice(0, 42), open: null };
}

export function roughAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
