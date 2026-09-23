import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Dispensary } from "../lib/geo";

interface Props {
  user: { lat: number; lon: number } | null;
  nearest: Dispensary | null;
  all: Dispensary[];
  dark: boolean;
  tiles: string;
  darkTiles: string;
  activeId?: string | null;
  onSelect?: (d: Dispensary) => void;
}

// Fix default icon paths (we use divIcons only, but prevent 404 throws)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;

export default function MapView({ user, nearest, all, dark, tiles, darkTiles, activeId, onSelect }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  // init map once
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
    }).setView(
      user ? [user.lat, user.lon] : nearest ? [nearest.latitude, nearest.longitude] : [39.7392, -104.9903],
      13
    );
    L.control.attribution({ prefix: false }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // tiles
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    const url = dark ? darkTiles : tiles;
    const layer = L.tileLayer(url, {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
    });
    layer.addTo(map);
    layerRef.current = layer;
    // dark filter tweak for OSM standard in dark mode if carto fails — keep native dark tiles
    const container = map.getContainer();
    container.style.background = dark ? "#0e100e" : "#e8e4d8";
  }, [dark, tiles, darkTiles]);

  // markers + bounds
  useEffect(() => {
    const map = mapRef.current;
    const group = markersRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    if (user) {
      const pulse = L.divIcon({
        className: "",
        html: `<div style="position:relative;width:28px;height:28px">
          <div style="position:absolute;inset:0;border-radius:9999px;background:rgba(59,130,246,0.25);animation:ping 1.8s cubic-bezier(0,0,.2,1) infinite"></div>
          <div style="position:absolute;inset:6px;border-radius:9999px;background:#3b82f6;border:3px solid white;box-shadow:0 4px 14px rgba(0,0,0,.4)"></div>
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const m = L.marker([user.lat, user.lon], { icon: pulse, zIndexOffset: 100 }).bindTooltip("YOU", {
        permanent: false,
        direction: "top",
      });
      m.addTo(group);
      bounds.push([user.lat, user.lon]);
    }

    all.slice(0, 60).forEach((d) => {
      const isNearest = nearest?.id === d.id;
      const isActive = activeId === d.id;
      const size = isNearest ? 34 : 26;
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${isNearest ? 16 : 13}px;color:white;background:${isNearest ? "linear-gradient(135deg,#059669,#10b981)" : dark ? "#233026" : "#ffffff"};border:${isNearest ? "2px solid white" : isActive ? "2px solid #10b981" : dark ? "1.5px solid rgba(255,255,255,.25)" : "1.5px solid rgba(0,0,0,.25)"};box-shadow:0 8px 20px rgba(0,0,0,.35);${isNearest ? "" : `color:${dark ? "#a7f3d0" : "#0d5c43"};`}">${isNearest ? "★" : "◈"}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const mk = L.marker([d.latitude, d.longitude], { icon, title: d.name ?? "Cannabis dispensary" });
      mk.on("click", () => onSelect?.(d));
      mk.bindTooltip(d.name ?? "Cannabis dispensary", { direction: "top", offset: [0, -14] });
      mk.addTo(group);
    });
    all.forEach((d) => bounds.push([d.latitude, d.longitude]));

    // line user → nearest
    if (user && nearest) {
      const line = L.polyline(
        [
          [user.lat, user.lon],
          [nearest.latitude, nearest.longitude],
        ],
        { color: dark ? "#34d399" : "#0d5c43", weight: 2.5, dashArray: "7 8", opacity: 0.85 }
      );
      line.addTo(group);
    }

    if (bounds.length >= 2) {
      try {
        map.flyToBounds(L.latLngBounds(bounds as unknown as L.LatLngTuple[]), { padding: [44, 44], maxZoom: 14, duration: 0.9 });
      } catch { /* noop */ }
    } else if (bounds.length === 1) {
      map.flyTo(bounds[0] as L.LatLngExpression, 14, { duration: 0.9 });
    }
  }, [user, all, nearest, dark, activeId, onSelect]);

  // invalidate size after mount (tab switches)
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 350);
    return () => clearTimeout(t);
  }, [dark]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={elRef} className="absolute inset-0 z-0" style={{ minHeight: 320 }} />
      <style>{`
        .leaflet-container { font-family: inherit; }
        .leaflet-control-attribution { font-size: 10px !important; background: rgba(255,255,255,.75) !important; padding: 1px 6px !important; border-radius: 8px 0 0 0 !important; }
        .dark .leaflet-control-attribution { background: rgba(0,0,0,.6) !important; color: #9aa79b !important; }
        .dark .leaflet-control-attribution a { color: #6ee7b7 !important; }
        .leaflet-control-zoom { border: none !important; box-shadow: 0 8px 24px rgba(0,0,0,.25) !important; border-radius: 12px !important; overflow: hidden; }
        .leaflet-control-zoom a { border: none !important; width: 34px !important; height: 34px !important; line-height: 34px !important; }
        @keyframes ping { 0% { transform: scale(1); opacity: .9 } 80%, 100% { transform: scale(2.1); opacity: 0 } }
      `}</style>
    </div>
  );
}
