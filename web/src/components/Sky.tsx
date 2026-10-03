// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useMemo } from "react";

/** Deterministic pseudo random, so the sky is the same on every render and in screenshots. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Night sky in dark mode, a warm dusk with drifting clouds in light mode. */
export function Sky({ stars = 70, moon = true, seed = 7 }: { stars?: number; moon?: boolean; seed?: number }) {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const moonY = useTransform(scrollY, [0, 600], [0, reduce ? 0 : 60]);
  const pts = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: stars }, () => ({
      x: r() * 100,
      y: r() * 72,
      d: 2.5 + r() * 4,
      delay: -r() * 6,
      big: r() > 0.88,
    }));
  }, [stars, seed]);
  const clouds = useMemo(() => {
    const r = rng(seed + 3);
    return Array.from({ length: 4 }, (_, i) => ({ y: 10 + i * 14 + r() * 6, w: 120 + r() * 160, d: 70 + r() * 50, delay: -r() * 90 }));
  }, [seed]);
  return (
    <div className="sky" aria-hidden>
      {pts.map((p, i) => (
        <span key={i} className={`star ${p.big ? "big" : ""}`} style={{ left: `${p.x}%`, top: `${p.y}%`, ["--d" as string]: `${p.d}s`, ["--delay" as string]: `${p.delay}s` }} />
      ))}
      {clouds.map((c, i) => (
        <span key={`c${i}`} className="cloud" style={{ top: `${c.y}%`, width: c.w, ["--d" as string]: `${c.d}s`, ["--delay" as string]: `${c.delay}s` }} />
      ))}
      <span className="shoot" style={{ top: "12%", right: "22%" }} />
      {moon && (
        <motion.div className="moon" style={{ y: moonY }}>
          <Moon />
        </motion.div>
      )}
    </div>
  );
}

export function Moon() {
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%">
      <defs>
        <radialGradient id="mglow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--acc-2)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--acc-2)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="mface" cx="40%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#fff6dc" />
          <stop offset="100%" stopColor="#f2cd7e" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="58" fill="url(#mglow)" style={{ animation: "glow 5s ease-in-out infinite", transformOrigin: "60px 60px" }} />
      <circle cx="60" cy="60" r="30" fill="url(#mface)" />
      <circle cx="50" cy="52" r="4.5" fill="#e6b863" opacity="0.55" />
      <circle cx="68" cy="66" r="6" fill="#e6b863" opacity="0.45" />
      <circle cx="64" cy="47" r="2.6" fill="#e6b863" opacity="0.5" />
    </svg>
  );
}

/** The brand mark: a nightjar on a crescent. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="15" fill="var(--acc)" />
      <path d="M21.5 7.5a9 9 0 1 0 3 12.6A7.4 7.4 0 0 1 21.5 7.5z" fill="var(--bg)" />
      <path d="M8.5 18.2c2.4-.3 4.6-1.6 6.3-3.6.6 1.4 1.8 2.3 3.4 2.4-1.9 1.1-4.4 1.8-7.3 1.7-.9 0-1.7-.2-2.4-.5z" fill="var(--acc)" />
    </svg>
  );
}
