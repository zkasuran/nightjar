// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { loadAudio, type Chapter } from "../lib/data";
import { Lullaby, seedOf } from "../lib/lullaby";

interface Token { text: string; isWord: boolean; w: number }

/** Whitespace tokens. Word i here is word i of the narration's word clock. */
function tokenise(text: string): Token[] {
  const out: Token[] = [];
  let w = 0;
  for (const m of text.matchAll(/\s+|\S+/g)) {
    const isWord = !/^\s/.test(m[0]);
    out.push({ text: m[0], isWord, w: isWord ? w++ : -1 });
  }
  return out;
}

/** Index of the last word whose start is at or before t, or -1. */
function wordAt(starts: number[], t: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

type VoiceState = "off" | "loading" | "on" | "blocked" | "error";

/** Voice preference survives moving between chapters (which remounts the box)
 *  for this tab only. Storage is user editable, so only "1" counts as on. */
const VOICE_KEY = "nightjar-voice";
function voicePref(): boolean {
  try {
    return sessionStorage.getItem(VOICE_KEY) === "1";
  } catch {
    return false;
  }
}
/** Music plays under the voice unless it was turned off in this tab. */
const MUSIC_KEY = "nightjar-music";
function musicPref(): boolean {
  try {
    return sessionStorage.getItem(MUSIC_KEY) !== "0";
  } catch {
    return true;
  }
}
function setMusicPref(on: boolean) {
  try {
    sessionStorage.setItem(MUSIC_KEY, on ? "1" : "0");
  } catch {
    /* lasts for this box only */
  }
}

function setVoicePref(on: boolean) {
  try {
    sessionStorage.setItem(VOICE_KEY, on ? "1" : "0");
  } catch {
    /* private mode: preference lasts for this box only */
  }
}

/**
 * The storybox. One clock drives everything: in voice mode it is the audio
 * element's own currentTime, otherwise a virtual clock that advances only
 * while playing. Highlighting, progress, pause, resume, seek and switching
 * voice on mid-chapter all read and write that one number, so the words can
 * never drift from the sound.
 */
export function Storybox({ chapter, autoplay = false, label, onEnd, passes = true, childName, endActions }: { chapter: Chapter; autoplay?: boolean; label?: string; onEnd?: () => void; passes?: boolean; childName?: string; endActions?: ReactNode }) {
  const tokens = useMemo(() => tokenise(chapter.text), [chapter.text]);
  const nWords = useMemo(() => tokens.filter((t) => t.isWord).length, [tokens]);
  const audioMeta = chapter.audio && chapter.audio.words.length === nWords ? chapter.audio : null;
  const pace = Math.round(audioMeta?.overall_wpm ?? chapter.knobs.pace_wpm);
  const starts = useMemo(() => {
    if (audioMeta) return audioMeta.words.map((w) => w[0]);
    const step = 60 / chapter.knobs.pace_wpm;
    return Array.from({ length: nWords }, (_, i) => 0.4 + i * step);
  }, [audioMeta, nWords, chapter.knobs.pace_wpm]);
  const duration = audioMeta?.duration ?? (starts.length ? starts[starts.length - 1] + 60 / chapter.knobs.pace_wpm + 0.4 : 0);

  const [playing, setPlaying] = useState(autoplay);
  const [voice, setVoice] = useState<VoiceState>(() => (voicePref() ? "loading" : "off"));
  const [attempt, setAttempt] = useState(0);
  const [music, setMusic] = useState(musicPref);
  const lullaby = useRef<Lullaby | null>(null);
  const [pos, setPos] = useState(-1);
  // One chapter, then the end. Nothing plays on by itself: this is bedtime.
  const [ended, setEnded] = useState(false);
  const [left, setLeft] = useState(Math.round(duration));
  const t = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const voiceOn = voice === "on";

  const paint = useCallback(() => {
    const p = wordAt(starts, t.current);
    setPos((old) => (old === p ? old : p));
    setLeft(Math.max(0, Math.round(duration - t.current)));
    // Exposed for the sync check in the browser test: the clock and the sound.
    if (boxRef.current) {
      boxRef.current.dataset.clock = t.current.toFixed(3);
      boxRef.current.dataset.audio = audio.current ? audio.current.currentTime.toFixed(3) : "";
      boxRef.current.dataset.word = String(p);
    }
    if (fill.current) fill.current.style.width = `${duration ? Math.min(100, (t.current / duration) * 100) : 0}%`;
  }, [starts, duration]);

  // New chapter: stop the sound, rewind, keep the voice preference.
  useEffect(() => {
    audio.current?.pause();
    t.current = 0;
    setPos(-1);
    setEnded(false);
    setPlaying(autoplay);
    paint();
  }, [chapter, autoplay, paint]);

  // Load and verify the narration when voice is turned on for this chapter.
  const wanted = voice !== "off";
  useEffect(() => {
    if (!wanted || !audioMeta) return;
    let alive = true;
    let url = "";
    setVoice("loading");
    loadAudio(audioMeta)
      .then((u) => {
        if (!alive) return URL.revokeObjectURL(u);
        url = u;
        const a = new Audio(u);
        a.preload = "auto";
        audio.current = a;
        a.currentTime = Math.min(t.current, duration);
        setVoice("on");
      })
      .catch(() => alive && setVoice("error"));
    return () => {
      alive = false;
      audio.current?.pause();
      audio.current = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [wanted, attempt, audioMeta, duration]);

  // Start or stop the sound when play state or voice changes. Always resume from the shared clock.
  useEffect(() => {
    const a = audio.current;
    if (!a || !voiceOn) return;
    if (playing) {
      if (Math.abs(a.currentTime - t.current) > 0.05) a.currentTime = t.current;
      a.play().catch(() => {
        setPlaying(false);
        setVoice("blocked");
      });
    } else a.pause();
  }, [playing, voiceOn]);

  // The clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000); // a hidden tab must not leap ahead
      last = now;
      const a = audio.current;
      if (voiceOn && a) {
        if (!a.paused || a.ended) t.current = a.currentTime;
      } else if (voice !== "loading") {
        t.current += dt;
      }
      if (t.current >= duration || (voiceOn && a?.ended)) {
        t.current = duration;
        paint();
        setPlaying(false);
        setEnded(true);
        onEndRef.current?.();
        return;
      }
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, voiceOn, voice, duration, paint]);

  // The lullaby: plays under the voice, pauses with it, fades slowly at the end.
  useEffect(() => {
    const want = playing && voiceOn && music;
    if (want) {
      if (!lullaby.current) lullaby.current = new Lullaby(seedOf(`${chapter.night} ${chapter.title}`));
      lullaby.current.play().catch(() => undefined);
    } else lullaby.current?.pause(ended ? 6 : 0.5);
  }, [playing, voiceOn, music, ended, chapter.night, chapter.title]);
  useEffect(() => {
    // New chapter, new tune.
    return () => {
      lullaby.current?.close();
      lullaby.current = null;
    };
  }, [chapter]);
  useEffect(() => {
    // Exposed for the browser test: is music sounding, and how loud.
    const id = setInterval(() => {
      const el = boxRef.current;
      if (!el) return;
      el.dataset.music = lullaby.current ? lullaby.current.state : "none";
      el.dataset.musicLevel = lullaby.current ? lullaby.current.level().toFixed(4) : "0";
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Keep the current word in view inside the reader only (never scroll the page).
  useEffect(() => {
    const box = readerRef.current;
    const el = box?.querySelector<HTMLElement>(".w.now");
    if (box && el) box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight * 0.4), behavior: "smooth" });
  }, [pos]);

  const seek = (to: number) => {
    setEnded(false);
    t.current = Math.max(0, Math.min(duration - 0.01, to));
    if (audio.current) audio.current.currentTime = t.current;
    paint();
  };
  const toggle = () => {
    if (t.current >= duration - 0.02) seek(0);
    setPlaying((p) => !p);
  };
  const toggleVoice = () => {
    if (voice === "off") {
      setVoicePref(true);
      setVoice("loading");
    }
    else if (voice === "error") setAttempt((n) => n + 1);
    else if (voice === "blocked") {
      setVoice("on");
      setPlaying(true);
    } else {
      audio.current?.pause();
      setVoicePref(false);
      setVoice("off");
    }
  };
  const barSeek = (e: PointerEvent<HTMLDivElement>) => {
    const r = bar.current?.getBoundingClientRect();
    if (r && r.width) seek(((e.clientX - r.left) / r.width) * duration);
  };
  const barKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const k: Record<string, number> = { ArrowRight: 5, ArrowLeft: -5, PageUp: 15, PageDown: -15 };
    if (e.key in k) {
      e.preventDefault();
      seek(t.current + k[e.key]);
    } else if (e.key === "Home") seek(0);
    else if (e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  const voiceLabel = { off: "Voice off", loading: "Loading voice", on: "Voice on", blocked: "Tap to play voice", error: "Voice failed" }[voice];

  return (
    <div className="box" ref={boxRef}>
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
        <AnimatePresence>
          {ended && (
            <motion.div className="the-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} role="status">
              <motion.svg width="64" height="64" viewBox="0 0 64 64" aria-hidden initial={{ scale: 0.6, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 80, damping: 12 }}>
                <path d="M44 10a24 24 0 1 0 10 34A20 20 0 0 1 44 10z" fill="var(--acc)" />
              </motion.svg>
              <p className="the-end-title">The end.</p>
              <p className="t-s">Goodnight{childName ? `, ${childName}` : ""}. Sleep tight.</p>
              <div className="row" style={{ justifyContent: "center" }}>
                <button className="btn sm" onClick={() => { seek(0); setPlaying(true); }}>Read it again</button>
                {endActions}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="reader" ref={readerRef} aria-live="off">
          {tokens.map((tk, i) =>
            tk.isWord ? (
              <span key={i} className={`w ${tk.w < pos ? "read" : ""} ${tk.w === pos ? "now" : ""}`} onClick={() => seek(starts[tk.w] - 0.02)} title="Read from here">{tk.text}</span>
            ) : (
              <span key={i}>{tk.text.includes("\n") ? <br /> : tk.text}</span>
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
        <div
          className="progress seekable"
          ref={bar}
          role="slider"
          tabIndex={0}
          aria-label="Reading position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(duration - left)}
          aria-valuetext={`${Math.round(duration - left)} of ${Math.round(duration)} seconds`}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); barSeek(e); }}
          onPointerMove={(e) => { if (e.buttons) barSeek(e); }}
          onKeyDown={barKeys}
        >
          <i ref={fill} />
        </div>
        <span className="t-xs num" style={{ minWidth: 44, textAlign: "right" }}>{left}s</span>
        {audioMeta && voice === "on" && (
          <button className={`chip ${music ? "acc" : ""}`} style={{ cursor: "pointer" }} onClick={() => { setMusicPref(!music); setMusic(!music); }} aria-pressed={music} title="A soft lullaby made in your browser, new for every story">
            {music ? "Music on" : "Music off"}
          </button>
        )}
        {audioMeta && (
          <button className={`chip ${voice === "on" || voice === "loading" ? "acc" : voice === "error" || voice === "blocked" ? "bad" : ""}`} style={{ cursor: "pointer" }} onClick={toggleVoice} aria-pressed={voice === "on"} title={`Narration: ${audioMeta.voice}, rendered offline`}>
            {voiceLabel}
          </button>
        )}
      </div>
    </div>
  );
}
