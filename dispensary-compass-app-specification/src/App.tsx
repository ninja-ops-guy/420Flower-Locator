import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Cannabis, Check, ChevronRight, Compass as CompassIcon, Crosshair,
  ExternalLink, Globe, Layers, LocateFixed, Map as MapIcon, MapPin, Monitor,
  Moon, Navigation, Radar, RefreshCw, RotateCcw, Settings as SettingsIcon,
  ShieldCheck, Sun, WifiOff, ListFilter, Info, Footprints, Clock3, X,
} from "lucide-react";
import CompassDial from "./components/CompassDial";
import MapView from "./components/MapView";
import MerchantClaimModal from "./components/MerchantClaimModal";
import {
  angularDelta, bearingDegrees, cardinalFromBearing, displayName, formatMiles,
  haversineMeters, normalize360, openStatus, roughAge,
  type Dispensary, type UserFix,
} from "./lib/geo";
import { DEFAULT_PROVIDERS, SEARCH_RADII_MILES, searchExpanding, type ProviderConfig } from "./lib/osm";
import { cn } from "./utils/cn";

/* ---------------------------------- types --------------------------------- */

type ThemeMode = "system" | "light" | "dark";
type PermState = "UNKNOWN" | "REQUESTING" | "GRANTED" | "DENIED";
type Phase =
  | "BOOT" | "CHECK_PERMISSION" | "LOCATING" | "SEARCHING"
  | "EXPAND_RADIUS" | "NO_RESULTS" | "DESTINATION_FOUND" | "LOCATION_REQUIRED";
type View = "compass" | "map" | "nearby" | "settings";

const DEMOS = [
  { label: "Denver, CO", lat: 39.7392, lon: -104.9903, hint: "dense coverage" },
  { label: "Los Angeles, CA", lat: 34.0522, lon: -118.2437, hint: "dense coverage" },
  { label: "Portland, OR", lat: 45.5152, lon: -122.6784, hint: "dense coverage" },
  { label: "Seattle, WA", lat: 47.6062, lon: -122.3321, hint: "good coverage" },
  { label: "Chicago, IL", lat: 41.8781, lon: -87.6298, hint: "good coverage" },
  { label: "Amsterdam, NL", lat: 52.3702, lon: 4.8952, hint: "coffeeshops ≠ tagged" },
];

const LS_THEME = "compass:theme";
const LS_POIS = "compass:pois-v1";
const LS_META = "compass:meta-v1";
const LS_PROV = "compass:providers-v3";

function loadTheme(): ThemeMode {
  try { const t = localStorage.getItem(LS_THEME); if (t === "light" || t === "dark" || t === "system") return t; } catch { /* noop */ }
  return "system";
}
function loadProviders(): ProviderConfig {
  try {
    const raw = localStorage.getItem(LS_PROV);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ProviderConfig>;
      return {
        tiles: typeof p.tiles === "string" && p.tiles ? p.tiles : DEFAULT_PROVIDERS.tiles,
        darkTiles: typeof p.darkTiles === "string" && p.darkTiles ? p.darkTiles : DEFAULT_PROVIDERS.darkTiles,
        poiEndpoints: Array.isArray(p.poiEndpoints) && p.poiEndpoints.length > 0 ? p.poiEndpoints : DEFAULT_PROVIDERS.poiEndpoints,
        geocoderEndpoint: typeof p.geocoderEndpoint === "string" && p.geocoderEndpoint ? p.geocoderEndpoint : DEFAULT_PROVIDERS.geocoderEndpoint,
        apiEndpoint: typeof p.apiEndpoint === "string" ? p.apiEndpoint : DEFAULT_PROVIDERS.apiEndpoint,
      };
    }
  } catch { /* noop */ }
  return DEFAULT_PROVIDERS;
}

/* ----------------------------------- app ----------------------------------- */

