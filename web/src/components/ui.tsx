// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Fades and lifts a block in once, when it scrolls into view. */
export function Reveal({ children, delay = 0, className, y = 18 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Animated number that counts up when it first becomes visible. */
export function CountUp({ to, decimals = 0, suffix = "" }: { to: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => v.toFixed(decimals) + suffix);
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      mv.set(to);
      return;
    }
    const c = animate(mv, to, { duration: 1.2, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [inView, to, reduce, mv]);
  return <motion.span ref={ref} className="num">{text}</motion.span>;
}

export function SectionHead({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <Reveal className="sec-head">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2 className="h-l">{title}</h2>
      {children && <p className="lede">{children}</p>}
    </Reveal>
  );
}

export function PageHead({ eyebrow, title, children, links }: { eyebrow: string; title: ReactNode; children?: ReactNode; links?: Array<[string, string]> }) {
  return (
    <div className="pagehead">
      <div className="wrap">
        <motion.span className="eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{eyebrow}</motion.span>
        <motion.h1 className="h-xl" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          {title}
        </motion.h1>
        {children && (
          <motion.p className="lede" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.08 }}>
            {children}
          </motion.p>
        )}
        {links && (
          <nav className="subnav" aria-label="On this page">
            {links.map(([href, label]) => (
              <a key={href} className="chip" href={href}>{label}</a>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}

export function Code({ children, label = "Copy" }: { children: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
    } catch {
      const t = document.createElement("textarea");
      t.value = children;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  };
  return (
    <div className="code">
      <button onClick={copy} aria-label="Copy code">{done ? "Copied" : label}</button>
      <pre>
        {children.split("\n").map((line, i) => (
          <div key={i} className={line.trimStart().startsWith("#") ? "c" : undefined}>{line || " "}</div>
        ))}
      </pre>
    </div>
  );
}

export function Sample({ children = "Sample data" }: { children?: ReactNode }) {
  return <span className="badge-sample" title="Representative data, not measured on a real child">{children}</span>;
}
export function Real({ children = "Real output" }: { children?: ReactNode }) {
  return <span className="badge-real">{children}</span>;
}

export function Tick({ ok = true, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <div className={`tick ${ok ? "" : "cross"}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        {ok ? <path d="M4 12.5 9.5 18 20 6.5" /> : <path d="M6 6l12 12M18 6 6 18" />}
      </svg>
      <div>{children}</div>
    </div>
  );
}

export function Loading({ h = 360 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} aria-busy="true" aria-label="Loading" />;
}

export function Failed({ what, err }: { what: string; err: string }) {
  return (
    <div className="empty" role="alert">
      <h2 className="h-m">{what} could not load</h2>
      <p className="mono t-s">{err.slice(0, 300)}</p>
      <button className="btn" onClick={() => window.location.reload()}>Try again</button>
    </div>
  );
}
