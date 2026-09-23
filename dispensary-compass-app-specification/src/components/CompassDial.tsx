import { useMemo } from "react";
import { normalize360 } from "../lib/geo";

interface Props {
  heading: number | null; // device heading, smoothed
  bearing: number | null; // destination bearing
  dark: boolean;
  aligned: boolean;
  locating?: boolean;
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export default function CompassDial({ heading, bearing, dark, aligned, locating }: Props) {
  const h = heading ?? 0;
  const rel = bearing != null ? normalize360(bearing - (heading ?? bearing)) : 0;

  const ticks = useMemo(() => {
    const arr: { deg: number; major: boolean; mid: boolean }[] = [];
    for (let d = 0; d < 360; d += 3) {
      arr.push({ deg: d, major: d % 90 === 0, mid: d % 30 === 0 });
    }
    return arr;
  }, []);

  const cardinals = [
    { l: "N", d: 0 },
    { l: "E", d: 90 },
    { l: "S", d: 180 },
    { l: "W", d: 270 },
  ];
  const inter = [
    { l: "NE", d: 45 },
    { l: "SE", d: 135 },
    { l: "SW", d: 225 },
    { l: "NW", d: 315 },
  ];

  const ring = dark ? "rgba(232,238,230,0.16)" : "rgba(28,32,26,0.14)";
  const ringMajor = dark ? "rgba(232,238,230,0.55)" : "rgba(28,32,26,0.6)";
  const textSoft = dark ? "#9aa79b" : "#6b7268";
  const textMain = dark ? "#eef3ec" : "#161a15";

  return (
    <div className="relative mx-auto w-full max-w-[360px] select-none">
      <div
        className={`relative aspect-square w-full overflow-hidden rounded-[2rem] border transition-colors duration-500 ${
          dark
            ? "border-white/10 bg-[#171917] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.08)]"
            : "border-black/10 bg-[#fbf8ef] shadow-[0_30px_70px_-25px_rgba(60,55,30,0.35),inset_0_1px_0_rgba(255,255,255,0.9)]"
        }`}
      >
        {/* topographic rings */}
        <svg className="absolute inset-0 h-full w-full opacity-[0.5]" viewBox="0 0 360 360">
          {[150, 128, 106].map((r) => (
            <circle
              key={r}
              cx="180"
              cy="180"
              r={r}
              fill="none"
              stroke={dark ? "rgba(255,255,255,0.05)" : "rgba(30,35,25,0.06)"}
              strokeWidth="1"
              strokeDasharray={r === 128 ? "2 6" : undefined}
            />
          ))}
        </svg>

        {/* alignment glow */}
        <div
          className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${
            aligned ? "opacity-100" : "opacity-0"
          }`}
          style={{
            background: dark
              ? "radial-gradient(circle at 50% 38%, rgba(52,211,153,0.22), transparent 62%)"
              : "radial-gradient(circle at 50% 38%, rgba(16,122,87,0.16), transparent 62%)",
          }}
        />

        {/* heading-up rose */}
        <svg viewBox="0 0 360 360" className="absolute inset-0 h-full w-full">
          <g
            style={{
              transformOrigin: "180px 180px",
              transform: `rotate(${-h}deg)`,
              transition: "transform 120ms linear",
            }}
          >
            {ticks.map((t) => {
              const p1 = polar(180, 180, t.major ? 158 : t.mid ? 158 : 162, t.deg);
              const p2 = polar(180, 180, t.major ? 138 : t.mid ? 146 : 154, t.deg);
              return (
                <line
                  key={t.deg}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={t.major ? "#e11d48" : t.mid ? ringMajor : ring}
                  strokeWidth={t.major ? 3 : t.mid ? 2 : 1}
                  strokeLinecap="round"
                  opacity={t.deg === 0 ? 1 : 0.9}
                />
              );
            })}
            {cardinals.map((c) => {
              const p = polar(180, 180, 118, c.d);
              return (
                <text
                  key={c.l}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={c.l === "N" ? 26 : 20}
                  fontWeight={800}
                  fill={c.l === "N" ? "#e11d48" : textMain}
                  style={{ transformOrigin: `${p.x}px ${p.y}px`, transform: `rotate(${h}deg)` } as never}
                  letterSpacing="0.08em"
                >
                  {c.l}
                </text>
              );
            })}
            {inter.map((c) => {
              const p = polar(180, 180, 122, c.d);
              return (
                <text
                  key={c.l}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={700}
                  fill={textSoft}
                  letterSpacing="0.14em"
                >
                  {c.l}
                </text>
              );
            })}
            {/* degree dots for N */}
            {(() => {
              const p = polar(180, 180, 96, 0);
              return <circle cx={p.x} cy={p.y} r={3.5} fill="#e11d48" />;
            })()}
          </g>

          {/* fixed lubber line */}
          <g>
            <polygon points="180,12 174,26 186,26" fill={dark ? "#eef3ec" : "#161a15"} opacity={0.9} />
          </g>

          {/* destination needle — rotates by relative angle */}
          {bearing != null && !locating && (
            <g
              style={{
                transformOrigin: "180px 180px",
                transform: `rotate(${rel}deg)`,
                transition: "transform 140ms linear",
                filter: aligned
                  ? "drop-shadow(0 0 10px rgba(52,211,153,0.9))"
                  : "drop-shadow(0 6px 14px rgba(0,0,0,0.35))",
              }}
            >
              {/* shaft */}
              <line x1="180" y1="180" x2="180" y2="76" stroke={aligned ? "#34d399" : "#107a57"} strokeWidth={7} strokeLinecap="round" />
              <line x1="180" y1="180" x2="180" y2="76" stroke="rgba(255,255,255,0.55)" strokeWidth={2} strokeLinecap="round" strokeDasharray="1 7" />
              {/* arrowhead */}
              <polygon points="180,52 166,80 180,73 194,80" fill={aligned ? "#34d399" : "#0d5c43"} stroke={dark ? "#0b0f0d" : "#ffffff"} strokeWidth={1.5} />
              {/* tail */}
              <line x1="180" y1="180" x2="180" y2="226" stroke={dark ? "rgba(255,255,255,0.35)" : "rgba(20,25,20,0.35)"} strokeWidth={5} strokeLinecap="round" />
              <circle cx="180" cy="228" r={4} fill={dark ? "rgba(255,255,255,0.35)" : "rgba(20,25,20,0.35)"} />
            </g>
          )}

          {/* center hub */}
          <g>
            <circle cx="180" cy="180" r={30} fill={dark ? "#101210" : "#ffffff"} stroke={dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)"} strokeWidth={1.5} />
            <circle cx="180" cy="180" r={22} fill="none" stroke={aligned ? "#34d399" : dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)"} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.9} />
            <circle cx="180" cy="180" r={7} fill={aligned ? "#34d399" : "#e11d48"} stroke={dark ? "#0b0f0d" : "#fff"} strokeWidth={2} />
          </g>
        </svg>

        {/* scanning sweep when locating */}
        {locating && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="h-[78%] w-[78%] rounded-full opacity-60"
              style={{
                background: `conic-gradient(from 0deg, transparent 0deg, ${
                  dark ? "rgba(52,211,153,0.35)" : "rgba(16,122,87,0.25)"
                } 60deg, transparent 90deg)`,
                animation: "compass-sweep 1.6s linear infinite",
              }}
            />
          </div>
        )}

        {/* bottom readout strip */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-5 pb-4">
          <div
            className={`rounded-full px-3 py-1 font-mono text-[11px] font-bold tracking-[0.18em] ${
              dark ? "bg-white/10 text-emerald-200" : "bg-black/[0.06] text-emerald-900"
            }`}
          >
            {heading == null ? "–––°" : `${String(Math.round(normalize360(h))).padStart(3, "0")}°`}
          </div>
          <div
            className={`rounded-full px-3 py-1 font-mono text-[11px] font-bold tracking-[0.18em] ${
              dark ? "bg-white/10 text-white/80" : "bg-black/[0.06] text-black/70"
            }`}
          >
            {bearing == null ? "NO FIX" : `BRG ${String(Math.round(bearing)).padStart(3, "0")}°`}
          </div>
        </div>
      </div>
    </div>
  );
}
