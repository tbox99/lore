"""Transport tests: no public-network requests or private diagnostic fixtures."""

import importlib.util
from email.message import Message
import http.client
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import quote


MODULE = Path(__file__).resolve().parents[1] / "serve.py"
SPEC = importlib.util.spec_from_file_location("lore_serve", MODULE)
serve = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(serve)


class FakeResponse(io.BytesIO):
    def __init__(self, body=b"<packages/>", length=None, encoding=None, status=200):
        super().__init__(body)
        self.status = status
        self.headers = Message()
        self.headers["Content-Type"] = "application/xml; charset=utf-8"
        if length is not None:
            self.headers["Content-Length"] = str(length)
        if encoding:
            self.headers["Content-Encoding"] = encoding


class UpstreamTests(unittest.TestCase):
    def fetch(self, response):
        opener = unittest.mock.Mock()
        opener.open.return_value = response
        with patch.object(serve, "build_opener", return_value=opener):
            result = serve.fetch_lenovo("/catalog/21MM_Win11.xml")
        return result

    def test_allowlist_only_accepts_catalog_or_text_metadata(self):
        good = ["/catalog/21MM_Win11.xml", "/catalog/21MM_Win10.xml", "/pccbbs/mobiles/n47uj14w_2_.xml", "/pccbbs/mobiles/n47uj14w.txt"]
        bad = ["https://evil.example/x", "//evil.example/x", "/catalog/21MM_Win7.xml", "/catalog/21MM_Win11.xml?x=1", "/pccbbs/mobiles/../x.xml", "/pccbbs/mobiles/a.exe", "/pccbbs/mobiles/a%2exml", "/pccbbs/mobiles/a.xml#x", "/pccbbs/mobiles/a.xml\n"]
        for path in good:
            with self.subTest(path=path):
                self.assertEqual(serve.validate_lenovo_path(path), path)
        for path in bad:
            with self.subTest(path=path), self.assertRaises(serve.TransportError):
                serve.validate_lenovo_path(path)

    def test_success_preserves_source_and_timestamp(self):
        result = self.fetch(FakeResponse(b"<packages count='0'/>", 21))
        self.assertEqual(result["url"], "https://download.lenovo.com/catalog/21MM_Win11.xml")
        self.assertEqual(result["text"], "<packages count='0'/>")
        self.assertTrue(result["retrievedAt"].endswith("+00:00"))

    def test_declared_oversized_response_is_rejected_before_read(self):
        response = FakeResponse(length=serve.MAX_UPSTREAM_BYTES + 1)
        with patch.object(response, "read1", side_effect=AssertionError("must not read")):
            with self.assertRaisesRegex(serve.TransportError, "too large"):
                self.fetch(response)

    def test_undeclared_oversized_response_is_bounded(self):
        with patch.object(serve, "MAX_UPSTREAM_BYTES", 10):
            with self.assertRaisesRegex(serve.TransportError, "too large"):
                self.fetch(FakeResponse(b"x" * 11))

    def test_short_response_is_not_success(self):
        with self.assertRaisesRegex(serve.TransportError, "incomplete"):
            self.fetch(FakeResponse(b"short", 100))

    def test_compressed_and_error_statuses_are_not_success(self):
        for response in [FakeResponse(encoding="gzip"), FakeResponse(status=404)]:
            with self.assertRaises(serve.TransportError):
                self.fetch(response)

    def test_redirects_are_never_followed(self):
        for target in ["https://evil.example/a", "https://download.lenovo.com/other.xml"]:
            with self.assertRaisesRegex(serve.TransportError, "redirect"):
                serve.NoRedirect().redirect_request(None, None, 302, "Found", {}, target)


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.web = cls.root / "web"
        cls.web.mkdir()
        (cls.web / "index.html").write_text("<!doctype html><title>LORE test</title>")
        (cls.web / "app.mjs").write_text("export const ready = true;")
        (cls.web / "secret.py").write_text("not a public asset")
        (cls.root / "outside.txt").write_text("outside secret")
        (cls.web / "escape.json").symlink_to(cls.root / "outside.txt")
        cls.server = serve.LoreServer(0, cls.web)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    def request(self, path, method="GET", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        result = (response.status, dict(response.getheaders()), response.read())
        connection.close()
        return result

    def test_ui_assets_have_correct_types_and_no_external_connections(self):
        status, headers, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"LORE test", body)
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("connect-src 'self'", headers["Content-Security-Policy"])
        status, headers, _ = self.request("/app.mjs")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/javascript; charset=utf-8")

    def test_api_requires_local_host_origin_and_header(self):
        for headers in [{}, {"X-LORE-Request": "wrong"}, {"X-LORE-Request": "1", "Host": "evil.example"}, {"X-LORE-Request": "1", "Origin": "https://evil.example"}, {"X-LORE-Request": "1", "Origin": "null"}, {"X-LORE-Request": "1", "Sec-Fetch-Site": "cross-site"}]:
            with self.subTest(headers=headers):
                self.assertEqual(self.request("/api/health", headers=headers)[0], 403)
        status, _, body = self.request("/api/health", headers={"X-LORE-Request": "1", "Origin": f"http://127.0.0.1:{self.port}"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["version"], "2.0.0-m0")

    def test_proxy_does_not_fetch_unapproved_routes(self):
        paths = ["/api/lenovo", "/api/lenovo?path=", "/api/lenovo?path=a&path=b", "/api/lenovo?path=%252Fcatalog%252F21MM_Win11.xml", "/api/lenovo?path=https%3A%2F%2Fevil.example%2Fa", "/api/lenovo?path=%2Fpccbbs%2Fmobiles%2Fa.exe"]
        with patch.object(serve, "fetch_lenovo", side_effect=AssertionError("must not fetch")):
            for path in paths:
                with self.subTest(path=path):
                    self.assertEqual(self.request(path, headers={"X-LORE-Request": "1"})[0], 400)

    def test_proxy_source_and_errors_are_explicit(self):
        path = "/api/lenovo?path=" + quote("/catalog/21MM_Win11.xml", safe="")
        envelope = {"url": "https://download.lenovo.com/catalog/21MM_Win11.xml", "retrievedAt": "test", "text": "<packages/>"}
        with patch.object(serve, "fetch_lenovo", return_value=envelope):
            status, _, body = self.request(path, headers={"X-LORE-Request": "1"})
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body), envelope)
        with patch.object(serve, "fetch_lenovo", side_effect=serve.TransportError("test timeout", 504)):
            status, _, body = self.request(path, headers={"X-LORE-Request": "1"})
            self.assertEqual(status, 504)
            self.assertEqual(json.loads(body), {"error": "test timeout"})

    def test_static_paths_never_escape_web_root(self):
        for path in ["/../outside.txt", "/%2e%2e/outside.txt", "/.git/config", "/escape.json", "/secret.py", "/core%5c..%5csecret.py", "/%FF"]:
            with self.subTest(path=path):
                status, _, body = self.request(path)
                self.assertIn(status, [400, 404])
                self.assertNotIn(b"outside secret", body)

    def test_post_and_options_are_not_enabled(self):
        for method in ["POST", "OPTIONS", "PUT"]:
            self.assertEqual(self.request("/api/health", method=method)[0], 405)


if __name__ == "__main__":
    unittest.main()
