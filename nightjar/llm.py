# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Thin Ollama client.

Deliberately stdlib-only (urllib) so the project installs with zero pip
dependencies. Open weights plus no dependency tree is the whole pitch: this
has to run on a tired parent's laptop at 19:30 with the wifi down.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass

from .config import SETTINGS
from .limits import MAX_MODEL_REPLY_BYTES, MAX_TEXT_CHARS


class LLMUnavailable(RuntimeError):
    """Raised when the local model server cannot be reached."""


@dataclass
class Completion:
    text: str
    prompt_tokens: int = 0
    eval_tokens: int = 0
    duration_ms: int = 0

    @property
    def tokens_per_second(self) -> float:
        if not self.duration_ms:
            return 0.0
        return self.eval_tokens / (self.duration_ms / 1000)


def _post(path: str, payload: dict, timeout: int | None = None) -> dict:
    url = f"{SETTINGS.ollama_host.rstrip('/')}{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout or SETTINGS.request_timeout) as resp:
            raw = resp.read(MAX_MODEL_REPLY_BYTES + 1)
            if len(raw) > MAX_MODEL_REPLY_BYTES:
                raise LLMUnavailable(f"model reply over {MAX_MODEL_REPLY_BYTES} bytes")
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise LLMUnavailable("model reply is not a JSON object")
            return data
    except json.JSONDecodeError as exc:
        raise LLMUnavailable(f"model reply is not JSON ({exc})") from exc
    except urllib.error.URLError as exc:  # includes connection refused
        raise LLMUnavailable(f"cannot reach Ollama at {SETTINGS.ollama_host} ({exc}). Start it with: ollama serve") from exc


def generate(
    prompt: str,
    system: str = "",
    temperature: float = 0.8,
    num_predict: int = 700,
    model: str | None = None,
) -> Completion:
    """Single-turn generation against the local open-weight model."""
    payload = {
        "model": model or SETTINGS.model,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": num_predict},
    }
    data = _post("/api/generate", payload)
    return Completion(
        text=(data.get("response") or "").strip(),
        prompt_tokens=data.get("prompt_eval_count", 0),
        eval_tokens=data.get("eval_count", 0),
        duration_ms=int(data.get("total_duration", 0) / 1e6),
    )


def embed(texts: list[str]) -> list[list[float]] | None:
    """Optional embeddings. Returns None when no embed model is configured,
    which makes the series bible fall back to lexical retrieval."""
    if not SETTINGS.embed_model:
        return None
    try:
        data = _post("/api/embed", {"model": SETTINGS.embed_model, "input": texts})
    except LLMUnavailable:
        return None
    return data.get("embeddings")


_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)


def extract_json(text: str) -> dict | None:
    """Small models are unreliable at pure-JSON output; be forgiving."""
    if not isinstance(text, str) or len(text) > MAX_TEXT_CHARS * 2:
        return None
    match = _JSON_BLOCK.search(text)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except (json.JSONDecodeError, RecursionError):
        return None
    return parsed if isinstance(parsed, dict) else None


def server_version() -> str | None:
    """Used by `nightjar doctor`."""
    url = f"{SETTINGS.ollama_host.rstrip('/')}/api/version"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            raw = resp.read(MAX_MODEL_REPLY_BYTES + 1)
            if len(raw) > MAX_MODEL_REPLY_BYTES:
                raise LLMUnavailable(f"model reply over {MAX_MODEL_REPLY_BYTES} bytes")
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise LLMUnavailable("model reply is not a JSON object")
            return data.get("version")
    except Exception:
        return None
