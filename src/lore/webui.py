"""LORE Web UI — PyWebView desktop application."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    import webview as pywebview
except ImportError:
    try:
        import pywebview
    except ImportError:
        pywebview = None

from .support_client import SupportClient


class LoreApi:
    """Python API exposed to the JavaScript frontend via PyWebView."""

    def __init__(self) -> None:
        self._client = SupportClient()
        self._window: Any = None

    def search(self, serial: str) -> str:
        """Search for a device by serial number.

        Returns JSON string with keys: success, product, drivers, warranty, error.
        """
        try:
            serial = serial.strip().upper()
            if not serial:
                return json.dumps({"success": False, "error": "Please enter a serial number"})

            # Fetch product info
            with self._client:
                products = self._client.lookup_product(serial)

            if not products:
                return json.dumps({"success": False, "error": f"No products found for serial: {serial}"})

            product = products[0]
            product_path = product.get("Id", "")

            # Fetch drivers
            driver_data: dict = {}
            if product_path:
                with self._client:
                    driver_data = self._client.get_drivers(product_path)

            # Fetch warranty
            warranty: dict = {}
            machine_type = SupportClient.extract_machine_type(product)
            if machine_type:
                try:
                    with self._client:
                        warranty = self._client.get_warranty(serial, machine_type)
                except Exception:
                    warranty = {}

            # Prepare webview data (no readme fetching — too slow for interactive use)
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

    def get_readme(self, readme_url: str) -> str:
        """Fetch release notes for a single driver readme URL.

        Runs in a background thread to avoid blocking the UI.
        """
        import threading
        result_holder = {"value": ""}
        done = threading.Event()

        def _fetch():
            try:
                from .webview import _fetch_readme_changes
                result_holder["value"] = _fetch_readme_changes(readme_url, self._client._client)
            except Exception:
                result_holder["value"] = ""
            done.set()

        t = threading.Thread(target=_fetch, daemon=True)
        t.start()
        # Wait up to 8 seconds
        done.wait(timeout=8.0)
        return result_holder["value"]


def start_webui() -> int:
    """Start the LORE desktop application.

    Returns 0 on success, 1 if pywebview is not installed.
    """
    if pywebview is None:
        print("PyWebView is required for GUI mode.")
        print("Install with: pip install pywebview")
        print("Or use: lore drivers <serial> --no-web  (for terminal output)")
        return 1

    api = LoreApi()

    # Load the HTML file
    html_path = Path(__file__).parent / "webui.html"
    html_url = html_path.as_uri()

    window = pywebview.create_window(
        "LORE — Lenovo Online Research & Equipment",
        html_url,
        js_api=api,
        width=1200,
        height=800,
        min_size=(600, 400),
    )
    api._window = window

    pywebview.start(debug=False)
    return 0