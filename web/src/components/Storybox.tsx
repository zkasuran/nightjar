// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Chapter } from "../lib/data";

interface Token { word: string; start: number; isWord: boolean }

function tokenise(text: string): Token[] {
  const out: Token[] = [];
  const re = /(\s+)|([^\s]+)/g;
  for (const m of text.matchAll(re)) out.push({ word: m[0], start: m.index ?? 0, isWord: !m[1] });
  return out;
}

const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** The storybox: reads a real recorded chapter word by word at its tuned pace. */
export function Storybox({ chapter, autoplay = false, label, onEnd, passes = true }: { chapter: Chapter; autoplay?: boolean; label?: string; onEnd?: () => void; passes?: boolean }) {
  const tokens = useMemo(() => tokenise(chapter.text), [chapter.text]);
  const wordIdx = useMemo(() => tokens.map((t, i) => (t.isWord ? i : -1)).filter((i) => i >= 0), [tokens]);
  const [pos, setPos] = useState(-1); // index into wordIdx
  const [playing, setPlaying] = useState(autoplay);
  const [voice, setVoice] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const pace = chapter.knobs.pace_wpm;
  const msPerWord = 60000 / pace;

  useEffect(() => {
    setPos(-1);
    setPlaying(autoplay);
    if (canSpeak()) speechSynthesis.cancel();
  }, [chapter, autoplay]);

  // Timer mode
  useEffect(() => {
    if (!playing || voice) return;
    if (pos >= wordIdx.length - 1) {
      setPlaying(false);
      onEnd?.();
      return;
    }
    const t = setTimeout(() => setPos((p) => p + 1), pos < 0 ? 400 : msPerWord);
    return () => clearTimeout(t);
  }, [playing, voice, pos, wordIdx.length, msPerWord, onEnd]);

  // Voice mode: the device's own speech engine, words synced by boundary events
  useEffect(() => {
    if (!playing || !voice || !canSpeak()) return;
    const u = new SpeechSynthesisUtterance(chapter.text);
    u.rate = Math.max(0.6, Math.min(1.1, pace / 150));
    u.pitch = 1;
    u.onboundary = (e) => {
      const ti = tokens.findIndex((t) => t.isWord && t.start >= e.charIndex);
      const wi = wordIdx.indexOf(ti);
      if (wi >= 0) setPos(wi);
    };
    u.onend = () => {
      setPos(wordIdx.length - 1);
      setPlaying(false);
      onEnd?.();
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return () => speechSynthesis.cancel();
  }, [playing, voice, chapter.text, pace, tokens, wordIdx, onEnd]);

  // Keep the current word in view inside the reader only (never scroll the page)
  useEffect(() => {
    const box = readerRef.current;
    const el = box?.querySelector<HTMLElement>(".w.now");
    if (box && el) {
      const target = el.offsetTop - box.clientHeight * 0.4;
      box.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }
  }, [pos]);

  const current = pos >= 0 ? wordIdx[pos] : -1;
  const pct = wordIdx.length ? Math.max(0, ((pos + 1) / wordIdx.length) * 100) : 0;
  const leftSec = Math.max(0, Math.round(((wordIdx.length - pos - 1) * msPerWord) / 1000));
  const toggle = () => {
    if (pos >= wordIdx.length - 1) setPos(-1);
    setPlaying((p) => !p);
  };

  return (
    <div className="box">
      <div className="box-top">
        <span className="box-led" />
        <span className="t-s" style={{ fontWeight: 600 }}>{label ?? `Night ${chapter.night}`}</span>
        <span className="chip acc" style={{ marginLeft: "auto" }}>{pace} wpm</span>
        {passes ? <span className="chip good"><span className="dot" />Guardrail passes</span> : <span className="chip bad" title="Passed when recorded. A rule added after this run refuses it."><span className="dot" />Now refused</span>}
      </div>
      <div className="box-body">
        <AnimatePresence mode="wait">
          <motion.div key={chapter.title} className="box-title" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
            {chapter.title}
          </motion.div>
        </AnimatePresence>
        <div className="reader" ref={readerRef} aria-live="off">
          {tokens.map((t, i) =>
            t.isWord ? (
              <span key={i} className={`w ${i < current ? "read" : ""} ${i === current ? "now" : ""}`}>{t.word}</span>
            ) : (
              <span key={i}>{t.word.includes("\n") ? <br /> : t.word}</span>
            ),
          )}
        </div>
      </div>
      <div className="box-foot">
        <button className="play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M4 2.5v11l9.5-5.5z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Reading progress"><i style={{ width: `${pct}%` }} /></div>
        <span className="t-xs num" style={{ minWidth: 44, textAlign: "right" }}>{leftSec}s</span>
        {canSpeak() && (
          <button className={`chip ${voice ? "acc" : ""}`} style={{ cursor: "pointer" }} onClick={() => { setVoice(!voice); setPlaying(false); }} aria-pressed={voice} title="Read aloud with this device's own voice">
            {voice ? "Voice on" : "Voice off"}
          </button>
        )}
      </div>
    </div>
  );
}
