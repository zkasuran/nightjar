// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Code, Failed, Loading, PageHead, Real, Reveal, Sample, SectionHead, Tick } from "../components/ui";
import type { Demo } from "../lib/data";
import { stats, useDemo } from "../lib/useDemo";
import { LOOP } from "./Home";

function withDemo(render: (d: Demo) => ReactNode, what: string) {
  return function Wrapped() {
    const st = useDemo();
    if (st.status === "loading") return <div className="wrap sec"><Loading /></div>;
    if (st.status === "error") return <div className="wrap sec"><Failed what={what} err={st.error} /></div>;
    return <>{render(st.demo)}</>;
  };
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="card tight tbl-scroll">
      <table className="data">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/* ---------------- How it works ---------------- */

export const How = withDemo((d) => {
  const b = d.stories.bible;
  return (
    <>
      <PageHead eyebrow="How it works" title="One loop, run every night" links={[["#/how/loop", "The loop"], ["#/how/bible", "Series bible"], ["#/how/guard", "Guardrail rules"], ["#/book", "The book"]]}>
        Seven steps between her asking for a story and tomorrow's story being a little better.
      </PageHead>
      <section className="sec" id="loop">
        <div className="wrap">
          <SectionHead eyebrow="The loop" title="Ask, recall, write, screen, read, log, tune" />
          <div className="grid-4">
            {LOOP.map((s, i) => (
              <Reveal key={s.k} delay={i * 0.04} className="card tight stack">
                <span className="chip acc" style={{ justifySelf: "start" }}>{i + 1} · {s.k}</span>
                <h3 className="h-s">{s.t}</h3>
                <p className="t-s">{s.d}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
      <section className="sec" id="bible">
        <div className="wrap split">
          <SectionHead eyebrow="Series bible" title="Characters come back. Threads get picked up.">
            Each accepted chapter writes back a summary, its cast and one loose thread. Tomorrow's prompt includes last night plus the most relevant earlier nights.
          </SectionHead>
          <Reveal className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}><h3 className="h-s">The bible after the recorded series</h3><Real /></div>
            {b.characters.map((c) => <div key={c.name} className="inset"><b>{c.name}</b><p className="t-s">{c.description}</p></div>)}
            <div className="stack" style={{ gap: 8 }}>
              {b.chapters.slice(-4).map((c) => (
                <div key={c.night + c.title} className="tick">
                  <span className="chip" style={{ height: 22, fontSize: 11 }}>{c.night.slice(5)}</span>
                  <div><b style={{ fontSize: 14 }}>{c.title}</b><p className="t-s">{c.summary}</p>{c.open_thread && <p className="t-xs">Loose thread: {c.open_thread}</p>}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>
      <section className="sec" id="guard">
        <div className="wrap split">
          <SectionHead eyebrow="Guardrail rules" title="A rule outside the model, not a request inside it">
            A prompt asks the model to be gentle. The guardrail checks whether it was. It cannot be talked out of a verdict.
          </SectionHead>
          <Reveal className="stack">
            <Table
              head={["Rule", "Catches"]}
              rows={[
                [<b>Banned words</b>, `${d.guard.banned.length} whole words, matched after normalising, so "fire" is caught and "fireflies" is not`],
                [<b>Banned phrases</b>, d.guard.banned_phrases.map((p) => `"${p}"`).join(", ")],
                [<b>Her fear list</b>, `From child.json: ${d.stories.child.avoid.join(", ")}`],
                [<b>Meta talk</b>, "The model talking about itself instead of telling a story"],
                [<b>Leaked scaffolding</b>, "Raw JSON keys or code fences in the text"],
                [<b>Length</b>, "Too short to settle a child or too long for tonight"],
                [<b>The title too</b>, "It is read aloud and printed, so it is screened like the story"],
              ]}
            />
            <a className="btn" href="#/guard" style={{ justifySelf: "start" }}>Try to break it</a>
          </Reveal>
        </div>
      </section>
    </>
  );
}, "How it works");

/* ---------------- Privacy ---------------- */

export function Privacy() {
  return (
    <>
      <PageHead eyebrow="Privacy" title="Her bedtime never leaves the house" links={[["#/privacy/home", "What stays home"], ["#/privacy/open", "Why open weights"], ["#/privacy/consent", "Voice consent"]]}>
        Nightjar's whole state is three small files on one laptop. There is no account, no server and no request log to read.
      </PageHead>
      <section className="sec" id="home">
        <div className="wrap split">
          <SectionHead eyebrow="What stays home" title="Three files, all of them hers" />
          <Reveal>
            <Table
              head={["File", "Holds", "Leaves the laptop?"]}
              rows={[
                [<code className="mono">child.json</code>, "Name, age, loves, fear list", <span className="chip good">Never</span>],
                [<code className="mono">bible.json</code>, "Characters and every chapter summary", <span className="chip good">Never</span>],
                [<code className="mono">bedtime_log.csv</code>, "One row per night, minutes to sleep", <span className="chip good">Never</span>],
                [<span>Narration text</span>, "Tonight's chapter only", <span className="chip acc">Only if you turn on ElevenLabs</span>],
              ]}
            />
          </Reveal>
        </div>
      </section>
      <section className="sec" id="open">
        <div className="wrap">
          <SectionHead eyebrow="Why open weights" title="Where open beat closed, concretely" />
          <div className="grid-4">
            {[
              ["Privacy", "Sleep times and fears of a four year old are not something to post to a vendor. Local inference means there is nothing to post."],
              ["Cost", "Roughly 350 chapters a year at zero marginal cost. A metered API turns every bedtime into a small bill."],
              ["Offline", "Ollama on a CPU laptop writes a chapter in under a minute with the router unplugged."],
              ["Control", "Swap models, pin a version forever, add a guardrail and a tuner around it. None of that needs permission."],
            ].map(([t, b], i) => (
              <Reveal key={t} delay={i * 0.05} className="card tight stack"><h3 className="h-s">{t}</h3><p className="t-s">{b}</p></Reveal>
            ))}
          </div>
        </div>
      </section>
      <section className="sec" id="consent">
        <div className="wrap split">
          <SectionHead eyebrow="Voice consent" title="No voice is cloned without its owner saying yes" />
          <Reveal className="card stack">
            <Tick>The speaker records their own sample, knowingly, for this purpose</Tick>
            <Tick>Consent is written down before any audio is generated</Tick>
            <Tick>They can withdraw it and the voice is deleted</Tick>
            <Tick>She is told whose voice it is</Tick>
            <Tick ok={false}>No scraping old videos or voicemails, ever</Tick>
            <p className="t-xs">The voice on this site is Kokoro's stock af_heart voice, rendered offline on the laptop. Nobody's voice was cloned. The repo ships CONSENT.md with the record template.</p>
          </Reveal>
        </div>
      </section>
    </>
  );
}

/* ---------------- Reports ---------------- */

function SeriesChart({ d }: { d: Demo }) {
  const byNight = new Map(d.stories.chapters.map((c) => [c.night, c]));
  const rows = d.stories.nights;
  const target = d.stories.chapters[0]?.knobs.target_words ?? 220;
  const max = Math.max(target, ...d.stories.chapters.map((c) => c.features.word_count)) * 1.1;
  const W = 640;
  const L = 150;
  const H = 34;
  const x = (v: number) => L + (v / max) * (W - L - 40);
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * H + 40}`} width="100%" role="img" aria-label="Words written per night against the target">
      <line x1={x(target)} x2={x(target)} y1={8} y2={rows.length * H + 8} stroke="var(--acc)" strokeDasharray="4 4" />
      <text x={x(target) - 6} y={rows.length * H + 26} textAnchor="end" fontSize="12" fill="var(--acc)" fontFamily="var(--font-ui)" fontWeight="600">target {target} words</text>
      {rows.map((n, i) => {
        const c = byNight.get(n.night);
        const y = 12 + i * H;
        const w = c ? c.features.word_count : 0;
        return (
          <g key={n.night}>
            <text x={L - 10} y={y + 15} textAnchor="end" fontSize="12.5" fill="var(--ink-2)" fontFamily="var(--font-ui)">Night {n.index}</text>
            {c ? (
              <motion.rect x={L} y={y} height={20} rx={5} fill="var(--good)" initial={{ width: 0 }} whileInView={{ width: x(w) - L }} viewport={{ once: true }} transition={{ duration: 0.7, delay: i * 0.06 }} opacity={0.85} />
            ) : (
              <rect x={L} y={y} height={20} width={150} rx={5} fill="var(--bad-soft)" stroke="var(--bad)" strokeDasharray="3 3" />
            )}
            <text x={c ? x(w) + 8 : L + 160} y={y + 15} fontSize="12" fill={c ? "var(--ink)" : "var(--bad)"} fontFamily="var(--font-ui)" fontWeight="600">
              {c ? `${w} words · ${c.attempts} ${c.attempts > 1 ? "tries" : "try"}` : `refused · ${n.refused_drafts.length} drafts`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function MaeChart({ d }: { d: Demo }) {
  const l = d.tuner.loo;
  const bars: Array<[string, number | null, string]> = [
    ["Always guess the average", l.mean_baseline_mae, "var(--muted)"],
    ["k-NN", l.knn_mae, "var(--acc-2)"],
    ["TabPFN", l.tabpfn_mae, "var(--good)"],
  ];
  const max = Math.max(...bars.map((b) => b[1] ?? 0)) * 1.15;
  return (
    <svg viewBox="0 0 520 150" width="100%" role="img" aria-label="Leave one out mean absolute error in minutes">
      {bars.map(([k, v, col], i) => {
        const y = 14 + i * 44;
        const w = v == null ? 0 : (v / max) * 300;
        return (
          <g key={k}>
            <text x={170} y={y + 17} textAnchor="end" fontSize="13" fill="var(--ink-2)" fontFamily="var(--font-ui)">{k}</text>
            <motion.rect x={180} y={y} height={26} rx={6} fill={col} initial={{ width: 0 }} whileInView={{ width: w }} viewport={{ once: true }} transition={{ duration: 0.7, delay: i * 0.1 }} />
            <text x={186 + w} y={y + 18} fontSize="13" fontWeight="700" fill="var(--ink)" fontFamily="var(--font-ui)">{v == null ? "not run" : `${v.toFixed(2)} min`}</text>
          </g>
        );
      })}
    </svg>
  );
}

export const Reports = withDemo((d) => {
  const s = stats(d);
  const l = d.tuner.loo;
  return (
    <>
      <PageHead eyebrow="Reports" title="What the recorded run shows" links={[["#/reports/series", "The series"], ["#/reports/models", "TabPFN vs k-NN"], ["#/reports/real", "Real and simulated"], ["#/reports/limits", "Limits"]]}>
        Every number on this page comes from the fixtures the site verifies on load, exported by the same code that shipped.
      </PageHead>
      <section className="sec" id="series">
        <div className="wrap split wide-r">
          <SectionHead eyebrow="The recorded series" title={<>{s.chapters} chapters, <span className="hl">{s.rejected}</span> drafts refused</>}>
            {s.attempts} drafts in total over {s.nights} nights{s.refusedNights ? `, ${s.refusedNights} nights with no new chapter` : ""}. {s.slipped.length} accepted chapters slipped a rule that was added after reading the run back. The model never came close to the length target.
          </SectionHead>
          <Reveal className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}><h3 className="h-s">Words per night against the target</h3><Real /></div>
            <SeriesChart d={d} />
            <p className="t-xs">{d.stories.note} {d.stories.runtime}.</p>
          </Reveal>
        </div>
      </section>
      <section className="sec" id="models">
        <div className="wrap split wide-r">
          <SectionHead eyebrow="TabPFN vs k-NN" title={l.tabpfn_mae != null ? <>TabPFN misses by <span className="hl">{l.tabpfn_mae.toFixed(2)} min</span></> : "TabPFN did not run"}>
            Leave one out on the {l.rows} sample rows: hide a night, predict it from the rest, repeat. Mean absolute error in minutes.
          </SectionHead>
          <Reveal className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}><h3 className="h-s">Error predicting a hidden night</h3><Sample>Sample rows</Sample></div>
            <MaeChart d={d} />
            <p className="t-xs">The sample rows were written to follow one clean pattern (shorter, slower and calmer means faster sleep), so a strong model fits them well. This shows the pipeline works. It does not show Nightjar helps a real child; only real nights can. Built with PriorLabs-TabPFN {d.tuner.tabpfn_version ?? ""}.</p>
          </Reveal>
        </div>
      </section>
      <section className="sec" id="real">
        <div className="wrap">
          <SectionHead eyebrow="Real and simulated" title="Exactly which numbers are measured" />
          <Reveal>
            <Table
              head={["What", "Status", "Source"]}
              rows={[
                ["Chapter text and titles", <Real>Real</Real>, `${d.stories.model} through Ollama on a CPU laptop, ${d.stories.recorded}`],
                ["Guardrail verdicts and refused drafts", <Real>Real</Real>, "nightjar/guard.py on the model output, drafts redacted"],
                ["Generation times", <Real>Real</Real>, "Ollama's own timings, all attempts summed"],
                ["TabPFN predictions", <Real>Real run</Real>, "tabpfn on CPU, on the sample log"],
                ["k-NN in the tuner page", <Real>Real run</Real>, "Your browser, on the sample log or your edits"],
                ["Gemma in the lab page", <Real>Real run</Real>, "Your device, after you press download"],
                ["Child profile", <Sample>Sample</Sample>, "A placeholder child, not a real person"],
                ["Minutes to sleep", <Sample>Sample</Sample>, "Representative rows, never measured"],
                ["Night dates", <Sample>Sequence</Sample>, "One recording session, numbered as nights"],
                ["Lullaby under the voice", <Real>Real</Real>, "Composed in your browser with Web Audio, a new tune seeded by each chapter, about 17 dB under the voice"],
                ["Narration and word timing", <Real>Real</Real>, "Kokoro-82M (af_heart) offline on the laptop, word clock from its token timestamps. ElevenLabs path exists but was not run"],
              ]}
            />
          </Reveal>
        </div>
      </section>
      <section className="sec" id="limits">
        <div className="wrap split">
          <SectionHead eyebrow="Limits" title="What does not work yet" />
          <Reveal className="card stack">
            <Tick ok={false}>gemma3:1b ignores length. It wrote {s.minWords} to {s.maxWords} words against a {d.stories.chapters[0]?.knobs.target_words ?? 220} word target, so "too short" is the most common refusal.</Tick>
            <Tick ok={false}>Reading level drifts. Grades ran from {Math.min(...d.stories.chapters.map((c) => c.features.fk_grade))} to {Math.max(...d.stories.chapters.map((c) => c.features.fk_grade))} for a four year old. The guardrail does not check it yet.</Tick>
            <Tick ok={false}>The guardrail is a word list. It catches words, not ideas. Night 5 asked for "a dragon that breathes fire" and the chapter that passed has Pim wishing for "a tiny flame". "flames" is banned. "flame" is not.</Tick>
            <Tick ok={false}>The tuner has only seen sample data. Whether it helps a real child is the open question.</Tick>
            <Tick ok={false}>No physical box yet. The one button lives in the terminal and on this site.</Tick>
          </Reveal>
        </div>
      </section>
    </>
  );
}, "The reports");

/* ---------------- Developers ---------------- */

export function Developers() {
  return (
    <>
      <PageHead eyebrow="Developers" title="Small, local and boring on purpose" links={[["#/developers/cli", "CLI"], ["#/developers/modules", "Modules"], ["#/developers/data", "Data formats"], ["#/developers/security", "Security"]]}>
        Python 3.11 standard library for the core loop. Ollama for the model. Optional extras degrade loudly when missing.
      </PageHead>
      <section className="sec" id="cli">
        <div className="wrap split">
          <SectionHead eyebrow="Command line" title="Seven commands" />
          <Reveal className="stack">
            <Table
              head={["Command", "Does"]}
              rows={[
                [<code className="mono">doctor</code>, "Checks Ollama, the model, narration, TabPFN and the log"],
                [<code className="mono">tonight "request"</code>, "Tunes, writes, screens and saves tonight's chapter"],
                [<code className="mono">asleep 14</code>, "Logs minutes to sleep for the latest night"],
                [<code className="mono">tune</code>, "Prints tomorrow's pick and which backend made it"],
                [<code className="mono">book</code>, "Compiles the week into A5 HTML, plus PDF if available"],
                [<code className="mono">bible</code>, "Shows characters, recent chapters and loose threads"],
                [<code className="mono">serve</code>, "The box: a local page where she taps a picture or types her idea, then hears it read aloud"],
              ]}
            />
            <Code>{`python3 -m venv .venv && .venv/bin/pip install "tabpfn==2.2.1"
ollama serve & ollama pull gemma3:1b
.venv/bin/python -m nightjar.cli doctor
.venv/bin/python -m nightjar.cli tonight "can the moon come down and visit"`}</Code>
          </Reveal>
        </div>
      </section>
      <section className="sec" id="modules">
        <div className="wrap split">
          <SectionHead eyebrow="Modules" title="One job per file" />
          <Reveal>
            <Table
              head={["File", "Job"]}
              rows={[
                ["story.py", "Prompt, generate, guard, accept or rewrite"],
                ["guard.py", "Deterministic content rules, normalised input"],
                ["bible.py", "Series continuity and retrieval"],
                ["tune.py", "TabPFN or k-NN over the 72 point knob grid"],
                ["features.py", "One row per night, the feature contract"],
                ["sleeplog.py", "The CSV and the single parent tap"],
                ["llm.py", "Ollama client, stdlib only, size capped"],
                ["narrate.py", "Consent gated narration"],
                ["book.py", "Print ready A5 book"],
                ["limits.py", "Every ceiling on untrusted input"],
              ].map(([f, j]) => [<code className="mono">nightjar/{f}</code>, j])}
            />
          </Reveal>
        </div>
      </section>
      <section className="sec" id="data">
        <div className="wrap split">
          <SectionHead eyebrow="Data formats" title="Hand editable, validated on load">
            A parent edits these by hand, so a typo gives a clear message and never a traceback.
          </SectionHead>
          <Reveal className="stack">
            <Code>{`# data/child.json
{
  "name": "Mira", "age": 4, "reading_grade": 1.0,
  "loves": ["turtles", "the moon", "her red boots", "snow"],
  "avoid": ["thunder", "basement", "being alone", "dogs barking"],
  "narrator_name": "Dad", "narrator_voice_id": null, "bedtime_hour": 19
}`}</Code>
            <Code>{`# data/bedtime_log.csv, one row per night
night,title,word_count,sentence_count,avg_sentence_len,fk_grade,pace_wpm,
calm_level,is_sequel,cast_size,bedtime_hour,narration_seconds,minutes_to_asleep`}</Code>
          </Reveal>
        </div>
      </section>
      <section className="sec" id="security">
        <div className="wrap split">
          <SectionHead eyebrow="Security model" title="Model output is untrusted input">
            One release gate, <code className="mono">./verify.sh</code>, runs lint, tests, parity, the web build and the audits. CI runs the same script.
          </SectionHead>
          <Reveal>
            <Table
              head={["Attack", "Defence"]}
              rows={[
                ["Hidden or full width letters spell a banned word", "NFKC plus invisible character stripping before matching"],
                ["Model loops or returns megabytes", "Reply size ceiling, text ceiling, title cap"],
                ["Half valid JSON read aloud", "Field repair, then a scaffolding rule in the guardrail"],
                ["Hand edited file is malformed", "Bounded reads, typed validation, clear errors"],
                ["Tampered site fixtures", "sha256 manifest checked in the browser before render"],
                ["Script injection or framing", "Build time CSP by hash, frame-ancestors none, no innerHTML"],
              ]}
            />
          </Reveal>
        </div>
      </section>
    </>
  );
}
