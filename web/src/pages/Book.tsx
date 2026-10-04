// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Failed, Loading, PageHead, Real } from "../components/ui";
import type { Demo } from "../lib/data";
import { useDemo } from "../lib/useDemo";

function Body({ d }: { d: Demo }) {
  const ch = d.stories.chapters;
  const pages = [{ kind: "cover" as const }, ...ch.map((c, i) => ({ kind: "ch" as const, c, i })), { kind: "end" as const }];
  const [at, setAt] = useState(0); // left page index, always even
  const [dir, setDir] = useState(1);
  const go = (n: number) => {
    const next = Math.max(0, Math.min(pages.length - 1 - ((pages.length - 1) % 2), n));
    setDir(next > at ? 1 : -1);
    setAt(next);
  };
  const render = (p: (typeof pages)[number] | undefined, side: "l" | "r", n: number) => {
    if (!p) return <div className={`page ${side}`} />;
    return (
      <div className={`page ${side}`}>
        {p.kind === "cover" && (
          <div style={{ display: "grid", placeItems: "center", height: "100%", textAlign: "center", gap: 10 }}>
            <div>
              <div className="night-tag">Volume one</div>
              <h3 style={{ fontSize: 30 }}>{d.stories.child.name}'s Book of Nights</h3>
              <p style={{ color: "#6b6150", marginTop: 10 }}>{ch.length} chapters, written at bedtime</p>
            </div>
          </div>
        )}
        {p.kind === "ch" && (
          <>
            <div className="night-tag">Chapter {p.i + 1} · {p.c.night}</div>
            <h3>{p.c.title}</h3>
            {p.c.text.split("\n").filter(Boolean).map((para, k) => <p key={k} style={{ margin: "0 0 8px", textIndent: k ? 18 : 0 }}>{para}</p>)}
          </>
        )}
        {p.kind === "end" && (
          <div style={{ display: "grid", placeItems: "center", height: "100%", textAlign: "center", fontSize: 13, color: "#6b6150" }}>
            <p style={{ maxWidth: 260 }}>Every chapter in this book was written on a laptop in this house by an open weight model, checked by a guardrail and read aloud before anyone fell asleep.</p>
          </div>
        )}
        <div className="pn">{n + 1}</div>
      </div>
    );
  };
  return (
    <>
      <PageHead eyebrow="How it works · The printed book" title="The week, bound for her shelf">
        A story that evaporates is a demo. A book she can hold is hers. <code className="mono">nightjar book</code> lays the week out as print ready A5 pages.
      </PageHead>
      <section className="sec" style={{ paddingTop: 16 }}>
        <div className="wrap stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <Real>Recorded chapters</Real>
            <div className="row no-print">
              <button className="btn sm" onClick={() => go(at - 2)} disabled={at === 0} aria-label="Previous pages">Previous</button>
              <span className="t-s num">{at + 1} to {Math.min(at + 2, pages.length)} of {pages.length}</span>
              <button className="btn sm primary" onClick={() => go(at + 2)} disabled={at + 2 >= pages.length} aria-label="Next pages">Next</button>
            </div>
          </div>
          <div className="book">
            <AnimatePresence mode="wait" custom={dir}>
              <motion.div
                key={at}
                className="spread"
                custom={dir}
                initial={{ rotateY: dir * -24, opacity: 0, x: dir * 40 }}
                animate={{ rotateY: 0, opacity: 1, x: 0 }}
                exit={{ rotateY: dir * 24, opacity: 0, x: dir * -40 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                {render(pages[at], "l", at)}
                {render(pages[at + 1], "r", at + 1)}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="row" style={{ justifyContent: "center" }}>
            <a className="btn primary" href="/demo/book.pdf" download="Book-of-Nights.pdf">Download the A5 PDF</a>
          </div>
          <p className="t-xs" style={{ textAlign: "center" }}>Made by <code className="mono">nightjar book</code> with WeasyPrint from the same recorded chapters. Print it double sided and staple the spine.</p>
        </div>
      </section>
    </>
  );
}

export function Book() {
  const st = useDemo();
  if (st.status === "loading") return <div className="wrap sec"><Loading /></div>;
  if (st.status === "error") return <div className="wrap sec"><Failed what="The book" err={st.error} /></div>;
  return <Body d={st.demo} />;
}
