#!/usr/bin/env python3
"""LORE M0 loopback transport. Diagnostic archives never pass through this server."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import socket
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import webbrowser


VERSION = "2.0.0-m0"
UPSTREAM_HOST = "https://download.lenovo.com"
MAX_UPSTREAM_BYTES = 8 * 1024 * 1024
MAX_STATIC_BYTES = 16 * 1024 * 1024
UPSTREAM_TIMEOUT = 20
PATH_PATTERN = re.compile(
    r"(?:/catalog/[A-Za-z0-9]{4}_Win(?:10|11)\.xml|"
    r"/pccbbs/mobiles/[A-Za-z0-9_.-]+\.(?:xml|txt|html))\Z"
)
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".zip": "application/zip",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
    "base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
)


class TransportError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def validate_lenovo_path(path: str) -> str:
    # Reject ambiguity, even if a percent-encoded path would decode to an allowed one.
    if not isinstance(path, str) or len(path) > 240 or ".." in path or not PATH_PATTERN.fullmatch(path):
        raise TransportError("Dieser Lenovo-Pfad ist nicht zugelassen.", 400)
    return path


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise TransportError("Lenovo antwortet mit einer Weiterleitung; sie wurde nicht verfolgt.")


def fetch_lenovo(path: str) -> dict:
    url = UPSTREAM_HOST + validate_lenovo_path(path)
    request = Request(url, headers={
        "User-Agent": "LORE-M0/2.0 (local diagnostic metadata viewer)",
        "Accept": "application/xml,text/plain,text/html;q=0.9,*/*;q=0.1",
        "Accept-Encoding": "identity",
    })
    started = time.monotonic()
    try:
        # The default HTTPS handler verifies certificates; the default proxy handler
        # honours normal platform/environment proxy settings.
        with build_opener(NoRedirect()).open(request, timeout=UPSTREAM_TIMEOUT) as response:
            if response.status != 200:
                raise TransportError(f"Lenovo meldet HTTP {response.status}.")
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise TransportError("Nicht unterstuetzte Komprimierung der Lenovo-Antwort.")
            length = response.headers.get("Content-Length")
            if length is not None:
                try:
                    if int(length) < 0 or int(length) > MAX_UPSTREAM_BYTES:
                        raise TransportError("Die Lenovo-Antwort ist zu gross.")
                except ValueError as exc:
                    raise TransportError("Ungueltige Laengenangabe in der Lenovo-Antwort.") from exc
            chunks, size = [], 0
            read = getattr(response, "read1", response.read)
            while True:
                if time.monotonic() - started > UPSTREAM_TIMEOUT:
                    raise TransportError("Zeitlimit beim Lenovo-Abruf erreicht.", 504)
                chunk = read(min(64 * 1024, MAX_UPSTREAM_BYTES + 1 - size))
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPSTREAM_BYTES:
                    raise TransportError("Die Lenovo-Antwort ist zu gross.")
                chunks.append(chunk)
            raw = b"".join(chunks)
            if length is not None and size != int(length):
                raise TransportError("Die Lenovo-Antwort wurde unvollstaendig uebertragen.")
            charset = response.headers.get_content_charset() or "utf-8-sig"
            try:
                text = raw.decode(charset, errors="replace")
            except LookupError:
                text = raw.decode("utf-8-sig", errors="replace")
    except TransportError:
        raise
    except HTTPError as exc:
        raise TransportError(f"Lenovo meldet HTTP {exc.code}. Bitte Quelle und Netzwerk pruefen.") from exc
    except (TimeoutError, socket.timeout) as exc:
        raise TransportError("Zeitlimit beim Lenovo-Abruf erreicht.", 504) from exc
    except (URLError, OSError) as exc:
        raise TransportError("Lenovo ist nicht erreichbar. Verbindung, Proxy und Zertifikate pruefen.") from exc
    return {"url": url, "retrievedAt": datetime.now(timezone.utc).isoformat(), "text": text}


class LoreServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, port: int, web_root: Path | None = None):
        self.web_root = (web_root or Path(__file__).parent / "web").resolve(strict=True)
        super().__init__(("127.0.0.1", port), LoreHandler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(5)
        return connection, address


class LoreHandler(BaseHTTPRequestHandler):
    server_version = "LORE-M0"
    sys_version = ""

    def log_message(self, format, *args):
        # Avoid writing serial numbers or local-file paths if a client sends them.
        pass

    def _send(self, status: int, body: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, status: int, value: dict):
        self._send(status, json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _error(self, status: int, message: str):
        self._json(status, {"error": message})

    def _valid_origin(self) -> bool:
        authority = f"127.0.0.1:{self.server.server_port}"
        # Multiple Host/Origin values are rejected, not collapsed.
        if self.headers.get_all("Host", []) != [authority]:
            return False
        origins = self.headers.get_all("Origin", [])
        if origins and origins != [f"http://{authority}"]:
            return False
        return self.headers.get("Sec-Fetch-Site", "") not in {"cross-site", "same-site"}

    def do_GET(self):
        if not self._valid_origin():
            return self._error(403, "Nur Anfragen von der lokalen LORE-Oberflaeche sind erlaubt.")
        if len(self.path) > 1024 or not self.path.startswith("/") or self.path.startswith("//"):
            return self._error(400, "Ungueltiger Anfragepfad.")
        route = urlsplit(self.path)
        if route.fragment:
            return self._error(400, "Fragmente sind nicht erlaubt.")
        if route.path.startswith("/api/"):
            if self.headers.get_all("X-LORE-Request", []) != ["1"]:
                return self._error(403, "Die Anfrage muss aus der LORE-Oberflaeche kommen.")
            if route.path == "/api/health" and not route.query:
                return self._json(200, {"version": VERSION, "platform": "python", "localOnly": True})
            if route.path != "/api/lenovo":
                return self._error(404, "Unbekannte API-Adresse.")
            try:
                query = parse_qs(route.query, strict_parsing=True, keep_blank_values=True, max_num_fields=2)
                if set(query) != {"path"} or len(query["path"]) != 1:
                    raise ValueError("exactly one path required")
                result = fetch_lenovo(validate_lenovo_path(query["path"][0]))
                return self._json(200, result)
            except ValueError:
                return self._error(400, "Genau ein Lenovo-Pfad wird benoetigt.")
            except TransportError as exc:
                return self._error(exc.status, str(exc))
        if route.query:
            return self._error(400, "Abfrageparameter sind hier nicht erlaubt.")
        try:
            decoded = unquote(route.path, errors="strict")
        except UnicodeDecodeError:
            return self._error(400, "Ungueltige Kodierung im Dateipfad.")
        if "\\" in decoded or "\x00" in decoded or any(part in {".", ".."} or part.startswith(".") for part in decoded.split("/") if part):
            return self._error(400, "Ungueltiger Dateipfad.")
        relative = "index.html" if decoded == "/" else decoded.lstrip("/")
        candidate = self.server.web_root / relative
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(self.server.web_root)
            if not resolved.is_file() or resolved.suffix.lower() not in STATIC_TYPES:
                return self._error(404, "Datei nicht gefunden.")
            if resolved.stat().st_size > MAX_STATIC_BYTES:
                return self._error(413, "Die statische Datei ist zu gross.")
            body = resolved.read_bytes()
        except (ValueError, OSError, RuntimeError):
            return self._error(404, "Datei nicht gefunden.")
        self._send(200, body, STATIC_TYPES[resolved.suffix.lower()])

    def _method_not_allowed(self):
        self._error(405, "Diese Methode wird nicht unterstuetzt.")

    do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = _method_not_allowed


def main() -> None:
    parser = argparse.ArgumentParser(description="Start LORE M0 locally (Python 3.10+).")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("--port must be between 1024 and 65535")
    try:
        server = LoreServer(args.port)
    except OSError as exc:
        parser.exit(1, f"LORE kann Port {args.port} nicht oeffnen: {exc}\n")
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"LORE M0: {url}\nBeenden: Ctrl+C. CDAT-Dateien bleiben im Browser.", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
