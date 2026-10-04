// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRoute, useTheme } from "../lib/router";
import { Mark } from "./Sky";

interface Item { href: string; title: string; desc: string; icon: string }
interface Cat { id: string; label: string; pages: string[]; items: Item[] }

export const NAV: Cat[] = [
  {
    id: "try",
    label: "Try it",
    pages: ["ask", "story", "tuner", "guard", "lab"],
    items: [
      { href: "#/ask", title: "Ask for a story", desc: "She picks a topic, the story is written for her", icon: "spark" },
      { href: "#/story", title: "Tonight's chapter", desc: "Eight real nights from the local model, read along", icon: "book" },
      { href: "#/tuner", title: "Run the tuner", desc: "Edit the sleep log and watch tomorrow's pick move", icon: "dial" },
      { href: "#/guard", title: "Break the guardrail", desc: "Try to sneak a monster past the filter", icon: "shield" },
      { href: "#/lab", title: "Gemma in your browser", desc: "Write a chapter on this device, offline after one download", icon: "chip" },
    ],
  },
  {
    id: "how",
    label: "How it works",
    pages: ["how", "book"],
    items: [
      { href: "#/how/loop", title: "The nightly loop", desc: "Ask, recall, write, screen, read, log, tune", icon: "loop" },
      { href: "#/how/bible", title: "Series bible", desc: "Characters and loose threads carried night to night", icon: "users" },
      { href: "#/how/guard", title: "Guardrail rules", desc: "A rule outside the model, not a request inside it", icon: "list" },
      { href: "#/book", title: "The printed book", desc: "The week's chapters as an A5 book for her shelf", icon: "print" },
    ],
  },
  {
    id: "privacy",
    label: "Privacy",
    pages: ["privacy"],
    items: [
      { href: "#/privacy/home", title: "What stays home", desc: "Three files in her house, nothing uploaded", icon: "home" },
      { href: "#/privacy/open", title: "Why open weights", desc: "What a closed API could not have done here", icon: "key" },
      { href: "#/privacy/consent", title: "Voice consent", desc: "No voice cloned without its owner saying yes", icon: "mic" },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    pages: ["reports"],
    items: [
      { href: "#/reports/series", title: "The recorded series", desc: "Attempts, refusals and timings for all eight nights", icon: "chart" },
      { href: "#/reports/models", title: "TabPFN vs k-NN", desc: "Leave one out error on the sample log", icon: "scale" },
      { href: "#/reports/real", title: "Real and simulated", desc: "Exactly which numbers are measured", icon: "check" },
      { href: "#/reports/limits", title: "Limits", desc: "What does not work yet, said plainly", icon: "alert" },
    ],
  },
  {
    id: "developers",
    label: "Developers",
    pages: ["developers"],
    items: [
      { href: "#/developers/cli", title: "Command line", desc: "doctor, tonight, asleep, tune, book, bible", icon: "term" },
      { href: "#/developers/modules", title: "Modules", desc: "Ten small Python files, stdlib core", icon: "code" },
      { href: "#/developers/data", title: "Data formats", desc: "child.json, bible.json, bedtime_log.csv", icon: "doc" },
      { href: "#/developers/security", title: "Security model", desc: "Threats, defences and the release gate", icon: "lock" },
    ],
  },
];

export function NavIcon({ name }: { name: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const d: Record<string, ReactNode> = {
    spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20" /></>,
    dial: <><circle cx="12" cy="12" r="8" /><path d="M12 12l4-3M12 4v2M20 12h-2M4 12h2" /></>,
    shield: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
    chip: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>,
    loop: <><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></>,
    users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c1-3.6 3.6-5.5 6.5-5.5s5.5 1.9 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.6c1.8.7 3 2.5 3.6 5.4" /></>,
    list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
    print: <><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></>,
    home: <><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></>,
    key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M14 9l2 2" /></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
    chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    scale: <><path d="M12 4v16M5 20h14M6 8h12" /><path d="m6 8-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0z" /></>,
    check: <path d="M4 12.5 9.5 18 20 6.5" />,
    alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
    term: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
    code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />,
    doc: <><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h7" /></>,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden {...p}>{d[name]}</svg>;
}

function Chevron() {
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const dark = theme === "dark";
  return (
    <button className="icon-btn theme-btn" onClick={toggle} aria-pressed={dark} aria-label={`Switch to ${dark ? "light" : "dark"} mode`} title="Toggle light and dark">
      <AnimatePresence mode="wait" initial={false}>
        <motion.svg
          key={theme}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          aria-hidden
          initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          {dark ? (
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor" />
          ) : (
            <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></g>
          )}
        </motion.svg>
      </AnimatePresence>
    </button>
  );
}

export function Header() {
  const r = useRoute();
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    setOpen(null);
    setMobile(false);
  }, [r.page, r.arg]);
  useEffect(() => {
    const out = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (setOpen(null), setMobile(false));
    document.addEventListener("pointerdown", out);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", out);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const active = NAV.find((c) => c.pages.includes(r.page))?.id;

  const onKeys = (e: React.KeyboardEvent, id: string) => {
    const links = Array.from(document.getElementById(`sub-${id}`)?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(id);
      requestAnimationFrame(() => {
        const ls = document.getElementById(`sub-${id}`)?.querySelectorAll<HTMLAnchorElement>("a");
        ls?.[Math.min((ls?.length ?? 1) - 1, i + 1)]?.focus();
      });
    } else if (e.key === "ArrowUp" && i > 0) {
      e.preventDefault();
      links[i - 1].focus();
    }
  };

  return (
    <header className="hdr" ref={ref}>
      <div className="wrap">
        <a className="brand" href="#/" aria-label="Nightjar home">
          <Mark />
          Nightjar
        </a>
        <nav className="menu" aria-label="Main">
          {NAV.map((c) => (
            <div key={c.id} className={`menu-item ${open === c.id ? "open" : ""}`} onMouseEnter={() => setOpen(c.id)} onMouseLeave={() => setOpen(null)} onKeyDown={(e) => onKeys(e, c.id)}>
              <button
                className={`menu-btn ${active === c.id ? "on" : ""}`}
                aria-haspopup="menu"
                aria-expanded={open === c.id}
                aria-controls={`sub-${c.id}`}
                onClick={() => setOpen(open === c.id ? null : c.id)}
                onFocus={() => setOpen(c.id)}
              >
                {c.label}
                <Chevron />
              </button>
              <AnimatePresence>
                {open === c.id && (
                  <motion.div className="submenu" id={`sub-${c.id}`} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
                    <div className="submenu-inner" role="menu" aria-label={c.label}>
                      {c.items.map((it, k) => (
                        <motion.a key={it.href} href={it.href} role="menuitem" onClick={() => setOpen(null)} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * k, duration: 0.18 }}>
                          <span className="ico"><NavIcon name={it.icon} /></span>
                          <span>
                            <b>{it.title}</b>
                            <span>{it.desc}</span>
                          </span>
                        </motion.a>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </nav>
        <div className="hdr-right">
          <ThemeToggle />
          <a className="btn primary sm hdr-cta" href="#/ask">Ask for a story</a>
          <button className="icon-btn burger" aria-label="Menu" aria-expanded={mobile} onClick={() => setMobile(!mobile)}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={mobile ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} /></svg>
          </button>
        </div>
      </div>
      <AnimatePresence>
        {mobile && (
          <motion.div className="mobile-panel" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            {NAV.map((c) => (
              <div key={c.id}>
                <h4>{c.label}</h4>
                {c.items.map((it) => <a key={it.href} href={it.href}>{it.title}</a>)}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div style={{ display: "grid", gap: 10 }}>
          <div className="row"><Mark size={24} /><b style={{ color: "var(--ink)", fontFamily: "var(--font-display)", fontSize: 18 }}>Nightjar</b></div>
          <p>Bedtime stories that learn what gets them to sleep. Open weights, on your own laptop.</p>
          <p className="t-xs">Story model: Gemma 3 by Google, under the Gemma Terms of Use. Tuner: Built with PriorLabs-TabPFN. Source available under LicenseRef-zkasuran-SAND-1.0.</p>
        </div>
        {NAV.filter((c) => c.id !== "privacy").map((c) => (
          <div key={c.id}>
            <h4>{c.label}</h4>
            {c.items.map((it) => <a key={it.href} href={it.href}>{it.title}</a>)}
          </div>
        ))}
      </div>
    </footer>
  );
}
