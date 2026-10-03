# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""`nightjar serve`: the box in the house, as a page on the laptop.

The child taps a picture or types what she wants. The laptop writes the
chapter with local Gemma, screens it, narrates it with Kokoro and plays it
with words lit as they are spoken. One chapter, then the end. Nothing leaves
the machine.

Stdlib only. Binds to 127.0.0.1 and refuses any other Host header, so a web
page elsewhere cannot reach it through DNS rebinding. POSTs must be same
origin JSON with a small body.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import re
import secrets
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import guard, llm, narrate, sleeplog, story, tune
from .bible import Bible
from .config import OUT_DIR, PROJECT_ROOT, SETTINGS, Child, ensure_dirs

MAX_BODY = 4096
MAX_REQUEST_CHARS = 200
MAX_JOBS = 32
SLUG_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]{1,100}$")
JOB_RE = re.compile(r"^[0-9a-f]{16}$")
STATIC = PROJECT_ROOT / "web" / "dist"

_jobs: dict[str, dict] = {}
_busy = threading.Lock()
_jobs_lock = threading.Lock()


def _set(job: str, **kw) -> None:
    with _jobs_lock:
        _jobs[job].update(kw, updated=time.time())


def _chapter_payload(st: story.Story, child: Child) -> dict:
    feats = story.night_features(child, st).as_row()
    payload = {
        "night": st.night,
        "title": st.title,
        "text": st.text,
        "knobs": st.knobs.__dict__,
        "attempts": st.attempts,
        "rejected": st.rejected_drafts,
        "gen_ms": st.gen_ms,
        "eval_tokens": st.eval_tokens,
        "features": feats,
        "audio": None,
    }
    wav = OUT_DIR / "audio" / f"{st.slug}.wav"
    meta = wav.with_suffix(".words.json")
    if wav.exists() and meta.exists():
        m = json.loads(meta.read_text())
        words = m["words"]
        if len(words) == len(st.text.split()):
            dur = float(m["duration"])
            payload["audio"] = {
                "src": f"api/audio/{st.slug}.wav",
                "sha256": hashlib.sha256(wav.read_bytes()).hexdigest(),
                "voice": "Kokoro-82M af_heart",
                "duration": dur,
                "speech_wpm": round(len(words) / dur * 60, 1),
                "overall_wpm": round(len(words) / dur * 60, 1),
                "words": words,
            }
    return payload


