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

const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

/** The device's nicest English voice. Phones ship good ones; desktop Linux does not. */
function bestVoice(): SpeechSynthesisVoice | null {
  const vs = speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
  if (!vs.length) return null;
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|enhanced|premium|siri|samantha|karen|daniel|moira|aria|jenny|libby|sonia|google (us|uk) english/i.test(v.name) ? 10 : 0) +
    (/espeak|compact|robot|novelty|whisper|zarvox|bad news|bells|boing|bubbles|cellos|trinoids/i.test(v.name) ? -20 : 0) +
    (/en-(us|gb|au)/i.test(v.lang) ? 2 : 0) +
    (v.localService ? 1 : 0);
  return [...vs].sort((a, b) => score(b) - score(a))[0];
}

/** iOS only lets speech start inside a tap. Call this from any tap to unlock it. */
export function unlockSpeech(): void {
  if (!canSpeak()) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch {
    /* nothing to unlock */
  }
}

const SPEECH_RATE = 0.85;
const SPEECH_WORD_S = 0.42; // estimate per word at that rate, corrected by the engine's own events
const SENTENCE_GAP_S = 0.45;

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
  // Chapters written live in the browser have no recorded narration, so they
  // are read with the device's own voice, one sentence at a time.
  const speechMode = !audioMeta && canSpeak();
  // Sentence of every word, and each word's character offset inside its sentence.
  const sents = useMemo(() => {
    const sentOf: number[] = [];
    const offset: number[] = [];
    const texts: string[] = [];
    const first: number[] = [];
    let cur = "";
    let k = 0;
    tokens.forEach((tk, i) => {
      if (tk.isWord) {
        if (!cur) first.push(tk.w);
        offset[tk.w] = cur.length + (cur ? 1 : 0);
        sentOf[tk.w] = k;
        cur += (cur ? " " : "") + tk.text;
        const next = tokens[i + 1];
        if (/[.!?]["'\u2019\u201d)]*$/.test(tk.text) || !next || next.text.includes("\n")) {
          texts.push(cur);
          cur = "";
          k++;
        }
      }
    });
    if (cur) texts.push(cur);
    return { sentOf, offset, texts, first };
  }, [tokens]);
  const starts = useMemo(() => {
    if (audioMeta) return audioMeta.words.map((w) => w[0]);
    if (speechMode) {
      let t0 = 0.3;
      return Array.from({ length: nWords }, (_, w) => {
        if (w > 0 && sents.sentOf[w] !== sents.sentOf[w - 1]) t0 += SENTENCE_GAP_S;
        const s = t0;
        t0 += SPEECH_WORD_S;
        return s;
      });
    }
    const step = 60 / chapter.knobs.pace_wpm;
    return Array.from({ length: nWords }, (_, i) => 0.4 + i * step);
  }, [audioMeta, speechMode, sents, nWords, chapter.knobs.pace_wpm]);
  const duration = audioMeta?.duration ?? (starts.length ? starts[starts.length - 1] + (speechMode ? SPEECH_WORD_S : 60 / chapter.knobs.pace_wpm) + 0.4 : 0);

  const [playing, setPlaying] = useState(autoplay);
  const [voice, setVoice] = useState<VoiceState>(() => (voicePref() ? "loading" : "off"));
  const [speak, setSpeak] = useState(true); // device voice on, for live chapters
  const utt = useRef(0); // id of the current utterance; events from older ones are ignored
  const limit = useRef(Infinity); // the clock may not run past the sentence still being spoken
  const stuckSince = useRef(0);
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
  const speaking = speechMode && speak;

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
    utt.current++;
    limit.current = Infinity;
    if (canSpeak()) speechSynthesis.cancel();
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

  // ---------- device voice ----------
  const stopSpeech = useCallback(() => {
    utt.current++;
    limit.current = Infinity;
    if (canSpeak()) speechSynthesis.cancel();
  }, []);

  const finish = useCallback(() => {
    stopSpeech();
    t.current = duration;
    paint();
    setPlaying(false);
    setEnded(true);
    onEndRef.current?.();
  }, [stopSpeech, duration, paint]);

  const speakFrom = useCallback(
    (word: number) => {
      if (!canSpeak()) return;
      const id = ++utt.current;
      speechSynthesis.cancel();
      const w = Math.max(0, Math.min(nWords - 1, word));
      const k = sents.sentOf[w] ?? 0;
      const text = sents.texts[k] ?? "";
      const base = sents.offset[w] ?? 0;
      const nextFirst = sents.first[k + 1];
      t.current = starts[w];
      limit.current = nextFirst !== undefined ? starts[nextFirst] - 0.02 : duration - 0.02;
      stuckSince.current = 0;
      const u = new SpeechSynthesisUtterance(text.slice(base));
      const v = bestVoice();
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else u.lang = "en-US";
      u.rate = SPEECH_RATE;
      u.onboundary = (e) => {
        if (id !== utt.current || e.name === "sentence") return;
        const ci = base + e.charIndex;
        let hit = w;
        for (let i = w; i < nWords && sents.sentOf[i] === k; i++) if (sents.offset[i] <= ci) hit = i;
        t.current = Math.max(t.current, starts[hit]);
      };
      u.onend = () => {
        if (id !== utt.current) return;
        if (nextFirst === undefined) return finish();
        t.current = starts[nextFirst] - 0.01;
        setTimeout(() => id === utt.current && speakFrom(nextFirst), 250);
      };
      u.onerror = (e) => {
        if (id !== utt.current || e.error === "interrupted" || e.error === "canceled") return;
        utt.current++;
        limit.current = Infinity;
        setSpeak(false); // keep reading along silently
      };
      speechSynthesis.speak(u);
    },
    [nWords, sents, starts, duration, finish],
  );

  useEffect(() => {
    if (!canSpeak()) return;
    speechSynthesis.getVoices(); // starts the async voice list on Chrome
    return () => stopSpeech();
  }, [stopSpeech]);

  // Autoplay path (no tap): try to speak; the tap path calls speakFrom directly.
  useEffect(() => {
    if (!speaking) return;
    if (playing) {
      if (limit.current === Infinity) speakFrom(Math.max(0, wordAt(starts, t.current)));
    } else stopSpeech();
  }, [playing, speaking, speakFrom, stopSpeech, starts]);

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
      } else if (speaking && limit.current !== Infinity) {
        // Advance at the estimated pace but never past the sentence being spoken.
        if (t.current + dt < limit.current) {
          t.current += dt;
          stuckSince.current = 0;
        } else {
          t.current = limit.current;
          // An engine that never reports the end of a sentence must not freeze the story.
          stuckSince.current = stuckSince.current || now;
          if (now - stuckSince.current > 6000) {
            stuckSince.current = 0;
            const next = sents.first[(sents.sentOf[wordAt(starts, t.current)] ?? 0) + 1];
            if (next === undefined) return finish();
            speakFrom(next);
          }
        }
      } else if (voice !== "loading" && !speaking) {
        t.current += dt;
      }
      if ((!speaking && t.current >= duration) || (voiceOn && a?.ended)) {
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
  }, [playing, voiceOn, voice, duration, paint, speaking, sents, starts, finish, speakFrom]);

  // The lullaby: plays under the voice, pauses with it, fades slowly at the end.
  useEffect(() => {
    const want = playing && (voiceOn || speaking) && music;
    if (want) {
      if (!lullaby.current) lullaby.current = new Lullaby(seedOf(`${chapter.night} ${chapter.title}`));
      lullaby.current.play().catch(() => undefined);
    } else lullaby.current?.pause(ended ? 6 : 0.5);
  }, [playing, voiceOn, speaking, music, ended, chapter.night, chapter.title]);
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

  /** Everything that has to start inside the tap itself (iOS rules). */
  const startInTap = () => {
    if (music && (voiceOn || speaking)) {
      if (!lullaby.current) lullaby.current = new Lullaby(seedOf(`${chapter.night} ${chapter.title}`));
      lullaby.current.play().catch(() => undefined);
    }
    if (voiceOn && audio.current) {
      audio.current.currentTime = t.current;
      audio.current.play().catch(() => setVoice("blocked"));
    }
    if (speaking) speakFrom(Math.max(0, wordAt(starts, t.current + 0.001)));
  };
  const seek = (to: number, word?: number) => {
    setEnded(false);
    t.current = Math.max(0, Math.min(duration - 0.01, to));
    if (audio.current) audio.current.currentTime = t.current;
    if (speaking && playing) speakFrom(word ?? Math.max(0, wordAt(starts, t.current + 0.001)));
    paint();
  };
  const toggle = () => {
    if (t.current >= duration - 0.02) seek(0);
    if (playing) {
      setPlaying(false);
      return;
    }
    startInTap();
    setPlaying(true);
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
                <button className="btn sm" onClick={() => { seek(0); startInTap(); setPlaying(true); }}>Read it again</button>
                {endActions}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="reader" ref={readerRef} aria-live="off">
          {tokens.map((tk, i) =>
            tk.isWord ? (
              <span key={i} className={`w ${tk.w < pos ? "read" : ""} ${tk.w === pos ? "now" : ""}`} onClick={() => seek(starts[tk.w] - 0.02, tk.w)} title="Read from here">{tk.text}</span>
            ) : (
              <span key={i}>{/\n\s*\n/.test(tk.text) ? <span className="para-gap" /> : tk.text.includes("\n") ? <br /> : tk.text}</span>
            ),
          )}
        </div>
      </div>
      <div className="box-foot">
        <button className={`play ${!playing && !ended && t.current === 0 ? "pulse" : ""}`} onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
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
        {speechMode && (
          <button className={`chip ${speak ? "acc" : ""}`} style={{ cursor: "pointer" }} onClick={() => { if (speak) { stopSpeech(); setSpeak(false); } else { setSpeak(true); if (playing) speakFrom(Math.max(0, wordAt(starts, t.current + 0.001))); } }} aria-pressed={speak} title="Read aloud with this device's voice">
            {speak ? "Voice on" : "Voice off"}
          </button>
        )}
        {((audioMeta && voice === "on") || speaking) && (
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
