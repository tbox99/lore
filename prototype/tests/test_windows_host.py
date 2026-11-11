"""Smoke-test the real Windows PowerShell 5.1 host, without changing its policy.

No public-network request is made: Lenovo tests use invalid paths and verify
that the proxy rejects them locally. This validates a Windows runner, not the
user's corporate execution policy or browser environment.
"""

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener


PROTOTYPE = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == "nt", "Requires Windows PowerShell 5.1 on Windows")
class WindowsHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.powershell = shutil.which("powershell.exe")
        if not cls.powershell:
            raise RuntimeError("Windows PowerShell powershell.exe is not installed")
        version = subprocess.run(
            [cls.powershell, "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
            check=True, capture_output=True, text=True, timeout=15,
        ).stdout.strip()
        if not version.startswith("5.1."):
            raise RuntimeError(f"Expected Windows PowerShell 5.1; observed {version!r}")
        print(f"Windows host runtime: PowerShell {version}", flush=True)

        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            cls.port = reservation.getsockname()[1]
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        # Disable proxies for this test client's loopback connection only. The
        # application retains its normal upstream proxy/TLS configuration.
        cls.opener = build_opener(ProxyHandler({}))
        cls.log = tempfile.TemporaryFile(mode="w+b")
        cls.process = None
        cls.addClassCleanup(cls.stop_host)
        cls.process = subprocess.Popen(
            [cls.powershell, "-NoProfile", "-File", str(PROTOTYPE / "Start-Lore.ps1"),
             "-NoBrowser", "-Port", str(cls.port)],
            cwd=PROTOTYPE,
            stdin=subprocess.DEVNULL,
            stdout=cls.log,
            stderr=subprocess.STDOUT,
        )
        deadline = time.monotonic() + 25
        last_error = None
        while time.monotonic() < deadline:
            if cls.process.poll() is not None:
                raise RuntimeError(f"PowerShell host exited with {cls.process.returncode}:\n{cls.read_log()}")
            try:
                status, _, body = cls.request("/api/health", headers={"X-LORE-Request": "1"})
                if status == 200 and json.loads(body).get("platform") == "powershell":
                    return
                last_error = f"Unexpected health response: HTTP {status}, {body[:500]!r}"
            except (OSError, URLError, TimeoutError, ValueError) as exc:
                last_error = str(exc)
            time.sleep(0.15)
        raise RuntimeError(f"PowerShell host did not become ready: {last_error}\n{cls.read_log()}")

    @classmethod
    def read_log(cls):
        cls.log.flush()
        cls.log.seek(0)
        return cls.log.read(65536).decode("utf-8", errors="replace")

    @classmethod
    def stop_host(cls):
        try:
            if cls.process is not None and cls.process.poll() is None:
                cls.process.terminate()
                try:
                    cls.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    cls.process.kill()
                    cls.process.wait(timeout=5)
            # -NoBrowser ensures the host creates no browser child process.
            # The owning process must release its listening socket on exit.
            with socket.socket() as probe:
                probe.settimeout(1)
                if probe.connect_ex(("127.0.0.1", cls.port)) == 0:
                    raise RuntimeError("PowerShell host port is still accepting connections after shutdown")
        finally:
            cls.log.close()

    @classmethod
    def request(cls, path, headers=None, method="GET"):
        request = Request(cls.base_url + path, headers=headers or {}, method=method)
        try:
            response = cls.opener.open(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            return response.status, dict(response.headers), response.read()

    def test_health_identifies_real_powershell_host(self):
        status, headers, body = self.request("/api/health", headers={"X-LORE-Request": "1"})
        self.assertEqual(status, 200)
        result = json.loads(body)
        self.assertEqual(result["platform"], "powershell")
        self.assertEqual(result["version"], "2.0.0-m0")
        self.assertIs(result["localOnly"], True)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")

    def test_static_html_and_modules_have_expected_types(self):
        status, headers, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"LORE", body)
        self.assertEqual(headers["Content-Type"], "text/html; charset=utf-8")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("connect-src 'self'", headers["Content-Security-Policy"])
        status, headers, body = self.request("/app.mjs")
        self.assertEqual(status, 200)
        self.assertGreater(len(body), 100)
        self.assertEqual(headers["Content-Type"], "text/javascript; charset=utf-8")

    def test_api_rejects_missing_header_and_foreign_origin_or_host(self):
        for headers in [
            {}, {"X-LORE-Request": "wrong"},
            {"X-LORE-Request": "1", "Host": "example.invalid"},
            {"X-LORE-Request": "1", "Origin": "https://example.invalid"},
            {"X-LORE-Request": "1", "Origin": "null"},
            {"X-LORE-Request": "1", "Sec-Fetch-Site": "cross-site"},
        ]:
            with self.subTest(headers=headers):
                self.assertEqual(self.request("/api/health", headers=headers)[0], 403)
        status, _, _ = self.request("/api/health", headers={"X-LORE-Request": "1", "Origin": self.base_url})
        self.assertEqual(status, 200)

    def test_unapproved_lenovo_paths_are_rejected_locally(self):
        for path in [
            "/api/lenovo", "/api/lenovo?path=", "/api/lenovo?path=a&path=b",
            "/api/lenovo?path=https%3A%2F%2Fexample.invalid%2Fa.xml",
            "/api/lenovo?path=%2Fpccbbs%2Fmobiles%2Fa.exe",
            "/api/lenovo?path=%252Fcatalog%252F21MM_Win11.xml",
            "/api/lenovo?path=%2Fpccbbs%2Fmobiles%2F..%2Fa.xml",
        ]:
            with self.subTest(path=path):
                status, _, body = self.request(path, headers={"X-LORE-Request": "1"})
                self.assertEqual(status, 400)
                self.assertIn("error", json.loads(body))

    def test_static_traversal_and_unknown_paths_are_not_served(self):
        for path in ["/%2e%2e/Start-Lore.ps1", "/.git/config", "/core%5c..%5cStart-Lore.ps1"]:
            with self.subTest(path=path):
                self.assertIn(self.request(path)[0], [400, 404])
        self.assertEqual(self.request("/api/not-a-route", headers={"X-LORE-Request": "1"})[0], 404)

    def test_post_is_not_enabled(self):
        status, _, body = self.request("/api/health", headers={"X-LORE-Request": "1"}, method="POST")
        self.assertEqual(status, 405)
        self.assertIn("error", json.loads(body))


if __name__ == "__main__":
    unittest.main()