def _run(job: str, request: str) -> None:
    try:
        child = Child.load()
        bible = Bible.load()
        _set(job, stage="tuning")
        rec = tune.recommend(cast_size=max(1, len(bible.cast_names()[:2])))
        knobs = rec.knobs
        # Her request leads. Old characters are offered as history, not forced in.
        knobs.cast = [] if request else bible.cast_names()[:2]
        _set(job, stage="writing", tuner=rec.explain(), soften=guard.screen_request(request, child.avoid))

        def attempt(n: int, last: list[str]) -> None:
            _set(job, stage="writing" if n == 1 else "rewriting", attempt=n, last_refusal=last)

        try:
            st = story.tonight(child, knobs, bible, request=request, on_attempt=attempt)
        except story.GuardRefused as refused:
            refused.save()
            _set(job, stage="refused", drafts=refused.drafts)
            return
        st.save()
        bible.save()
        sleeplog.append(st.night, st.title, story.night_features(child, st))
        if narrate.available() == "kokoro-local":
            _set(job, stage="narrating")
            narrate.narrate(st.text, None, st.slug, knobs.pace_wpm)
        _set(job, stage="done", chapter=_chapter_payload(st, child))
    except llm.LLMUnavailable as exc:
        _set(job, stage="error", error=f"The story model is not running. {exc}"[:300])
    except Exception as exc:  # report, never crash the server
        _set(job, stage="error", error=f"{type(exc).__name__}: {exc}"[:300])
    finally:
        _busy.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "nightjar"
    sys_version = ""

    def log_message(self, fmt, *args):  # quiet, and never log request bodies
        pass

    # ---------- plumbing ----------

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        port = self.server.server_address[1]
        return host in {f"127.0.0.1:{port}", f"localhost:{port}"}

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: dict) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json")

    def _body(self) -> dict | None:
        if (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/json":
            return None
        origin = self.headers.get("Origin")
        port = self.server.server_address[1]
        if origin and origin not in {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}:
            return None
        try:
            n = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            return None
        if not 0 < n <= MAX_BODY:
            return None
        try:
            data = json.loads(self.rfile.read(n))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None
        return data if isinstance(data, dict) else None

    # ---------- routes ----------

    def do_GET(self):  # noqa: N802
        if not self._host_ok():
            return self._json(HTTPStatus.MISDIRECTED_REQUEST, {"error": "wrong host"})
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            try:
                child = Child.load()
                who = {"name": child.name, "loves": child.loves[:8]}
            except Exception:
                who = {"name": "", "loves": []}
            return self._json(
                200,
                {
                    "ok": True,
                    "model": SETTINGS.model,
                    "ollama": llm.server_version() is not None,
                    "narration": narrate.available(),
                    "busy": _busy.locked(),
                    **who,
                },
            )
        if path.startswith("/api/job/"):
            job = path.rsplit("/", 1)[-1]
            with _jobs_lock:
                state = dict(_jobs.get(job, {})) if JOB_RE.match(job) else {}
            return self._json(200 if state else 404, state or {"error": "no such job"})
        if path.startswith("/api/audio/"):
            name = path.rsplit("/", 1)[-1]
            slug = name[:-4] if name.endswith(".wav") else ""
            f = OUT_DIR / "audio" / f"{slug}.wav"
            if not SLUG_RE.match(slug) or not f.is_file():
                return self._json(404, {"error": "no such audio"})
            return self._send(200, f.read_bytes(), "audio/wav")
        return self._static(path)

    def do_POST(self):  # noqa: N802
        if not self._host_ok():
            return self._json(HTTPStatus.MISDIRECTED_REQUEST, {"error": "wrong host"})
        data = self._body()
        if data is None:
            return self._json(400, {"error": "expected a small same origin JSON body"})
        if self.path == "/api/tonight":
            req = data.get("request", "")
            if not isinstance(req, str):
                return self._json(400, {"error": "request must be text"})
            req = " ".join(req.split())[:MAX_REQUEST_CHARS]
            if not _busy.acquire(blocking=False):
                return self._json(409, {"error": "already writing a story"})
            job = secrets.token_hex(8)
            with _jobs_lock:
                if len(_jobs) >= MAX_JOBS:
                    oldest = min(_jobs, key=lambda k: _jobs[k]["updated"])
                    _jobs.pop(oldest)
                _jobs[job] = {"stage": "queued", "request": req, "updated": time.time()}
            threading.Thread(target=_run, args=(job, req), daemon=True).start()
            return self._json(202, {"job": job})
        if self.path == "/api/asleep":
            m = data.get("minutes")
            if not isinstance(m, int) or isinstance(m, bool) or not 0 <= m <= 240:
                return self._json(400, {"error": "minutes must be a whole number from 0 to 240"})
            ok = sleeplog.record_asleep(m)
            return self._json(200 if ok else 409, {"ok": ok, "labelled": len(sleeplog.labelled())})
        return self._json(404, {"error": "not found"})

    def _static(self, path: str):
        root = STATIC.resolve()
        rel = path.lstrip("/") or "index.html"
        target = (root / rel).resolve()
        if (root not in target.parents) or not target.is_file():
            target = root / "index.html"
        if not target.is_file():
            return self._send(503, b"Build the site first: cd web && npm run build", "text/plain")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".mjs":
            ctype = "text/javascript"
        return self._send(200, target.read_bytes(), ctype, {"Cache-Control": "no-cache"})


def serve(port: int = 8765) -> None:
    ensure_dirs()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Nightjar box: http://127.0.0.1:{port}/#/ask   (local only, Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