export default function App() {
  /* theme */
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadTheme);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false
  );
  const dark = themeMode === "dark" || (themeMode === "system" && systemDark);
  useEffect(() => {
    try { localStorage.setItem(LS_THEME, themeMode); } catch { /* noop */ }
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [themeMode, dark]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  /* providers */
  const [providers, setProviders] = useState<ProviderConfig>(loadProviders);
  useEffect(() => { try { localStorage.setItem(LS_PROV, JSON.stringify(providers)); } catch { /* noop */ } }, [providers]);

  /* merchant capabilities */
  const merchantApiOrigin = useMemo(() => {
    try { return providers.apiEndpoint ? new URL(providers.apiEndpoint).origin : ""; } catch { return ""; }
  }, [providers.apiEndpoint]);
  const [merchantClaimsAvailable, setMerchantClaimsAvailable] = useState(false);
  const [merchantAnalyticsAvailable, setMerchantAnalyticsAvailable] = useState(false);
  const [claimTarget, setClaimTarget] = useState<Dispensary | null>(null);
  const lastTrackedListing = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!merchantApiOrigin) {
      setMerchantClaimsAvailable(false);
      setMerchantAnalyticsAvailable(false);
      return;
    }

    fetch(`${merchantApiOrigin}/api/capabilities`, { headers: { Accept: "application/json" } })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error("capabilities unavailable")))
      .then((data) => {
        if (cancelled) return;
        setMerchantClaimsAvailable(Boolean(data?.merchantClaims));
        setMerchantAnalyticsAvailable(Boolean(data?.merchantAnalytics));
      })
      .catch(() => {
        if (!cancelled) {
          setMerchantClaimsAvailable(false);
          setMerchantAnalyticsAvailable(false);
        }
      });

    return () => { cancelled = true; };
  }, [merchantApiOrigin]);

  const trackMerchantEvent = useCallback((target: Dispensary, eventType: string) => {
    if (!merchantAnalyticsAvailable || !merchantApiOrigin) return;
    fetch(`${merchantApiOrigin}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationKey: `${target.osmType}/${target.osmId}`,
        eventType,
      }),
      keepalive: true,
    }).catch(() => { /* analytics never blocks consumer navigation */ });
  }, [merchantAnalyticsAvailable, merchantApiOrigin]);

  /* location */
  const [perm, setPerm] = useState<PermState>("UNKNOWN");
  const [fix, setFix] = useState<UserFix | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [demoLabel, setDemoLabel] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const locationRequestSeq = useRef(0);

  const stopWatch = useCallback(() => {
    if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
  }, []);

  const applyFix = useCallback((lat: number, lon: number, acc: number | null) => {
    setFix({ lat, lon, accuracyMeters: acc, timestamp: Date.now() });
  }, []);

  const requestLocation = useCallback(() => {
    if (!window.isSecureContext) {
      setPerm("DENIED");
      setLocError("Live location requires a secure HTTPS connection.");
      return;
    }
    if (!("geolocation" in navigator)) {
      setPerm("DENIED");
      setLocError("This device or browser has no geolocation service.");
      return;
    }

    const requestSeq = ++locationRequestSeq.current;
    setPerm("REQUESTING");
    setLocError("Waiting for iPhone location…");
    stopWatch();

    let hasFix = false;
    let pendingOneShots = 2;

    const acceptFix = (p: GeolocationPosition) => {
      if (requestSeq !== locationRequestSeq.current) return;
      hasFix = true;
      setPerm("GRANTED");
      setLocError(null);
      setIsDemo(false);
      setDemoLabel(null);
      applyFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy ?? null);
    };

    const fail = (e: GeolocationPositionError, source: string) => {
      if (requestSeq !== locationRequestSeq.current) return;
      if (e.code === e.PERMISSION_DENIED) {
        // iOS can report PERMISSION_DENIED from one concurrent geolocation
        // request while another request from the same tap still succeeds.
        // Treat denial as final only after both one-shot probes have also
        // finished; never let the watch callback cancel potentially successful
        // permission-producing calls.
        if (source !== "watch") pendingOneShots = Math.max(0, pendingOneShots - 1);
        if (hasFix) return;
        if (pendingOneShots > 0) {
          setLocError("Waiting for iPhone location permission…");
          return;
        }
        stopWatch();
        setPerm("DENIED");
        setLocError("iPhone blocked location for this website. Safari: tap the page menu → Website Settings → Location → Allow. Also check Settings → Privacy & Security → Location Services → Safari Websites.");
        return;
      }
      if (source !== "watch") pendingOneShots = Math.max(0, pendingOneShots - 1);
      if (hasFix) return;
      if (pendingOneShots > 0 || source === "watch") {
        setLocError("Still acquiring an iPhone location fix…");
        return;
      }
      setPerm("UNKNOWN");
      setLocError(e.code === e.POSITION_UNAVAILABLE
        ? "iPhone could not produce a location. Confirm Location Services are on for Safari Websites, then try again."
        : "iPhone location timed out. Tap Enable Location to retry.");
    };

    // Start all three paths from the same user gesture. iOS versions differ in
    // which path returns first: cached/network, fresh GPS, or the live watcher.
    watchId.current = navigator.geolocation.watchPosition(
      acceptFix,
      (e) => fail(e, "watch"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );

    navigator.geolocation.getCurrentPosition(
      acceptFix,
      (e) => fail(e, "cached"),
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 6000 }
    );

    navigator.geolocation.getCurrentPosition(
      acceptFix,
      (e) => fail(e, "fresh"),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }, [applyFix, stopWatch]);

  const useDemo = useCallback((lat: number, lon: number, label: string) => {
    locationRequestSeq.current += 1;
    stopWatch();
    didAuto.current = false;
    setPerm("GRANTED");
    setLocError(null);
    setIsDemo(true);
    setDemoLabel(label);
    setFix({ lat, lon, accuracyMeters: 18, timestamp: Date.now() });
  }, [stopWatch]);

  useEffect(() => () => {
    // Invalidate every callback owned by the unmounted page before clearing the
    // watcher. This protects Safari BFCache/PWA transitions from resurrecting
    // stale permission or timeout results into a new app instance.
    locationRequestSeq.current += 1;
    stopWatch();
  }, [stopWatch]);

  // iOS Safari may suspend geolocation when the tab is backgrounded or the
  // browser chrome changes presentation. Re-establish the foreground watcher
  // when the page becomes active again instead of falling back to a dead state.
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      // A visible page with a previous foreground grant should always have a
      // live watcher. Reacquire through the same generation-safe request path.
      if (perm === "GRANTED" && watchId.current == null) requestLocation();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [perm, requestLocation]);

  /* heading */
  const [headingTarget, setHeadingTarget] = useState<number | null>(null);
  const [headingSmooth, setHeadingSmooth] = useState<number | null>(null);
  const [headingSupported, setHeadingSupported] = useState(true);
  const [headingDenied, setHeadingDenied] = useState(false);
  const [simulate, setSimulate] = useState(false);
  const [manualHeading, setManualHeading] = useState(24);
  const simRef = useRef<number>(24);
  const headingListenerRef = useRef<EventListener | null>(null);

  // rAF smoothing toward target
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setHeadingSmooth((prev) => {
        const t = headingTarget;
        if (t == null) return prev;
        if (prev == null) return t;
        const d = angularDelta(prev, t);
        if (Math.abs(d) < 0.08) return t;
        return normalize360(prev + d * 0.14);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [headingTarget]);

  // simulation driver
  useEffect(() => {
    if (!simulate) return;
    const id = window.setInterval(() => {
      simRef.current = normalize360(simRef.current + 1.6);
      setHeadingTarget(simRef.current);
      setManualHeading(Math.round(simRef.current));
    }, 50);
    return () => window.clearInterval(id);
  }, [simulate]);

  useEffect(() => {
    if (simulate) { setHeadingTarget(simRef.current); return; }
    if (manualHeading != null && headingTarget == null) {
      // do nothing until sensor or manual set
    }
  }, [simulate, manualHeading, headingTarget]);

  const enableCompassSensor = useCallback(async () => {
    setHeadingDenied(false);
    try {
      const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
      if (DOE && typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res !== "granted") { setHeadingDenied(true); return; }
      }

      if (headingListenerRef.current) {
        window.removeEventListener("deviceorientationabsolute", headingListenerRef.current, true);
        window.removeEventListener("deviceorientation", headingListenerRef.current, true);
      }

      let sawReading = false;
      const handler = ((event: Event) => {
        const e = event as DeviceOrientationEvent;
        const w = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
        let h: number | null = null;
        if (typeof w.webkitCompassHeading === "number" && Number.isFinite(w.webkitCompassHeading)) h = w.webkitCompassHeading;
        else if (typeof e.alpha === "number" && Number.isFinite(e.alpha)) h = normalize360(360 - e.alpha);
        if (h != null) {
          sawReading = true;
          setHeadingSupported(true);
          setSimulate(false);
          setHeadingTarget(h);
        }
      }) as EventListener;

      headingListenerRef.current = handler;
      window.addEventListener("deviceorientationabsolute", handler, true);
      window.addEventListener("deviceorientation", handler, true);

      window.setTimeout(() => {
        if (!sawReading) setHeadingSupported(false);
      }, 1800);
    } catch {
      setHeadingDenied(true);
      setHeadingSupported(false);
    }
  }, []);

  useEffect(() => () => {
    if (headingListenerRef.current) {
      window.removeEventListener("deviceorientationabsolute", headingListenerRef.current, true);
      window.removeEventListener("deviceorientation", headingListenerRef.current, true);
      headingListenerRef.current = null;
    }
  }, []);

  const nudgeManual = useCallback((v: number) => {
    setSimulate(false);
    setManualHeading(v);
    setHeadingTarget(v);
  }, []);

  /* online */
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  /* POIs */
  const [pois, setPois] = useState<Dispensary[]>(() => {
    try { const raw = localStorage.getItem(LS_POIS); if (raw) return JSON.parse(raw) as Dispensary[]; } catch { /* noop */ }
    return [];
  });
  const [meta, setMeta] = useState<{ at: number; center: { lat: number; lon: number }; radiusMiles: number; endpoint: string } | null>(() => {
    try { const raw = localStorage.getItem(LS_META); if (raw) return JSON.parse(raw); } catch { /* noop */ }
    return null;
  });
  const [searching, setSearching] = useState(false);
  const [tierNote, setTierNote] = useState<string | null>(null);
  const [tiersTried, setTiersTried] = useState<number[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [staleOffline, setStaleOffline] = useState(false);
  const [lastEndpoint, setLastEndpoint] = useState<string>(meta?.endpoint ?? "");
  const abortRef = useRef<AbortController | null>(null);
  const searchedCenter = useRef<{ lat: number; lon: number } | null>(meta?.center ?? null);

  const persistCache = useCallback((list: Dispensary[], m: NonNullable<typeof meta>) => {
    try {
      localStorage.setItem(LS_POIS, JSON.stringify(list.slice(0, 120)));
      localStorage.setItem(LS_META, JSON.stringify(m));
    } catch { /* quota — noop */ }
  }, []);

  const runSearch = useCallback(async (lat: number, lon: number, opts?: { force?: boolean }) => {
    // TTL / movement guard unless forced
    if (!opts?.force && searchedCenter.current && meta) {
      const moved = haversineMeters(lat, lon, searchedCenter.current.lat, searchedCenter.current.lon);
      const age = Date.now() - meta.at;
      if (moved < 300 && age < 5 * 60 * 1000 && pois.length > 0) return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSearching(true);
    setSearchError(null);
    setStaleOffline(false);
    setTiersTried([]);
    setTierNote(`Scanning 10 mi…`);
    try {
      const r = await searchExpanding(lat, lon, providers.poiEndpoints, (radiusMiles, count) => {
        setTiersTried((t) => (t.includes(radiusMiles) ? t : [...t, radiusMiles]));
        if (count === 0) {
          const next = SEARCH_RADII_MILES[SEARCH_RADII_MILES.indexOf(radiusMiles) + 1];
          setTierNote(next ? `Nothing in ${radiusMiles} mi — expanding to ${next} mi…` : `Nothing in ${radiusMiles} mi…`);
        } else setTierNote(`Found ${count} in ${radiusMiles} mi`);
      }, ctrl.signal, providers.apiEndpoint);
      setLastEndpoint(r.endpoint);
      setTiersTried(r.tiersTried);
      setPois(r.pois);
      const m = { at: Date.now(), center: { lat, lon }, radiusMiles: r.radiusMiles, endpoint: r.endpoint };
      setMeta(m);
      searchedCenter.current = { lat, lon };
      persistCache(r.pois, m);
      setTierNote(r.pois.length ? `Nearest of ${r.pois.length} · ${r.radiusMiles} mi radius` : null);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      // offline w/ cache → stale mode
      if (pois.length > 0) {
        setStaleOffline(true);
        setSearchError(null);
        setTierNote("Offline — showing nearest known result");
      } else {
        setSearchError(!navigator.onLine ? "You appear to be offline." : "OSM provider unavailable — Overpass mirrors are rate-limited. Wait a moment and retry.");
      }
    } finally {
      setSearching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.poiEndpoints, providers.apiEndpoint, meta?.at, persistCache]);

  // auto search on first fix
  const didAuto = useRef(false);
  useEffect(() => {
    if (fix && !didAuto.current) {
      didAuto.current = true;
      // A cached search center must never suppress the first search of a new
      // browser session. The user's fresh GPS fix is authoritative.
      searchedCenter.current = null;
      runSearch(fix.lat, fix.lon, { force: true });
    }
  }, [fix, runSearch]);

  // auto refresh on meaningful movement
  useEffect(() => {
    if (!fix || !searchedCenter.current || searching) return;
    const moved = haversineMeters(fix.lat, fix.lon, searchedCenter.current.lat, searchedCenter.current.lon);
    if (moved > 800 && pois.length > 0) {
      const t = window.setTimeout(() => fix && runSearch(fix.lat, fix.lon), 1200);
      return () => window.clearTimeout(t);
    }
  }, [fix, pois.length, runSearch, searching]);

  /* live recompute distances/bearings locally (no refetch) */
  const livePois = useMemo(() => {
    // Cached POIs are continuity data, not a valid destination until we have a
    // current location fix. This prevents a previous session's destination
    // from appearing while permission/GPS is still unresolved.
    if (!fix) return [];
    return pois
      .map((p) => ({
        ...p,
        distanceMeters: haversineMeters(fix.lat, fix.lon, p.latitude, p.longitude),
        bearingDegrees: bearingDegrees(fix.lat, fix.lon, p.latitude, p.longitude),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [pois, fix]);

  const nearest: Dispensary | null = livePois[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => livePois.find((p) => p.id === selectedId) ?? nearest, [livePois, selectedId, nearest]);
  const focusTarget = selected ?? nearest;

  useEffect(() => {
    if (!focusTarget || !merchantAnalyticsAvailable) return;
    const key = `${focusTarget.osmType}/${focusTarget.osmId}`;
    if (lastTrackedListing.current === key) return;
    lastTrackedListing.current = key;
    trackMerchantEvent(focusTarget, "listing_view");
  }, [focusTarget, merchantAnalyticsAvailable, trackMerchantEvent]);

  /* phase */
  const phase: Phase = useMemo(() => {
    if (perm === "DENIED" && !fix) return "LOCATION_REQUIRED";
    if (perm === "UNKNOWN" && !fix) return "LOCATION_REQUIRED";
    if (perm === "REQUESTING") return !fix ? "CHECK_PERMISSION" : "LOCATING";
    if (!fix) return "LOCATING";
    if (searching) return tiersTried.length > 1 || (tierNote?.includes("expanding") ?? false) ? "EXPAND_RADIUS" : "SEARCHING";
    if (searchError && livePois.length === 0) return "NO_RESULTS";
    if (livePois.length === 0) return "NO_RESULTS";
    return "DESTINATION_FOUND";
  }, [perm, fix, searching, tiersTried.length, tierNote, searchError, livePois.length]);

  const heading = headingSmooth ?? headingTarget;
  const rel = focusTarget && heading != null ? normalize360(focusTarget.bearingDegrees - heading) : null;
  const aligned = rel != null && (rel < 8 || rel > 352);

  /* view */
  const [view, setView] = useState<View>("compass");
  const [provDraft, setProvDraft] = useState<string>(providers.poiEndpoints.join("\n"));
  useEffect(() => { setProvDraft(providers.poiEndpoints.join("\n")); }, [providers.poiEndpoints]);

  const directionsUrl = focusTarget
    ? `https://www.google.com/maps/dir/?api=1&destination=${focusTarget.latitude},${focusTarget.longitude}`
    : "#";
  const osmUrl = focusTarget
    ? `https://www.openstreetmap.org/?mlat=${focusTarget.latitude}&mlon=${focusTarget.longitude}#map=17/${focusTarget.latitude}/${focusTarget.longitude}`
    : "https://www.openstreetmap.org/copyright";

  const status = openStatus(focusTarget?.openingHours);

  return (
    <div className={cn("min-h-screen transition-colors duration-500", dark ? "bg-topo-dark text-[#eef3ec]" : "bg-topo-light text-[#161a15]")}>
      {/* top hairline */}
      <div className="h-1 w-full bg-gradient-to-r from-emerald-700 via-emerald-500 to-rose-600" />

      <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
        {/* header */}
        <header className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl shadow-lg", dark ? "bg-emerald-400 text-emerald-950 shadow-emerald-900/40" : "bg-emerald-800 text-emerald-50 shadow-emerald-900/20")}>
              <CompassIcon className="h-5 w-5" strokeWidth={2.4} />
            </div>
            <div className="leading-none">
              <div className="flex items-center gap-2">
                <span className="font-display text-[22px] font-black tracking-[0.22em]">COMPASS</span>
                <span className={cn("hidden rounded-full px-2 py-0.5 font-mono2 text-[10px] font-bold tracking-[0.14em] sm:inline-block", dark ? "bg-white/10 text-emerald-200" : "bg-black/[0.07] text-emerald-900")}>SPEC-COMPASS-001 · v1.0</span>
              </div>
              <div className={cn("mt-1 font-mono2 text-[10.5px] tracking-[0.18em]", dark ? "text-white/45" : "text-black/50")}>NEAREST DISPENSARY · STRAIGHT-LINE</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* net + phase */}
            <div className={cn("hidden items-center gap-2 rounded-full border px-3 py-1.5 font-mono2 text-[10.5px] font-bold tracking-[0.14em] md:flex", dark ? "border-white/10 bg-white/[0.04]" : "border-black/10 bg-white/70")}>
              <span className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-500" : "bg-rose-500")} style={{ animation: "pulse-dot 2s infinite" }} />
              {online ? "ONLINE" : "OFFLINE"}
              <span className={dark ? "text-white/30" : "text-black/25"}>·</span>
              <span className={dark ? "text-emerald-200" : "text-emerald-900"}>{phase}</span>
            </div>
            {/* theme segmented */}
            <div className={cn("flex items-center rounded-full border p-1", dark ? "border-white/10 bg-white/[0.05]" : "border-black/10 bg-white/80 shadow-sm")}>
              {([["light", Sun, "Day"], ["dark", Moon, "Night"], ["system", Monitor, "System"]] as [ThemeMode, typeof Sun, string][]).map(([m, Icon, label]) => (
                <button
                  key={m}
                  title={label}
                  onClick={() => setThemeMode(m)}
                  className={cn("flex h-8 w-8 items-center justify-center rounded-full transition-all", themeMode === m ? (dark ? "bg-emerald-400 text-emerald-950" : "bg-emerald-800 text-white shadow") : (dark ? "text-white/50 hover:text-white" : "text-black/45 hover:text-black"))}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* offline / stale banners */}
        {!online && (
          <div className={cn("mb-3 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm", dark ? "border-amber-300/20 bg-amber-300/10 text-amber-100" : "border-amber-600/25 bg-amber-50 text-amber-950")}>
            <WifiOff className="h-4 w-4 shrink-0" />
            <div><strong>Offline.</strong> {livePois.length ? "Showing nearest known dispensary — location info may be outdated." : "Connect to search OpenStreetMap for shop=cannabis."}</div>
          </div>
        )}
        {staleOffline && online && (
          <div className={cn("mb-3 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm", dark ? "border-white/10 bg-white/[0.05] text-white/80" : "border-black/10 bg-white/80 text-black/70")}>
            <Clock3 className="h-4 w-4 shrink-0" />
            <div>Provider hiccup — kept your last cached result. Distances recompute live from GPS.</div>
          </div>
        )}

        {/* mobile tab bar */}
        <nav className={cn("mb-4 flex items-center gap-1 overflow-x-auto rounded-2xl border p-1.5 lg:hidden", dark ? "border-white/10 bg-white/[0.04]" : "border-black/10 bg-white/80 shadow-sm")}>
          {([["compass", CompassIcon, "Compass"], ["map", MapIcon, "Map"], ["nearby", ListFilter, `Nearby${livePois.length ? ` · ${livePois.length}` : ""}`], ["settings", SettingsIcon, "Settings"]] as [View, typeof MapIcon, string][]).map(([v, Icon, label]) => (
            <button key={v} onClick={() => setView(v)} className={cn("flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-[13px] font-bold transition-all", view === v ? (dark ? "bg-emerald-400 text-emerald-950 shadow" : "bg-emerald-800 text-white shadow") : (dark ? "text-white/55 hover:text-white" : "text-black/55 hover:text-black"))}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </nav>

        {/* LOCATION_REQUIRED */}
        {phase === "LOCATION_REQUIRED" && (
          <section className={cn("overflow-hidden rounded-[1.75rem] border", dark ? "border-white/10 bg-white/[0.03]" : "border-black/10 bg-white/85 shadow-xl")}>
            <div className="grid md:grid-cols-2">
              <div className="p-7 sm:p-10">
                <div className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono2 text-[11px] font-bold tracking-[0.16em]", dark ? "bg-rose-400/15 text-rose-200" : "bg-rose-50 text-rose-800 border border-rose-200")}>
                  <AlertTriangle className="h-3.5 w-3.5" /> LOCATION REQUIRED
                </div>
                <h1 className="font-display mt-4 text-4xl font-black leading-[1.02] tracking-tight sm:text-5xl">Compass needs your location to find dispensaries near you.</h1>
                <p className={cn("mt-4 max-w-md text-[15px] leading-relaxed", dark ? "text-white/60" : "text-black/60")}>
                  Foreground location only — while the app is open. No account, no history, no background tracking. Exact distance and bearing stay on-device; the controlled search gateway receives only a coarse nearby-search center when available.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button onClick={() => { locationRequestSeq.current += 1; setPerm("UNKNOWN"); setLocError(null); setFix(null); didAuto.current = false; requestLocation(); }} className={cn("inline-flex items-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-extrabold tracking-wide transition-transform hover:-translate-y-0.5", dark ? "bg-emerald-400 text-emerald-950 shadow-[0_16px_40px_-12px_rgba(52,211,153,0.6)]" : "bg-emerald-800 text-white shadow-[0_16px_40px_-12px_rgba(13,92,67,0.6)]")}>
                    <LocateFixed className="h-4 w-4" /> ENABLE LOCATION
                  </button>
                  <button onClick={() => useDemo(39.7392, -104.9903, "Denver, CO")} className={cn("inline-flex items-center gap-2 rounded-2xl border px-5 py-3.5 text-sm font-bold", dark ? "border-white/15 text-white/80 hover:bg-white/5" : "border-black/15 text-black/75 hover:bg-black/[0.04]")}>
                    <Radar className="h-4 w-4" /> Try demo · Denver
                  </button>
                </div>
                {locError && (
                  <div className={cn("mt-4 rounded-2xl border px-4 py-3 text-sm leading-relaxed", dark ? "border-amber-300/20 bg-amber-300/10 text-amber-100" : "border-amber-700/20 bg-amber-50 text-amber-950")}>
                    {locError}
                  </div>
                )}
                <div className={cn("mt-6 flex items-center gap-2 text-xs", dark ? "text-white/40" : "text-black/45")}>
                  <ShieldCheck className="h-4 w-4" /> We don't need background location. Ever.
                </div>
              </div>
              <div className={cn("relative flex min-h-[320px] flex-col justify-between overflow-hidden p-7", dark ? "bg-gradient-to-br from-emerald-950 via-[#101510] to-[#0e100e]" : "bg-gradient-to-br from-emerald-900 via-emerald-800 to-[#123527] text-white")}>
                <div className="font-mono2 text-[11px] tracking-[0.2em] text-white/50">HOW IT WORKS</div>
                <div className="space-y-3 font-mono2 text-[12.5px] leading-relaxed text-white/85">
                  {["Current Location →", "Search nearby OSM POIs →", "shop=cannabis →", "Normalize → distance →", "Sort ascending → nearest"].map((s, i) => (
                    <div key={s} className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold">{i + 1}</span>{s}
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl bg-black/25 p-4 font-mono2 text-[11px] leading-relaxed text-white/70">
                  nwr["shop"="cannabis"](around:16093, lat, lon);<br />out center 60; <span className="text-emerald-300">— Overpass QL</span>
                </div>
              </div>
            </div>
            {/* demo strip */}
            <DemoStrip dark={dark} onDemo={useDemo} />
          </section>
        )}

        {/* main app grid */}
        {phase !== "LOCATION_REQUIRED" && (
          <main className="grid gap-4 lg:grid-cols-[400px_1fr]">
            {/* LEFT — compass column (always on lg, tab-gated on mobile) */}
            <div className={cn(view !== "compass" && "hidden lg:block")}>
              <section className={cn("overflow-hidden rounded-[1.75rem] border", dark ? "border-white/10 bg-white/[0.03]" : "border-black/10 bg-white/85 shadow-xl")}>
                <div className="flex items-center justify-between px-5 pt-4">
                  <div className={cn("font-mono2 text-[11px] font-bold tracking-[0.22em]", dark ? "text-white/45" : "text-black/45")}>
                    {fix ? (isDemo ? `DEMO · ${demoLabel?.toUpperCase()}` : "LIVE FIX") : "ACQUIRING FIX"}
                  </div>
                  <div className="flex items-center gap-2">
                    {fix?.accuracyMeters != null && (
                      <span className={cn("rounded-full px-2.5 py-1 font-mono2 text-[10.5px] font-bold", dark ? "bg-white/10 text-white/70" : "bg-black/[0.06] text-black/60")}>±{Math.round(fix.accuracyMeters)}m</span>
                    )}
                    <button
                      onClick={() => fix && runSearch(fix.lat, fix.lon, { force: true })}
                      title="Refresh search"
                      className={cn("flex h-8 w-8 items-center justify-center rounded-full border transition-all hover:rotate-90", dark ? "border-white/15 text-white/70 hover:bg-white/10" : "border-black/10 text-black/60 hover:bg-black/5")}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", searching && "animate-spin")} />
                    </button>
                  </div>
                </div>

                <div className="px-5 pt-2">
                  <CompassDial
                    heading={heading}
                    bearing={focusTarget?.bearingDegrees ?? null}
                    dark={dark}
                    aligned={aligned}
                    locating={!fix || (searching && !focusTarget)}
                  />
                </div>

                {/* distance — largest text after compass */}
                <div className="px-6 pb-2 pt-4 text-center">
                  {phase === "LOCATING" || (phase === "CHECK_PERMISSION" && !fix) ? (
                    <div>
                      <div className={cn("font-mono2 text-5xl font-extrabold tabular-nums", dark ? "text-white/90" : "text-black/90")}>
                        <span className="animate-pulse">···</span>
                      </div>
                      <div className={cn("mt-2 font-mono2 text-[11px] tracking-[0.24em]", dark ? "text-white/40" : "text-black/45")}>LOCATING…</div>
                    </div>
                  ) : phase === "SEARCHING" || phase === "EXPAND_RADIUS" ? (
                    <div>
                      <div className={cn("font-mono2 text-5xl font-extrabold tabular-nums", dark ? "text-white/90" : "text-black/90")}>
                        <span className="animate-pulse">···</span>
                      </div>
                      <div className={cn("mt-2 font-mono2 text-[11px] tracking-[0.24em]", dark ? "text-emerald-200/80" : "text-emerald-900/70")}>{tierNote?.toUpperCase() ?? "SEARCHING OSM…"}</div>
                      <TierDots tiers={tiersTried} dark={dark} />
                    </div>
                  ) : focusTarget ? (
                    <div>
                      <div className={cn("font-mono2 text-[56px] font-extrabold leading-none tabular-nums tracking-tight", dark ? "text-white" : "text-black")}>
                        {formatMiles(focusTarget.distanceMeters)}
                      </div>
                      <div className={cn("mt-2 flex items-center justify-center gap-2 font-mono2 text-[11px] font-bold tracking-[0.22em]", dark ? "text-white/45" : "text-black/50")}>
                        <span>STRAIGHT-LINE</span><span>·</span>
                        <span className={dark ? "text-emerald-300" : "text-emerald-800"}>{cardinalFromBearing(focusTarget.bearingDegrees)} {Math.round(focusTarget.bearingDegrees)}°</span>
                        {aligned && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] text-white">ON COURSE</span>}
                      </div>
                      {rel != null && heading == null && (
                        <div className={cn("mt-1 text-xs", dark ? "text-amber-200/80" : "text-amber-800")}>Heading unavailable — showing distance + map.</div>
                      )}
                    </div>
                  ) : (
                    <NoResultBlock dark={dark} error={searchError} tiers={tiersTried} onRetry={() => fix && runSearch(fix.lat, fix.lon, { force: true })} onDemo={() => useDemo(39.7392, -104.9903, "Denver, CO")} />
                  )}
                </div>

                {/* destination card */}
                {focusTarget && (
                  <div className="px-5 pb-5">
                    <div className={cn("mt-3 rounded-3xl border p-5", dark ? "border-white/10 bg-black/30" : "border-black/10 bg-[#f4efe2]")}>
                      <div className={cn("font-mono2 text-[10.5px] font-bold tracking-[0.24em]", dark ? "text-emerald-300" : "text-emerald-900")}>NEAREST DISPENSARY</div>
                      <h2 className="font-display mt-1.5 text-[26px] font-black leading-tight tracking-tight">{displayName(focusTarget)}</h2>
                      {focusTarget.address && (
                        <div className={cn("mt-1 flex items-center gap-1.5 text-[13.5px] font-medium", dark ? "text-white/60" : "text-black/60")}>
                          <MapPin className="h-3.5 w-3.5 shrink-0" />{focusTarget.address}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {status.open === true && <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-extrabold tracking-wide text-white">● {status.label}</span>}
                        {status.open === false && <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-wide", dark ? "bg-white/10 text-white/70" : "bg-black/10 text-black/70")}>{status.label}</span>}
                        {status.open == null && focusTarget.openingHours && <span className={cn("rounded-full px-2.5 py-1 font-mono2 text-[10.5px]", dark ? "bg-white/10 text-white/60" : "bg-black/[0.07] text-black/60")}>{focusTarget.openingHours}</span>}
                        {focusTarget.recreational && <Tag dark={dark}>Recreational</Tag>}
                        {focusTarget.medical && <Tag dark={dark}>Medical</Tag>}
                        {focusTarget.cbd && <Tag dark={dark}>CBD</Tag>}
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button onClick={() => setView("map")} className={cn("inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[13px] font-extrabold tracking-wide transition-transform hover:-translate-y-0.5", dark ? "bg-emerald-400 text-emerald-950" : "bg-emerald-800 text-white")}>
                          <MapIcon className="h-4 w-4" /> VIEW MAP
                        </button>
                        <a href={directionsUrl} target="_blank" rel="noreferrer" onClick={() => trackMerchantEvent(focusTarget, "directions_click")} className={cn("inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-[13px] font-extrabold tracking-wide", dark ? "border-white/15 text-white hover:bg-white/10" : "border-black/15 text-black hover:bg-black/5")}>
                          <Navigation className="h-4 w-4" /> DIRECTIONS
                        </a>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        {merchantClaimsAvailable ? (
                          <button
                            onClick={() => { trackMerchantEvent(focusTarget, "claim_click"); setClaimTarget(focusTarget); }}
                            className={cn("text-left text-xs font-bold underline decoration-dotted underline-offset-4", dark ? "text-emerald-300/80 hover:text-emerald-200" : "text-emerald-800/80 hover:text-emerald-900")}
                          >
                            Own or manage this location? Claim it
                          </button>
                        ) : <span />}
                        {focusTarget.phone && (
                          <a
                            href={`tel:${focusTarget.phone}`}
                            onClick={() => trackMerchantEvent(focusTarget, "call_click")}
                            className={cn("text-xs font-bold", dark ? "text-white/60 hover:text-white" : "text-black/55 hover:text-black")}
                          >
                            Call
                          </a>
                        )}
                      </div>
                      <div className={cn("mt-3 flex items-center justify-between font-mono2 text-[10.5px]", dark ? "text-white/35" : "text-black/40")}>
                        <span>{focusTarget.osmType}/{focusTarget.osmId}</span>
                        {meta && <span>refreshed {roughAge(Date.now() - meta.at)}{staleOffline ? " · cached" : ""}</span>}
                      </div>
                    </div>

                    {/* compass enable / manual */}
                    <div className={cn("mt-3 rounded-3xl border p-4", dark ? "border-white/10 bg-white/[0.02]" : "border-black/10 bg-white")}>
                      <div className="flex items-center justify-between gap-2">
                        <div className={cn("font-mono2 text-[10.5px] font-bold tracking-[0.2em]", dark ? "text-white/45" : "text-black/50")}>HEADING SOURCE</div>
                        {heading != null
                          ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/15 px-2 py-0.5 font-mono2 text-[10.5px] font-bold text-emerald-600 dark:text-emerald-300"><Check className="h-3 w-3" /> LIVE {Math.round(heading)}°</span>
                          : <span className={cn("font-mono2 text-[10.5px]", dark ? "text-white/40" : "text-black/45")}>no sensor yet</span>}
                      </div>
                      {!headingSupported && (
                        <div className={cn("mb-2 text-xs", dark ? "text-white/40" : "text-black/50")}>No magnetometer detected on this device — manual + simulate still work, distance & map unaffected.</div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={enableCompassSensor} className={cn("inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold", dark ? "bg-white/10 text-white hover:bg-white/15" : "bg-black/[0.06] text-black hover:bg-black/10")}>
                          <Crosshair className="h-3.5 w-3.5" /> Enable motion compass
                        </button>
                        <button onClick={() => setSimulate((s) => !s)} className={cn("inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold", simulate ? "bg-emerald-600 text-white" : (dark ? "bg-white/10 text-white/70 hover:bg-white/15" : "bg-black/[0.06] text-black/70 hover:bg-black/10"))}>
                          <RotateCcw className="h-3.5 w-3.5" /> {simulate ? "Spinning… tap to stop" : "Simulate rotation"}
                        </button>
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <span className={cn("font-mono2 text-[10px]", dark ? "text-white/35" : "text-black/40")}>MANUAL</span>
                        <input type="range" min={0} max={359} value={Math.round(heading ?? manualHeading)} onChange={(e) => nudgeManual(parseInt(e.target.value, 10))} className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-rose-500 accent-emerald-600" />
                        <span className={cn("w-12 text-right font-mono2 text-xs font-bold tabular-nums", dark ? "text-white/70" : "text-black/70")}>{Math.round(heading ?? manualHeading)}°</span>
                      </div>
                      {headingDenied && <div className="mt-2 text-xs text-rose-500">Motion permission denied — use manual slider or simulate.</div>}
                    </div>
                  </div>
                )}

                <div className={cn("border-t px-5 py-2.5 font-mono2 text-[10px] tracking-wide", dark ? "border-white/10 text-white/30" : "border-black/10 text-black/40")}>
                  © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · {tierNote ?? (lastEndpoint ? `via ${new URL(lastEndpoint).hostname}` : "Overpass API")} · straight-line mi
                </div>
              </section>
            </div>

            {/* RIGHT — desktop always, mobile tabbed */}
            <div className={cn("min-w-0", view === "compass" && "hidden lg:block")}>
              {/* desktop tab bar */}
              <div className={cn("mb-4 hidden items-center gap-1 rounded-2xl border p-1.5 lg:flex", dark ? "border-white/10 bg-white/[0.04]" : "border-black/10 bg-white/80 shadow-sm")}>
                {([["map", MapIcon, "Map"], ["nearby", ListFilter, `Nearby${livePois.length ? ` · ${livePois.length}` : ""}`], ["settings", SettingsIcon, "Settings"]] as [View, typeof MapIcon, string][]).map(([v, Icon, label]) => (
                  <button key={v} onClick={() => setView(v === view ? "compass" : v)} className={cn("flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-bold transition-all", (view === v || (view === "compass" && v === "map")) ? (dark ? "bg-emerald-400 text-emerald-950 shadow" : "bg-emerald-800 text-white shadow") : (dark ? "text-white/55 hover:text-white" : "text-black/55 hover:text-black"))}>
                    <Icon className="h-4 w-4" />{label}
                  </button>
                ))}
                <button onClick={() => { setPerm("UNKNOWN"); setFix(null); didAuto.current = false; requestLocation(); }} className={cn("flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-bold", dark ? "text-white/55 hover:text-white" : "text-black/55 hover:text-black")}>
                  <LocateFixed className="h-4 w-4" /> Relocate
                </button>
              </div>

              {(view === "map" || view === "compass") && (
                <section className={cn("overflow-hidden rounded-[1.75rem] border", dark ? "border-white/10 bg-white/[0.03]" : "border-black/10 bg-white/85 shadow-xl")}>
                  <div className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <button onClick={() => setView("compass")} className={cn("inline-flex items-center gap-1.5 text-[13px] font-extrabold tracking-wide lg:hidden", dark ? "text-white/80" : "text-black/75")}>
                      ‹ COMPASS
                    </button>
                    <div className={cn("hidden items-center gap-2 font-mono2 text-[11px] font-bold tracking-[0.2em] lg:flex", dark ? "text-white/45" : "text-black/50")}>
                      <MapIcon className="h-3.5 w-3.5" /> OSM MAP {focusTarget && <span className={dark ? "text-emerald-300" : "text-emerald-800"}>· {formatMiles(focusTarget.distanceMeters)}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {focusTarget && (
                        <a href={directionsUrl} target="_blank" rel="noreferrer" onClick={() => focusTarget && trackMerchantEvent(focusTarget, "directions_click")} className={cn("hidden items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-extrabold sm:inline-flex", dark ? "bg-emerald-400 text-emerald-950" : "bg-emerald-800 text-white")}>
                          <Navigation className="h-3.5 w-3.5" /> DIRECTIONS <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="h-[420px] w-full sm:h-[480px]">
                    <MapView
                      user={fix ? { lat: fix.lat, lon: fix.lon } : null}
                      nearest={focusTarget}
                      all={livePois}
                      dark={dark}
                      tiles={providers.tiles}
                      darkTiles={providers.darkTiles}
                      activeId={selectedId}
                      onSelect={(d) => setSelectedId(d.id)}
                    />
                  </div>
                  {focusTarget ? (
                    <div className="flex flex-col gap-1 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className={cn("border-white/10 text-sm", dark ? "border-white/10" : "border-black/10")}>
                        <div className="font-extrabold">{displayName(focusTarget)}</div>
                        <div className={cn("text-[13px]", dark ? "text-white/55" : "text-black/55")}>{focusTarget.address ?? `${focusTarget.latitude.toFixed(5)}, ${focusTarget.longitude.toFixed(5)}`}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <a href={osmUrl} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold", dark ? "border-white/15 text-white/75 hover:bg-white/10" : "border-black/15 text-black/70 hover:bg-black/5")}>
                          <Globe className="h-3.5 w-3.5" /> Open in OSM
                        </a>
                        {focusTarget.website && (
                          <a href={focusTarget.website} target="_blank" rel="noreferrer" onClick={() => trackMerchantEvent(focusTarget, "website_click")} className={cn("inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold", dark ? "border-white/15 text-white/75 hover:bg-white/10" : "border-black/15 text-black/70 hover:bg-black/5")}>
                            Website <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className={cn("border-t px-5 py-4 text-sm", dark ? "border-white/10 text-white/50" : "border-black/10 text-black/55")}>No destination yet — grant location and search.</div>
                  )}
                  <div className={cn("border-t px-5 py-2.5 font-mono2 text-[10px]", dark ? "border-white/10 text-white/30" : "border-black/10 text-black/40")}>
                    © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · tiles: {(() => { try { return new URL(dark ? providers.darkTiles : providers.tiles).hostname; } catch { return "custom"; } })()} · map failure never breaks compass mode
                  </div>
                </section>
              )}

              {view === "nearby" && (
                <section className={cn("overflow-hidden rounded-[1.75rem] border", dark ? "border-white/10 bg-white/[0.03]" : "border-black/10 bg-white/85 shadow-xl")}>
                  <div className="flex items-center justify-between px-5 py-4">
                    <div>
                      <div className={cn("font-mono2 text-[10.5px] font-bold tracking-[0.24em]", dark ? "text-white/40" : "text-black/45")}>RANKED BY HAVERSINE DISTANCE</div>
                      <h3 className="font-display text-2xl font-black tracking-tight">Nearby · {livePois.length}</h3>
                    </div>
                    <button onClick={() => fix && runSearch(fix.lat, fix.lon, { force: true })} className={cn("inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold", dark ? "border-white/15 text-white/75 hover:bg-white/10" : "border-black/15 text-black/70 hover:bg-black/5")}>
                      <RefreshCw className={cn("h-3.5 w-3.5", searching && "animate-spin")} /> Rescan
                    </button>
                  </div>
                  {livePois.length === 0 ? (
                    <div className="px-5 pb-6"><NoResultBlock dark={dark} error={searchError} tiers={tiersTried} onRetry={() => fix && runSearch(fix.lat, fix.lon, { force: true })} onDemo={() => useDemo(39.7392, -104.9903, "Denver, CO")} /></div>
                  ) : (
                    <ul className="nice-scroll max-h-[560px] space-y-2 overflow-y-auto px-4 pb-4">
                      {livePois.slice(0, 40).map((d, i) => {
                        const r = heading != null ? normalize360(d.bearingDegrees - heading) : null;
                        const active = (selectedId ?? nearest?.id) === d.id;
                        return (
                          <li key={d.id}>
                            <button
                              onClick={() => { setSelectedId(d.id); }}
                              className={cn("flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all hover:-translate-y-px", active ? (dark ? "border-emerald-300/40 bg-emerald-300/10" : "border-emerald-700/40 bg-emerald-50") : (dark ? "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]" : "border-black/10 bg-white hover:shadow-md"))}
                            >
                              <span className={cn("font-mono2 text-[11px] font-bold tabular-nums", dark ? "text-white/35" : "text-black/40")}>{String(i + 1).padStart(2, "0")}</span>
                              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full border", dark ? "border-white/15 bg-black/40" : "border-black/10 bg-[#f4efe2]")}>
                                <Navigation className="h-4 w-4 text-emerald-600 dark:text-emerald-300" style={{ transform: `rotate(${r ?? d.bearingDegrees}deg)` }} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14px] font-extrabold">{i === 0 && "★ "}{displayName(d)}</span>
                                <span className={cn("block truncate text-xs", dark ? "text-white/50" : "text-black/55")}>{d.address ?? `${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}`} · {cardinalFromBearing(d.bearingDegrees)} {Math.round(d.bearingDegrees)}°</span>
                              </span>
                              <span className="text-right">
                                <span className="block font-mono2 text-[15px] font-extrabold tabular-nums">{formatMiles(d.distanceMeters)}</span>
                                <span className={cn("font-mono2 text-[10px]", dark ? "text-white/35" : "text-black/40")}>straight-line</span>
                              </span>
                              <ChevronRight className={cn("h-4 w-4 shrink-0", dark ? "text-white/30" : "text-black/30")} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className={cn("border-t px-5 py-2.5 font-mono2 text-[10px]", dark ? "border-white/10 text-white/30" : "border-black/10 text-black/40")}>
                    © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · never fabricate missing metadata
                  </div>
                </section>
              )}

              {view === "settings" && (
                <section className={cn("overflow-hidden rounded-[1.75rem] border", dark ? "border-white/10 bg-white/[0.03]" : "border-black/10 bg-white/85 shadow-xl")}>
                  <div className="px-5 py-4">
                    <div className={cn("font-mono2 text-[10.5px] font-bold tracking-[0.24em]", dark ? "text-white/40" : "text-black/45")}>PREFERENCES · PROVIDERS · PRIVACY</div>
                    <h3 className="font-display text-2xl font-black tracking-tight">Settings</h3>
                  </div>
                  <div className="space-y-4 px-5 pb-5">
                    {/* theme */}
                    <div className={cn("rounded-2xl border p-4", dark ? "border-white/10" : "border-black/10")}>
                      <div className="mb-3 flex items-center gap-2 text-sm font-extrabold"><Sun className="h-4 w-4" /> Appearance</div>
                      <div className="grid grid-cols-3 gap-2">
                        {([["light", Sun, "Day"], ["dark", Moon, "Night"], ["system", Monitor, "System"]] as [ThemeMode, typeof Sun, string][]).map(([m, Icon, label]) => (
                          <button key={m} onClick={() => setThemeMode(m)} className={cn("flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-bold", themeMode === m ? (dark ? "border-emerald-300/50 bg-emerald-300/15 text-emerald-200" : "border-emerald-800 bg-emerald-800 text-white") : (dark ? "border-white/10 text-white/60 hover:bg-white/5" : "border-black/10 text-black/60 hover:bg-black/[0.04]"))}>
                            <Icon className="h-4 w-4" />{label}
                          </button>
                        ))}
                      </div>
                      <p className={cn("mt-2 text-xs", dark ? "text-white/40" : "text-black/50")}>Persists locally. System follows your OS. Night mode renders the same keyless OSM source with a local low-light treatment.</p>
                    </div>

                    {/* location */}
                    <div className={cn("rounded-2xl border p-4", dark ? "border-white/10" : "border-black/10")}>
                      <div className="mb-1 flex items-center gap-2 text-sm font-extrabold"><LocateFixed className="h-4 w-4" /> Location</div>
                      <p className={cn("text-[13px]", dark ? "text-white/55" : "text-black/60")}>
                        {fix ? <>Fix {fix.lat.toFixed(5)}, {fix.lon.toFixed(5)}{fix.accuracyMeters != null && <> · ±{Math.round(fix.accuracyMeters)}m</>}{isDemo && <> · demo ({demoLabel})</>}.</> : "No fix yet."} Foreground only — no background tracking, no history retained.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={requestLocation} className={cn("rounded-xl px-3 py-2 text-xs font-bold", dark ? "bg-white/10 text-white hover:bg-white/15" : "bg-black/[0.06] text-black hover:bg-black/10")}>Re-request GPS</button>
                        <button onClick={() => { try { localStorage.removeItem(LS_POIS); localStorage.removeItem(LS_META); } catch { /* noop */ } setPois([]); setMeta(null); searchedCenter.current = null; }} className={cn("rounded-xl px-3 py-2 text-xs font-bold", dark ? "bg-white/10 text-white hover:bg-white/15" : "bg-black/[0.06] text-black hover:bg-black/10")}>Clear cached POIs</button>
                      </div>
                      <div className="mt-3">
                        <div className={cn("mb-2 font-mono2 text-[10.5px] font-bold tracking-[0.18em]", dark ? "text-white/40" : "text-black/45")}>DEMO LOCATIONS — NO GPS NEEDED</div>
                        <div className="flex flex-wrap gap-2">
                          {DEMOS.map((d) => (
                            <button key={d.label} onClick={() => { useDemo(d.lat, d.lon, d.label); setView("compass"); }} className={cn("rounded-full border px-3 py-1.5 text-xs font-bold", dark ? "border-white/15 text-white/70 hover:bg-white/10" : "border-black/15 text-black/65 hover:bg-black/5")}>{d.label}</button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* providers */}
                    <div className={cn("rounded-2xl border p-4", dark ? "border-white/10" : "border-black/10")}>
                      <div className="mb-1 flex items-center gap-2 text-sm font-extrabold"><Layers className="h-4 w-4" /> Map / POI providers</div>
                      <p className={cn("text-[13px]", dark ? "text-white/55" : "text-black/60")}>Endpoints are remote-configurable — swap infrastructure without touching core logic. Public OSM servers are best-effort: respect caching & attribution.</p>
                      <label className={cn("mt-3 block font-mono2 text-[10.5px] font-bold tracking-[0.16em]", dark ? "text-white/40" : "text-black/45")}>CONTROLLED COMPASS API (OPTIONAL · HTTPS)</label>
                      <input
                        value={providers.apiEndpoint ?? ""}
                        onChange={(e) => setProviders({ ...providers, apiEndpoint: e.target.value.trim() })}
                        placeholder="https://your-api.example/api/dispensaries"
                        spellCheck={false}
                        className={cn("mt-1 w-full rounded-xl border p-2.5 font-mono2 text-xs", dark ? "border-white/10 bg-black/40 text-white/80" : "border-black/10 bg-white text-black/80")}
                      />
                      <p className={cn("mt-1 text-[11px]", dark ? "text-white/35" : "text-black/45")}>When configured, COMPASS sends a coarse ~0.02° search center to this gateway first. Exact distance and bearing remain local. Public Overpass stays as continuity fallback.</p>
                      <label className={cn("mt-3 block font-mono2 text-[10.5px] font-bold tracking-[0.16em]", dark ? "text-white/40" : "text-black/45")}>POI ENDPOINTS (ONE PER LINE, FAILOVER ORDER)</label>
                      <textarea value={provDraft} onChange={(e) => setProvDraft(e.target.value)} rows={3} spellCheck={false} className={cn("mt-1 w-full rounded-xl border p-3 font-mono2 text-xs", dark ? "border-white/10 bg-black/40 text-emerald-100" : "border-black/10 bg-[#f7f3e8] text-emerald-950")} />
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className={cn("font-mono2 text-[10.5px] font-bold tracking-[0.16em]", dark ? "text-white/40" : "text-black/45")}>DAY TILES</span>
                          <input value={providers.tiles} onChange={(e) => setProviders({ ...providers, tiles: e.target.value })} spellCheck={false} className={cn("mt-1 w-full rounded-xl border p-2.5 font-mono2 text-xs", dark ? "border-white/10 bg-black/40 text-white/80" : "border-black/10 bg-white text-black/80")} />
                        </label>
                        <label className="block">
                          <span className={cn("font-mono2 text-[10.5px] font-bold tracking-[0.16em]", dark ? "text-white/40" : "text-black/45")}>NIGHT TILES</span>
                          <input value={providers.darkTiles} onChange={(e) => setProviders({ ...providers, darkTiles: e.target.value })} spellCheck={false} className={cn("mt-1 w-full rounded-xl border p-2.5 font-mono2 text-xs", dark ? "border-white/10 bg-black/40 text-white/80" : "border-black/10 bg-white text-black/80")} />
                        </label>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => setProviders({ ...providers, poiEndpoints: provDraft.split("\n").map((s) => s.trim()).filter(Boolean).length ? provDraft.split("\n").map((s) => s.trim()).filter(Boolean) : DEFAULT_PROVIDERS.poiEndpoints })} className={cn("rounded-xl px-4 py-2 text-xs font-extrabold", dark ? "bg-emerald-400 text-emerald-950" : "bg-emerald-800 text-white")}>Save endpoints</button>
                        <button onClick={() => setProviders(DEFAULT_PROVIDERS)} className={cn("rounded-xl border px-4 py-2 text-xs font-bold", dark ? "border-white/15 text-white/70" : "border-black/15 text-black/65")}>Reset defaults</button>
                      </div>
                    </div>

                    {/* diagnostics */}
                    <div className={cn("rounded-2xl border p-4 font-mono2 text-[11.5px] leading-relaxed", dark ? "border-white/10 bg-black/30 text-white/60" : "border-black/10 bg-[#f7f3e8] text-black/60")}>
                      <div className="mb-2 flex items-center gap-2 font-bold tracking-[0.18em]"><Info className="h-3.5 w-3.5" /> DIAGNOSTICS · STATE MACHINE</div>
                      BOOT → CHECK_PERMISSION → LOCATING → SEARCHING → EXPAND_RADIUS → DESTINATION_FOUND<br />
                      phase=<span className="font-bold text-emerald-600 dark:text-emerald-300">{phase}</span> · perm={perm} · fix={fix ? `${fix.lat.toFixed(4)},${fix.lon.toFixed(4)}` : "—"}<br />
                      heading={heading != null ? `${Math.round(heading)}°` : "unavailable"} · bearing={focusTarget ? `${Math.round(focusTarget.bearingDegrees)}°` : "—"} · rel={rel != null ? `${Math.round(rel)}°` : "—"}<br />
                      tiers=[{tiersTried.join(", ") || "—"}] · n={livePois.length} · cache={meta ? roughAge(Date.now() - meta.at) : "empty"} · ep={lastEndpoint ? (() => { try { return new URL(lastEndpoint).hostname; } catch { return lastEndpoint; } })() : "—"}
                      {locError && <><br />gps: {locError}</>}
                      {searchError && livePois.length === 0 && <><br />poi: {searchError}</>}
                    </div>

                    {/* privacy */}
                    <div className={cn("flex gap-3 rounded-2xl border p-4 text-[13px] leading-relaxed", dark ? "border-white/10 text-white/60" : "border-black/10 text-black/60")}>
                      <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
                      <div><strong>Privacy.</strong> No account · no analytics · no location history · no background tracking · no server profile. Stored locally: theme, cached POIs, last refresh, provider config. Legal-age users only · informational only — Compass does not sell cannabis, facilitate payment, or provide ordering.</div>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </main>
        )}

        {/* footer */}
        <footer className={cn("mt-6 flex flex-col items-center gap-2 text-center font-mono2 text-[10.5px] tracking-wide", dark ? "text-white/30" : "text-black/40")}>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><Footprints className="h-3 w-3" /> straight-line distance, not driving</span>
            <span>·</span>
            <span>© <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors</span>
            <span>·</span>
            <span>tile + Nominatim usage policies apply</span>
            <span>·</span>
            <a className="underline" href="./privacy.html">Privacy</a>
            <span>·</span>
            <a className="underline" href="./terms.html">Terms</a>
            <span>·</span>
            <a className="underline" href="./business.html">For businesses</a>
          </div>
          <div className="flex items-center gap-2">
            <Cannabis className="h-3.5 w-3.5" />
            <span>LEGAL AGE ONLY · KNOW YOUR LOCAL LAWS · DATA: shop=cannabis · CACHE 5 MIN / 300 M</span>
          </div>
        </footer>
      </div>

      {/* boot → auto permission nudge */}
      <BootGate perm={perm} fix={fix} onEnable={requestLocation} onDemo={() => useDemo(39.7392, -104.9903, "Denver, CO")} dark={dark} />
      {claimTarget && merchantClaimsAvailable && merchantApiOrigin && (
        <MerchantClaimModal
          dark={dark}
          target={claimTarget}
          apiOrigin={merchantApiOrigin}
          onClose={() => setClaimTarget(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------- subcomponents ------------------------------ */

function Tag({ children, dark }: { children: React.ReactNode; dark: boolean }) {
  return (
    <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold", dark ? "border-white/15 text-white/70" : "border-black/15 text-black/65")}>{children}</span>
  );
}

function TierDots({ tiers, dark }: { tiers: number[]; dark: boolean }) {
  return (
    <div className="mt-3 flex items-center justify-center gap-2">
      {SEARCH_RADII_MILES.map((m) => {
        const done = tiers.includes(m);
        return (
          <span key={m} className={cn("rounded-full px-2.5 py-1 font-mono2 text-[10.5px] font-bold", done ? "bg-emerald-600 text-white" : (dark ? "bg-white/10 text-white/40" : "bg-black/[0.07] text-black/40"))}>
            {m} mi{done ? " ✓" : ""}
          </span>
        );
      })}
    </div>
  );
}

function NoResultBlock({ dark, error, tiers, onRetry, onDemo }: { dark: boolean; error: string | null; tiers: number[]; onRetry: () => void; onDemo: () => void }) {
  return (
    <div className={cn("rounded-3xl border p-6 text-center", dark ? "border-white/10 bg-black/30" : "border-black/10 bg-[#f4efe2]")}>
      <div className={cn("mx-auto flex h-12 w-12 items-center justify-center rounded-2xl", dark ? "bg-white/10" : "bg-black/[0.06]")}>
        <MapPin className={cn("h-6 w-6", dark ? "text-white/60" : "text-black/50")} />
      </div>
      <h3 className="font-display mt-3 text-2xl font-black">No dispensaries nearby</h3>
      <p className={cn("mx-auto mt-1 max-w-xs text-[13px]", dark ? "text-white/55" : "text-black/55")}>
        {error ?? `Searched ${tiers.length ? tiers.join(" → ") + " mi" : "up to 50 mi"} for shop=cannabis and came up empty. Coverage varies — OSM tagging is community-built.`}
      </p>
      <TierDots tiers={tiers} dark={dark} />
      <div className="mt-4 flex justify-center gap-2">
        <button onClick={onRetry} className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold", dark ? "bg-emerald-400 text-emerald-950" : "bg-emerald-800 text-white")}>
          <RefreshCw className="h-3.5 w-3.5" /> RETRY
        </button>
        <button onClick={onDemo} className={cn("rounded-xl border px-4 py-2.5 text-xs font-bold", dark ? "border-white/15 text-white/75" : "border-black/15 text-black/70")}>Demo · Denver</button>
      </div>
    </div>
  );
}

function DemoStrip({ dark, onDemo }: { dark: boolean; onDemo: (lat: number, lon: number, label: string) => void }) {
  return (
    <div className={cn("flex items-center gap-3 overflow-x-auto border-t px-5 py-3", dark ? "border-white/10" : "border-black/10")}>
      <span className={cn("shrink-0 font-mono2 text-[10.5px] font-bold tracking-[0.18em]", dark ? "text-white/35" : "text-black/40")}>NO GPS? TRY</span>
      {DEMOS.slice(0, 4).map((d) => (
        <button key={d.label} onClick={() => onDemo(d.lat, d.lon, d.label)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold", dark ? "border-white/15 text-white/70 hover:bg-white/10" : "border-black/15 text-black/65 hover:bg-black/5")}>
          {d.label}
        </button>
      ))}
    </div>
  );
}

function BootGate({ perm, fix, onEnable, onDemo, dark }: { perm: PermState; fix: UserFix | null; onEnable: () => void; onDemo: () => void; dark: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try { if (sessionStorage.getItem("compass:boot") === "1") setDismissed(true); } catch { /* noop */ }
  }, []);
  if (dismissed || perm !== "UNKNOWN" || fix) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 backdrop-blur-sm sm:items-center">
      <div className={cn("w-full max-w-md overflow-hidden rounded-[1.75rem] border shadow-2xl", dark ? "border-white/10 bg-[#141614]" : "border-black/10 bg-[#faf7ef]")}>
        <div className="h-1 w-full bg-gradient-to-r from-emerald-700 via-emerald-500 to-rose-600" />
        <div className="p-6">
          <div className="flex items-start justify-between">
            <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", dark ? "bg-emerald-400 text-emerald-950" : "bg-emerald-800 text-white")}>
              <CompassIcon className="h-5 w-5" />
            </div>
            <button onClick={() => { setDismissed(true); try { sessionStorage.setItem("compass:boot", "1"); } catch { /* noop */ } }} className={cn("flex h-8 w-8 items-center justify-center rounded-full", dark ? "text-white/40 hover:bg-white/10" : "text-black/40 hover:bg-black/5")}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <h2 className="font-display mt-4 text-3xl font-black leading-none tracking-tight">Open →<br />locate → point.</h2>
          <p className={cn("mt-3 text-sm leading-relaxed", dark ? "text-white/60" : "text-black/60")}>
            Compass points to the nearest legal dispensary using OpenStreetMap <span className="font-mono2 text-[12.5px]">shop=cannabis</span> data. Grant foreground location to begin.
          </p>
          <button onClick={() => { onEnable(); setDismissed(true); try { sessionStorage.setItem("compass:boot", "1"); } catch { /* noop */ } }} className={cn("mt-5 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-extrabold", dark ? "bg-emerald-400 text-emerald-950" : "bg-emerald-800 text-white")}>
            <LocateFixed className="h-4 w-4" /> GRANT LOCATION & START
          </button>
          <button onClick={() => { onDemo(); setDismissed(true); try { sessionStorage.setItem("compass:boot", "1"); } catch { /* noop */ } }} className={cn("mt-2 w-full rounded-2xl border px-5 py-3 text-[13px] font-bold", dark ? "border-white/15 text-white/75" : "border-black/15 text-black/70")}>
            Explore demo · Denver, no GPS
          </button>
          <p className={cn("mt-3 text-center font-mono2 text-[10px]", dark ? "text-white/30" : "text-black/40")}>LEGAL AGE ONLY · INFORMATIONAL ONLY · © OpenStreetMap CONTRIBUTORS</p>
        </div>
      </div>
    </div>
  );
}
