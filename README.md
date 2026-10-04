<!-- SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0 -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img alt="Nightjar: bedtime stories that learn what gets them to sleep" src="docs/assets/banner-light.svg">
</picture>

<p align="center">
  <a href="https://nightjar-bedtime.vercel.app"><b>Live site</b></a> ·
  <a href="https://dev.to/zkasuran/i-built-my-brother-a-bedtime-storyteller-that-runs-on-his-laptop-1lpf"><b>DEV post</b></a> ·
  <a href="#try-it-in-60-seconds">Try it</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#what-is-real-and-what-is-simulated">Real vs simulated</a> ·
  <a href="#built-to-be-attacked">Security</a> ·
  <a href="#run-it-locally">Run it</a>
</p>

<p align="center">
  <img alt="tests" src="https://img.shields.io/badge/tests-65%20python%20%2B%2016%20web-2ea44f">
  <img alt="npm audit" src="https://img.shields.io/badge/npm%20audit-0-2ea44f">
  <img alt="core deps" src="https://img.shields.io/badge/python%20core%20deps-0-2ea44f">
  <img alt="model" src="https://img.shields.io/badge/model-Gemma%203%2C%20local-f4c46a">
  <img alt="licence" src="https://img.shields.io/badge/licence-SAND--1.0-555">
</p>

Nightjar is a bedtime storyteller I built for my brother and his wife. Their kid is four and just started school. They would both tell you they are bad at bedtime stories.

So the kid taps a picture or says what tonight's story should be about. An open model on the laptop in their house writes it, short or long. A guardrail outside the model reads every word before anyone hears it. Then an offline voice reads it aloud over a soft lullaby made for that story, with each word lit as it is spoken. One chapter, then "The end. Goodnight."

The part other story generators skip: a grown-up taps once when the kid is asleep. A tabular model picks tomorrow's length, pace and calm level from those minutes. On the sample log TabPFN predicts a hidden night to within **0.62 minutes**, against 4.99 for guessing the average.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/ask-dark.png">
    <img alt="The ask page: picture tiles, short or long and a box to type a topic" src="docs/assets/ask-light.png" width="100%">
  </picture>
</p>

## What it does

| | |
|---|---|
| **The kid asks** | Eight picture tiles (turtle, moon, snow, friendly dragon, sleepy train, teddy, big school, the sea) or their own words. Short story or a long one in three parts. |
| **Scary turns gentle** | "A dragon that breathes fire" is not refused. The scary words are softened in the prompt and the output guardrail still decides. |
| **Read aloud, word by word** | Kokoro-82M narration rendered offline, a word clock from its timestamps, so pause, resume and tap-a-word stay in step. On a phone with no recording, the device's own voice. |
| **A new lullaby each night** | Composed live with Web Audio, seeded by the story, about 10 dB under the voice. Fades out after the end. |
| **Stops at the end** | One chapter, a goodnight card, "Read it again". Nothing plays on by itself. |
| **Learns what works** | One tap logs minutes to sleep. TabPFN scores 72 story settings for tomorrow. |
| **Stays home** | Gemma, Kokoro and the kid's details live on one laptop. `nightjar serve` only answers 127.0.0.1. |

## Try it in 60 seconds

