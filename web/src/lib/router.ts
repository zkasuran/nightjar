// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Hash router (any static host), route param validation and the theme switch.

import { useEffect, useState, useSyncExternalStore } from "react";

export interface Route {
  /** First path segment: "", "story", "tuner", "guard", "lab", "book", "how", "privacy", "reports", "developers". */
  page: string;
  /** Second segment: an in-page section id, validated against SLUG. */
  arg: string;
  query: URLSearchParams;
}

/** Route segments are matched against this before anything uses them. */
const SLUG = /^[a-z0-9-]{0,32}$/;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return "";
  }
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "").slice(0, 200);
  const [path, q = ""] = raw.split("?");
  const [p = "", a = ""] = path.split("/");
  const page = SLUG.test(p) ? p : "404";
  const arg = safeDecode(a);
  return { page, arg: SLUG.test(arg) ? arg : "", query: new URLSearchParams(q) };
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

let snap = parse();
let key = window.location.hash;
function getSnap() {
  if (window.location.hash !== key) {
    key = window.location.hash;
    snap = parse();
  }
  return snap;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnap);
}

export function go(path: string) {
  window.location.hash = path.startsWith("#") ? path : `#${path}`;
}

/** Scrolls to the section named in the route (or the top) after each navigation. */
export function useSectionScroll(r: Route) {
  useEffect(() => {
    const id = r.arg;
    const el = id ? document.getElementById(id) : null;
    requestAnimationFrame(() => {
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0 });
    });
  }, [r.page, r.arg]);
}

export type Theme = "light" | "dark";

export function useTheme(): [Theme, () => void] {
  const [t, setT] = useState<Theme>(() => (document.documentElement.getAttribute("data-theme") as Theme) || "dark");
  const toggle = () => {
    const n: Theme = t === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", n);
    try {
      localStorage.setItem("theme", n);
    } catch {
      /* private mode: the choice lasts for this page */
    }
    setT(n);
  };
  return [t, toggle];
}
