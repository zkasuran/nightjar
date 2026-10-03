<!-- SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0 -->
# Nightjar security model

Model output is untrusted input. Hand edited files are untrusted input. Our own published fixtures
are untrusted once they leave the build.

| Attacker | Attack | Defence | Where | Test |
|---|---|---|---|---|
| The model | Frightening content read to a child | Deterministic guardrail on output, title included, rewrite or refuse | `nightjar/guard.py`, `nightjar/story.py` | `tests/test_nightjar.py::TestGuard` |
| The model | Leaked JSON or code fences read aloud | Field repair in the parser, then a scaffolding rule in the guardrail | `story._repair_fields`, `guard.SCAFFOLDING` | `test_repairs_broken_escaping`, `test_blocks_raw_json_scaffolding` |
| The model | Every draft fails | `GuardRefused` carries redacted drafts, CLI re-reads last night's chapter, exit 4 | `story.GuardRefused`, `cli.cmd_tonight` | recorded in `demo/series.log` (nights 3 and 8 in the first run) |
| The model | Loops or returns megabytes | Reply byte ceiling, text ceiling, title cap, deep JSON nesting caught | `nightjar/limits.py`, `llm.py` | `test_adversarial.py::TestFuzz` |
| Anyone typing | Spell a banned word with zero width, full width or case tricks | NFKC, invisible character strip, apostrophe fold, lowercase before matching | `guard.normalise`, `web/src/lib/guard.ts` | `TestGuardBypass`, `web/test/adversarial.test.mjs` |
| A typo | Malformed `child.json`, `bible.json` or CSV breaks bedtime | Bounded reads, typed validation, bad rows skipped, clear errors | `config.Child.load`, `bible.Bible.load`, `sleeplog` | `TestTamperedFiles` |
| Network | Tampered or oversized site fixtures | sha256 manifest checked with WebCrypto, 2 MB ceiling, 8 s timeout, shape validation | `web/src/lib/data.ts` | `web/test/adversarial.test.mjs` |
| Web attacker | Script injection, framing, CDN compromise | Build time CSP (`default-src 'none'`, theme script by hash), no innerHTML anywhere, ORT self hosted, `frame-ancestors 'none'` header | `web/vite.config.ts`, `web/vercel.json`, `web/scripts/check-dist.mjs` | `check-dist.mjs` in the build, headless Chrome run with zero CSP violations |
| Web attacker | Route parameter injection | Hash segments matched against `^[a-z0-9-]{0,32}$` before use | `web/src/lib/router.ts` | untested beyond the 404 route in the browser run |
| The lab | Load an arbitrary model id | Worker only loads two allow listed repo ids | `web/src/workers/gemma.ts` | untested |
| Network | Tampered narration MP3 | sha256 from the verified fixture checked before a blob: URL is made, 4 MB ceiling, 20 s timeout | `web/src/lib/data.ts` `loadAudio` | `web/test/adversarial.test.mjs` |
| Secrets | ElevenLabs key in argv or logs | Read from `ELEVENLABS_API_KEY` env only, never printed | `nightjar/config.py`, `narrate.py` | untested |

## Known limits

* The guardrail is a word list. It catches words, not ideas. A sad story with no banned word passes.
* It does not check reading level. A recorded chapter scored grade 9 for a four year old.
* The tuner has only seen sample data. Nothing here shows it helps a real child.
* The browser lab trusts the Hugging Face hub to serve the published weights; there is no pinned hash.
* Voice cloning through ElevenLabs is wired but was never exercised.

## Supply chain

Direct npm dependencies pinned exactly, `package-lock.json` committed, `npm audit` at 0 in `./verify.sh`.
The Python core has no third party dependencies. The optional tuner pins `tabpfn==2.2.1`.
