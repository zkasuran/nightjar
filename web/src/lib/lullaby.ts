// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// A lullaby made on the spot with the Web Audio API. No recordings, no
// licences to chase, nothing downloaded. Each chapter seeds its own tune
// (key, chord loop and melody), so every story gets new music.
//
// Sound: a soft pad on the chords, a music box picking out a slow pentatonic
// line, a low root note, all through a gentle generated reverb. It sits far
// under the voice and fades away when the story ends.

export const MUSIC_LEVEL = 0.3; // about 15 dB under the narration, like a film score under dialogue

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Diatonic triads in a major key, as semitone offsets from the tonic. */
const DEGREE: Record<string, number[]> = {
  I: [0, 4, 7],
  ii: [2, 5, 9],
  iii: [4, 7, 11],
  IV: [5, 9, 12],
  V: [7, 11, 14],
  vi: [9, 12, 16],
};
const LOOPS = [
  ["I", "vi", "IV", "V"],
  ["I", "IV", "I", "V"],
  ["I", "iii", "IV", "I"],
  ["vi", "IV", "I", "V"],
  ["I", "V", "vi", "IV"],
  ["IV", "I", "ii", "V"],
];
const PENTA = [0, 2, 4, 7, 9];

export interface Tune {
  tonic: number; // midi
  loop: string[];
  bpm: number;
  melody: Array<number | null>; // pentatonic step per beat, null = rest; 16 beats
}

/** Deterministic tune for a chapter. Exported for tests. */
export function compose(seed: number): Tune {
  const r = rng(seed);
  const tonics = [60, 62, 63, 65, 67, 58]; // C D Eb F G Bb, all gentle keys
  const tonic = tonics[Math.floor(r() * tonics.length)];
  const loop = LOOPS[Math.floor(r() * LOOPS.length)];
  const bpm = 58 + Math.floor(r() * 10);
  const melody: Array<number | null> = [];
  let step = 2 + Math.floor(r() * 3);
  for (let b = 0; b < 16; b++) {
    if (b % 4 === 3 || r() < 0.3) {
      melody.push(null);
      continue;
    }
    step = Math.max(0, Math.min(9, step + [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)]));
    melody.push(step);
  }
  melody[15] = null;
  return { tonic, loop, bpm, melody };
}

function impulse(ctx: BaseAudioContext, seconds = 3.2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const r = rng(7);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * (1 - i / len) ** 2.6;
  }
  return buf;
}

export class Lullaby {
  private ctx: AudioContext;
  private master: GainNode;
  private bus: GainNode;
  private analyser: AnalyserNode;
  private timer: number | null = null;
  private nextBeat = 0;
  private beat = 0;
  private tune: Tune;
  private live = new Set<AudioScheduledSourceNode>();
  private stopping = 0;

  constructor(seed: number) {
    this.ctx = new AudioContext({ latencyHint: "playback" });
    this.tune = compose(seed);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(this.analyser).connect(this.ctx.destination);

    // Dry plus reverb, then a gentle lowpass so nothing is bright or sharp.
    const tone = this.ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2600;
    tone.Q.value = 0.4;
    tone.connect(this.master);
    const verb = this.ctx.createConvolver();
    verb.buffer = impulse(this.ctx);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.45;
    verb.connect(wet).connect(tone);
    this.bus = this.ctx.createGain();
    this.bus.gain.value = 0.7;
    this.bus.connect(tone);
    this.bus.connect(verb);
  }

  get state(): AudioContextState {
    return this.ctx.state;
  }

  /** RMS of what is coming out right now, 0 to 1. For tests and meters. */
  level(): number {
    const a = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(a);
    let s = 0;
    for (const v of a) s += v * v;
    return Math.sqrt(s / a.length);
  }

  async play(): Promise<void> {
    if (this.stopping) {
      clearTimeout(this.stopping);
      this.stopping = 0;
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(MUSIC_LEVEL, now + 1.6);
    if (this.timer == null) {
      // After a pause, restart on a bar line so the chord comes straight back
      // instead of waiting out a silent half bar.
      this.beat = Math.ceil(this.beat / 4) * 4;
      this.nextBeat = now + 0.08;
      this.timer = window.setInterval(() => this.schedule(), 90);
      this.schedule();
    }
  }

  /** Fade out, then stop scheduling. `seconds` is long at the end of a story. */
  pause(seconds = 0.5): void {
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + seconds);
    if (this.stopping) clearTimeout(this.stopping);
    this.stopping = window.setTimeout(() => {
      this.stopping = 0;
      if (this.timer != null) clearInterval(this.timer);
      this.timer = null;
      for (const n of this.live) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      }
      this.live.clear();
      this.ctx.suspend().catch(() => undefined);
    }, seconds * 1000 + 60);
  }

  close(): void {
    if (this.timer != null) clearInterval(this.timer);
    if (this.stopping) clearTimeout(this.stopping);
    this.ctx.close().catch(() => undefined);
  }

  private schedule(): void {
    const spb = 60 / this.tune.bpm;
    while (this.nextBeat < this.ctx.currentTime + 0.6) {
      this.playBeat(this.beat, this.nextBeat, spb);
      this.nextBeat += spb;
      this.beat++;
    }
  }

  private playBeat(beat: number, t: number, spb: number): void {
    const { tonic, loop, melody } = this.tune;
    const bar = Math.floor(beat / 4) % loop.length;
    const chord = DEGREE[loop[bar]];
    if (beat % 4 === 0) {
      for (const off of chord) this.pad(midiHz(tonic - 12 + off), t, spb * 4);
      this.bass(midiHz(tonic - 24 + chord[0]), t, spb * 4);
    }
    const step = melody[beat % 16];
    if (step != null) {
      const oct = Math.floor(step / 5);
      this.musicBox(midiHz(tonic + 12 * oct + PENTA[step % 5]), t + (beat % 2 ? spb * 0.04 : 0));
    }
  }

  private track<T extends AudioScheduledSourceNode>(n: T, end: number): T {
    this.live.add(n);
    n.onended = () => this.live.delete(n);
    n.stop(end);
    return n;
  }

  private pad(hz: number, t: number, dur: number): void {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.055, t + dur * 0.35);
    env.gain.linearRampToValueAtTime(0.045, t + dur * 0.8);
    env.gain.linearRampToValueAtTime(0, t + dur * 1.15);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    env.connect(lp).connect(this.bus);
    for (const detune of [-6, 6]) {
      const o = this.ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = hz;
      o.detune.value = detune;
      o.connect(env);
      o.start(t);
      this.track(o, t + dur * 1.2);
    }
  }

  private bass(hz: number, t: number, dur: number): void {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.07, t + 0.4);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    env.connect(this.bus);
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = hz;
    o.connect(env);
    o.start(t);
    this.track(o, t + dur + 0.05);
  }

  private musicBox(hz: number, t: number): void {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.09, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0006, t + 2.6);
    env.connect(this.bus);
    // A bell: the fundamental plus a quiet, quickly fading high partial.
    const parts: Array<[number, number, number]> = [[1, 1, 2.6], [4.01, 0.18, 0.5], [2, 0.12, 1.2]];
    for (const [mult, amp, decay] of parts) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
      g.connect(env);
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = hz * mult;
      o.connect(g);
      o.start(t);
      this.track(o, t + decay + 0.05);
    }
  }
}