| Step | Click | You will see |
|---|---|---|
| 1 | [Home](https://nightjar-bedtime.vercel.app), then **Voice off** to turn it on | A recorded chapter read aloud over a lullaby, each word lit as it is spoken. Tap any word to jump |
| 2 | [Ask for a story](https://nightjar-bedtime.vercel.app/#/ask), tap **Big school** | A new story written in your browser, screened, then read with your device's voice. Slow without WebGPU; the laptop box takes about three minutes |
| 3 | [Tuner](https://nightjar-bedtime.vercel.app/#/tuner), change a minutes value | All 72 settings rescored and tomorrow's pick moving |
| 4 | [Guardrail](https://nightjar-bedtime.vercel.app/#/guard), load "zero width bypass" | A hidden spelling of "monster" refused, with "Python agrees" |
| 5 | [Story](https://nightjar-bedtime.vercel.app/#/story), night 3 | A chapter that passed on the night and that a later rule now refuses |
| 6 | [Reports](https://nightjar-bedtime.vercel.app/#/reports) | What is real, what is sample and what does not work yet |

## How it works

```mermaid
sequenceDiagram
  participant K as Her request
  participant T as tune.py (TabPFN)
  participant B as bible.json
  participant G as gemma3 (Ollama, local)
  participant R as guard.py
  participant L as bedtime_log.csv
  K->>T: tonight
  T->>T: score 72 knob settings on every logged night
  T->>G: length, pace, calm, sequel
  B->>G: last night, loose threads, characters
  G->>R: draft
  R-->>G: refused, rewrite (up to 3)
  R->>K: accepted chapter, read aloud
  K->>L: one tap: minutes to asleep
  L->>T: next night
```

1. The tuner reads every labelled night and picks the knob setting with the lowest predicted minutes.
2. The series bible adds last night's chapter, the most relevant earlier ones and the loose thread.
3. Gemma writes locally. The parser repairs the almost-JSON a 1B model produces.
4. The guardrail normalises the text and checks banned words, her fear list, meta talk, leaked scaffolding and length, title included. Three failures means no new chapter and last night's is read again.
5. One tap logs the outcome. That row is tomorrow's training data.

| | |
|---|---|
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/tuner-dark.png"><img alt="tuner" src="docs/assets/tuner-light.png"></picture> The tuner, live | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/guard-dark.png"><img alt="guardrail" src="docs/assets/guard-light.png"></picture> The guardrail playground |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/story-dark.png"><img alt="story" src="docs/assets/story-light.png"></picture> Eight recorded nights | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/reports-dark.png"><img alt="reports" src="docs/assets/reports-light.png"></picture> Reports and limits |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/book-dark.png"><img alt="book" src="docs/assets/book-light.png"></picture> The week as a printable A5 book ([PDF](https://nightjar-bedtime.vercel.app/demo/book.pdf)) | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/phone-ask-dark.png"><img alt="phone" src="docs/assets/phone-ask-light.png" width="60%"></picture> On a phone |

## Privacy model

| Data | Lives in | Leaves the laptop |
|---|---|---|
| Name, age, loves, fear list | `data/child.json` | Never |
| Characters and chapter summaries | `data/bible.json` | Never |
| Minutes to sleep per night | `data/bedtime_log.csv` | Never |
| Tonight's chapter text | memory | Never with Kokoro. Only if you enable ElevenLabs narration |
| Lab requests and stories | your browser tab | Never. Only GETs for public model files |

## What the guardrail checks

| Rule | Example it caught while building |
|---|---|
| Length | 4 drafts under 60 words, rewritten |
| Prompt field read aloud | "Open thread: Maybe tomorrow the moon..." on two accepted chapters, added as a rule after reading the run back |
| Leaked scaffolding | Fenced JSON with `"title"` keys (earlier runs the same day) |
| Banned words after NFKC | `mon\u200bster`, full width `ｍｏｎｓｔｅｒ` |
| Her fear list, title included | "Thunder and the Moon's Light" |

## What is real and what is simulated

| What | Status | Source |
|---|---|---|
| Chapter text, titles, timings | Real | gemma3:1b, Ollama 0.35.1, CPU only, recorded 2026-10-03 |
| Guardrail verdicts and refused drafts | Real | `nightjar/guard.py`, drafts redacted |
| TabPFN predictions and leave one out | Real run | `tabpfn==2.2.1` on CPU, on the sample log |
| k-NN in the browser | Real run | TypeScript port, parity tested to 1e-6 |
| Gemma in the lab | Real run | your device |
| Child profile "Mira" | **Sample** | placeholder, not a real child |
| Minutes to sleep | **Sample** | written to exercise the tuner, never measured |
| Night dates | **Sequence** | one recording session |
| Lullaby under the voice | Real | Composed live in the browser with Web Audio, seeded per chapter so every story gets its own tune; about 10 dB under the narration |
| Narration and word timing | Real | Kokoro-82M `af_heart`, rendered offline, word clock from its token timestamps; ElevenLabs path present, not run |

## Architecture

```mermaid
flowchart LR
  subgraph Laptop
    CLI[nightjar.cli] --> ST[story.py] --> OL[(Ollama gemma3)]
    ST --> GU[guard.py]
    CLI --> TU[tune.py] --> TP[(TabPFN v2)]
    CLI --> FILES[(child.json, bible.json, bedtime_log.csv)]
    CLI --> BK[book.py A5]
    SV[nightjar serve 127.0.0.1] --> ST
    SV --> KO[(Kokoro-82M voice)]
  end
  subgraph Browser
    SITE[React site] --> FX[(demo fixtures, sha256 checked)]
    SITE --> SB[Storybox: one clock, voice, lullaby]
    SITE -->|ask| SV
    SITE --> W[Web Worker] --> ORT[ONNX Runtime, self hosted]
    W -->|GET weights once| HF[(huggingface.co)]
  end
  EX[scripts/export_demo.py] --> FX
  ST --> EX
```

## Run it locally

```bash
ollama serve & ollama pull gemma3:1b                 # 815 MB, CPU is fine
cp data/child.example.json data/child.json            # edit for your person
python3 -m nightjar.cli doctor
python3 -m nightjar.cli tonight "a story about the slow turtle"
python3 -m nightjar.cli tonight "my first day at big school" --long   # three parts
python3 -m nightjar.cli asleep 14                     # asleep in 14 minutes
python3 -m nightjar.cli tune
python3 -m nightjar.cli book

# the box: a page on the laptop where the kid taps a picture or types an idea
# (needs the site built once: cd web && npm ci && npm run build)
python3 -m nightjar.cli serve      # http://127.0.0.1:8765/#/ask, local only

# optional extras in one venv: TabPFN tuner (Built with PriorLabs-TabPFN), Kokoro narration, PDF book
python3 -m venv .venv-tts && .venv-tts/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv-tts/bin/pip install "tabpfn==2.2.1" "kokoro==0.9.4" "soundfile==0.13.1" "transformers<5" "weasyprint==66.0"
.venv-tts/bin/python -m nightjar.cli serve
```

Site: `cd web && npm ci && npm run dev`. Re-record the series with `scripts/record_series.sh` and re-export with `.venv/bin/python scripts/export_demo.py`.

## Built to be attacked

Model output and hand edited files are untrusted. The full threat model is in [SECURITY.md](SECURITY.md). One gate runs everything and CI runs the same script:

```bash
./verify.sh   # ruff lint and format, 65 python tests (unit and adversarial), stdlib-only check,
              # no em dashes, SPDX headers, tsc strict, 16 web tests (parity with Python, tamper),
              # vite build with CSP gate, npm audit 0, end to end CLI against a fake model
```

The end to end run drives the real CLI: an honest server gets one leaked draft refused and a clean chapter accepted, logged, tuned and bound. A long request gets three guarded parts stitched into one chapter. A hostile server gets every draft refused, nothing saved, exit 4 and a redacted audit record.

## Layout

```
nightjar/      config, llm, story, guard, bible, features, sleeplog, tune, narrate, kokoro_voice, book, serve, limits, cli
tests/         unit, adversarial (seeded fuzz, bypass, tampered files), local server, word clock
scripts/       record_series.sh, render_audio.py, export_demo.py, e2e.sh, fake_ollama.py
demo/          the recorded series: data, stories, series.log
web/           React + motion site, TS ports of guard and tuner, storybox with one clock, lullaby, Gemma worker, CSP plugin
```

## Roadmap

- [x] Local story loop with series bible and deterministic guardrail
- [x] TabPFN tuner with k-NN fallback, labelled backend
- [x] In-browser Gemma lab, offline after one download
- [x] The kid picks the topic: picture tiles or own words, short or long
- [x] Offline narration with a word clock, device voice on phones
- [x] A new lullaby for every story
- [x] Long stories in three guarded parts
- [x] Printable A5 PDF with WeasyPrint
- [ ] Real nights from my brother's kid (the only thing that can prove the tuner)
- [ ] Reading level ceiling in the guardrail
- [ ] Length control: Gemma 3 4B or a small fine-tune
- [ ] The physical one-button box

## Licence

Our files: `LicenseRef-zkasuran-SAND-1.0` (source available, no derivatives), see [LICENSE](LICENSE). Third party terms in [NOTICE](NOTICE) and [DATA-SOURCES.md](DATA-SOURCES.md). Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms. Built with PriorLabs-TabPFN.

Voice consent rules: [CONSENT.md](CONSENT.md).
