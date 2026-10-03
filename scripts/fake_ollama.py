#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""A stand in for Ollama so the end to end test runs anywhere, CI included.

It replays real reply shapes seen from gemma3:1b: a fenced JSON block whose
body leaks scaffolding (must be refused), then a clean chapter (must pass).
Mode "hostile" only ever returns refusable drafts.
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

GOOD = json.dumps(
    {
        "title": "[Pim and the Quiet Garden]",
        "text": " ".join(["Pim the Turtle walked slowly down the soft garden path."] * 9) + " Everyone was warm and safe and asleep.",
        "summary": "Pim walked the garden path.",
        "cast": ["Pim the Turtle"],
        "open_thread": "One leaf is still waiting.",
    }
)
LEAK = '```json\n{"title": "The Moon", "text": "Pim crawled slow.", \\"summary\\": "x"}\n```'
MONSTER = json.dumps({"title": "Night", "text": " ".join(["A monster waited by the gate."] * 15)})

MODE = sys.argv[2] if len(sys.argv) > 2 else "normal"
calls = {"n": 0}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send({"version": "fake-0"})

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        calls["n"] += 1
        if MODE == "hostile":
            reply = MONSTER if calls["n"] % 2 else LEAK
        else:
            reply = LEAK if calls["n"] % 2 else GOOD
        self._send({"response": reply, "eval_count": 120, "prompt_eval_count": 300, "total_duration": 1_000_000_000})


HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
