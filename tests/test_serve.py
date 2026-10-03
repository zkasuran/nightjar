# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""The local box server: only this machine, only same origin, small bodies, no traversal."""

import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer

from nightjar import serve


class TestServe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = {"Host": f"127.0.0.1:{self.port}", **(headers or {})}
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        if data is not None:
            h.setdefault("Content-Type", "application/json")
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        out = r.status, r.read(), dict(r.getheaders())
        c.close()
        return out

    def test_health_answers_locally(self):
        code, body, headers = self.req("GET", "/api/health")
        self.assertEqual(code, 200)
        self.assertTrue(json.loads(body)["ok"])
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_dns_rebinding_host_is_refused(self):
        code, _, _ = self.req("GET", "/api/health", headers={"Host": "evil.example:80"})
        self.assertEqual(code, 421)

    def test_cross_origin_post_is_refused(self):
        code, _, _ = self.req("POST", "/api/asleep", {"minutes": 5}, {"Origin": "https://evil.example"})
        self.assertEqual(code, 400)

    def test_non_json_and_oversized_bodies_are_refused(self):
        self.assertEqual(self.req("POST", "/api/asleep", b"minutes=5", {"Content-Type": "application/x-www-form-urlencoded"})[0], 400)
        self.assertEqual(self.req("POST", "/api/tonight", {"request": "x" * 9000})[0], 400)
        self.assertEqual(self.req("POST", "/api/tonight", b"[1,2]")[0], 400)

    def test_bad_values_are_refused(self):
        self.assertEqual(self.req("POST", "/api/tonight", {"request": 42})[0], 400)
        for m in (-1, 241, "5", True, 2.5):
            self.assertEqual(self.req("POST", "/api/asleep", {"minutes": m})[0], 400, m)

    def test_path_traversal_and_bad_ids(self):
        for p in ("/api/audio/..%2f..%2fetc%2fpasswd.wav", "/api/audio/../../x.wav", "/api/job/../../etc", "/api/job/zz"):
            self.assertEqual(self.req("GET", p)[0], 404, p)
        code, body, _ = self.req("GET", "/../../../../etc/passwd")
        self.assertNotIn(b"root:", body)


if __name__ == "__main__":
    unittest.main()
