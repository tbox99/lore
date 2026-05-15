"""LORE Web UI — Local HTTP server for browser-based GUI."""

from __future__ import annotations

import json
import threading
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, parse_qs

from .support_client import SupportClient


# The HTML file to serve
_HTML_PATH = Path(__file__).parent / "webui.html"

# Default port
DEFAULT_PORT = 8199


class LoreRequestHandler(BaseHTTPRequestHandler):
    """HTTP handler for LORE web UI."""

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/" or parsed.path == "/index.html":
            # Serve the HTML UI
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            html = _HTML_PATH.read_text(encoding="utf-8")
            self.wfile.write(html.encode("utf-8"))

        elif parsed.path == "/api/search":
            # Search endpoint
            params = parse_qs(parsed.query)
            serial = params.get("serial", [""])[0]
            result = self._do_search(serial)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(result.encode("utf-8"))

        elif parsed.path == "/api/readme":
            # Readme endpoint
            params = parse_qs(parsed.query)
            url = params.get("url", [""])[0]
            result = self._do_get_readme(url)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(result.encode("utf-8"))

        else:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Not Found")

    def _do_search(self, serial: str) -> str:
        """Handle search request."""
        try:
            serial = serial.strip().upper()
            if not serial:
                return json.dumps({"success": False, "error": "Please enter a serial number"})

            client = SupportClient()

            # Fetch product info
            with client:
                products = client.lookup_product(serial)

            if not products:
                return json.dumps({"success": False, "error": f"No products found for serial: {serial}"})

            product = products[0]
            product_path = product.get("Id", "")

            # Fetch drivers (no readme — will be fetched on demand)
            driver_data: dict = {}
            if product_path:
                with client:
                    driver_data = client.get_drivers(product_path)

            # Fetch warranty
            warranty: dict = {}
            machine_type = SupportClient.extract_machine_type(product)
            if machine_type:
                try:
                    with client:
                        warranty = client.get_warranty(serial, machine_type)
                except Exception:
                    warranty = {}

            # Prepare webview data (NO readme fetching)
            from .webview import _prepare_webview_data
            webview_data = _prepare_webview_data(
                driver_data,
                product_info=product,
                serial=serial,
                no_readme=True,
            )

            result = {
                "success": True,
                "serial": serial,
                "product": {
                    "name": product.get("Name", "Unknown"),
                    "type": product.get("Type", ""),
                    "mtm": product.get("Mtm", ""),
                },
                "drivers": webview_data,
                "warranty": warranty if warranty else {},
            }
            return json.dumps(result)
        except Exception as e:
            return json.dumps({"success": False, "error": str(e)})

    def _do_get_readme(self, readme_url: str) -> str:
        """Handle readme fetch request."""
        try:
            from .webview import _fetch_readme_changes
            client = SupportClient()
            changes = _fetch_readme_changes(readme_url, client._client)
            return json.dumps({"success": True, "content": changes})
        except Exception as e:
            return json.dumps({"success": False, "content": "", "error": str(e)})

    def log_message(self, format, *args):
        """Suppress default request logging."""
        pass


def start_webui(port: int = DEFAULT_PORT) -> int:
    """Start the LORE web UI HTTP server and open browser.

    Returns 0 on success, 1 on error.
    """
    try:
        server = HTTPServer(("127.0.0.1", port), LoreRequestHandler)
    except OSError as e:
        print(f"Error: Could not start server on port {port}: {e}")
        print(f"Try a different port: lore web --port 8200")
        return 1

    # Start server in background thread
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    url = f"http://127.0.0.1:{port}"

    # Try to open in app mode (no browser chrome)
    from .webview import _open_browser_app_mode
    opened = _open_browser_app_mode(url)
    if not opened:
        webbrowser.open(url)

    print(f"LORE web UI running at {url}")
    print("Press Ctrl+C to stop")

    try:
        # Keep main thread alive
        server_thread.join()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()

    return 0