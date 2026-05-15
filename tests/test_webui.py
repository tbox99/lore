"""Tests for webui (HTTP server mode)."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.request import urlopen
from urllib.error import URLError

from lore.webui import LoreRequestHandler, start_webui, DEFAULT_PORT


# ---------------------------------------------------------------------------
# LoreRequestHandler._do_search tests
# ---------------------------------------------------------------------------

class TestLoreRequestHandlerSearch:
    def _make_handler(self, products=None, drivers=None, warranty=None):
        """Create a LoreRequestHandler-like object with mocked SupportClient."""
        handler = LoreRequestHandler.__new__(LoreRequestHandler)
        return handler

    def _mock_do_search(self, serial, products=None, drivers=None, warranty=None):
        """Call _do_search with mocked SupportClient."""
        mock_client = MagicMock()

        if products is not None:
            mock_client.lookup_product.return_value = products
        else:
            mock_client.lookup_product.return_value = [
                {
                    "Id": "LAPTOPS-AND-NETBOOKS/THINKPAD/PF4SQLH9",
                    "Name": "T14s Gen 4 Laptop (ThinkPad) - Type 21F9",
                    "Type": "Product.Serial",
                    "Mtm": "",
                }
            ]

        if drivers is not None:
            mock_client.get_drivers.return_value = drivers
        else:
            mock_client.get_drivers.return_value = {
                "body": {"DownloadItems": []}
            }

        if warranty is not None:
            mock_client.get_warranty.return_value = warranty
        else:
            mock_client.get_warranty.return_value = {}

        # Mock context manager
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        # _client for readme fetching
        mock_client._client = MagicMock()

        handler = LoreRequestHandler.__new__(LoreRequestHandler)

        with patch("lore.webui.SupportClient", return_value=mock_client):
            result_json = handler._do_search(serial)

        return json.loads(result_json)

    def test_empty_serial_returns_error(self):
        result = self._mock_do_search("  ")
        assert result["success"] is False
        assert "serial" in result["error"].lower() or "enter" in result["error"].lower()

    def test_successful_search(self):
        result = self._mock_do_search("PF4SQLH9")
        assert result["success"] is True
        assert result["serial"] == "PF4SQLH9"

    def test_product_info_in_result(self):
        result = self._mock_do_search("PF4SQLH9")
        assert result["product"]["name"] == "T14s Gen 4 Laptop (ThinkPad) - Type 21F9"

    def test_no_products_found(self):
        result = self._mock_do_search("NONEXIST", products=[])
        assert result["success"] is False
        assert "No products" in result["error"]

    def test_serial_uppercased(self):
        result = self._mock_do_search("pf4sqlh9")
        assert result["serial"] == "PF4SQLH9"

    def test_exception_returns_error(self):
        mock_client = MagicMock()
        mock_client.lookup_product.side_effect = RuntimeError("API down")
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        handler = LoreRequestHandler.__new__(LoreRequestHandler)
        with patch("lore.webui.SupportClient", return_value=mock_client):
            result_json = handler._do_search("PF4SQLH9")

        result = json.loads(result_json)
        assert result["success"] is False
        assert "API down" in result["error"]

    def test_warranty_failure_is_graceful(self):
        mock_client = MagicMock()
        mock_client.lookup_product.return_value = [
            {
                "Id": "LAPTOPS-AND-NETBOOKS/THINKPAD/PF4SQLH9",
                "Name": "T14s Gen 4 Laptop (ThinkPad) - Type 21F9",
                "Type": "Product.Serial",
                "Mtm": "",
            }
        ]
        mock_client.get_drivers.return_value = {"body": {"DownloadItems": []}}
        mock_client.get_warranty.side_effect = RuntimeError("Auth failed")
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client._client = MagicMock()

        handler = LoreRequestHandler.__new__(LoreRequestHandler)
        with patch("lore.webui.SupportClient", return_value=mock_client):
            result_json = handler._do_search("PF4SQLH9")

        result = json.loads(result_json)
        assert result["success"] is True
        assert result["warranty"] == {}

    def test_drivers_key_present(self):
        result = self._mock_do_search("PF4SQLH9")
        assert "drivers" in result
        assert "drivers" in result["drivers"]
        assert "categories" in result["drivers"]

    def test_with_driver_data(self):
        from conftest import SAMPLE_DRIVER_RESPONSE
        result = self._mock_do_search("PF4SQLH9", drivers=SAMPLE_DRIVER_RESPONSE)
        assert result["success"] is True
        assert len(result["drivers"]["drivers"]) == 3

    def test_with_warranty_data(self):
        from conftest import SAMPLE_WARRANTY_SUCCESS
        result = self._mock_do_search("PF4SQLH9", warranty=SAMPLE_WARRANTY_SUCCESS["data"])
        assert result["success"] is True
        assert "warrantyStatus" in result["warranty"]


# ---------------------------------------------------------------------------
# LoreRequestHandler._do_get_readme tests
# ---------------------------------------------------------------------------

class TestLoreRequestHandlerGetReadme:
    def test_success_returns_content(self):
        handler = LoreRequestHandler.__new__(LoreRequestHandler)
        with patch("lore.webview._fetch_readme_changes", return_value="<ul><li>Fix</li></ul>"):
            mock_client = MagicMock()
            mock_client._client = MagicMock()
            with patch("lore.webui.SupportClient", return_value=mock_client):
                result_json = handler._do_get_readme("https://example.com/readme.html")

        result = json.loads(result_json)
        assert result["success"] is True
        assert result["content"] == "<ul><li>Fix</li></ul>"

    def test_exception_returns_error(self):
        handler = LoreRequestHandler.__new__(LoreRequestHandler)
        with patch("lore.webview._fetch_readme_changes", side_effect=RuntimeError("fail")):
            mock_client = MagicMock()
            mock_client._client = MagicMock()
            with patch("lore.webui.SupportClient", return_value=mock_client):
                result_json = handler._do_get_readme("https://example.com/readme.html")

        result = json.loads(result_json)
        assert result["success"] is False
        assert result["content"] == ""
        assert "error" in result


# ---------------------------------------------------------------------------
# start_webui tests
# ---------------------------------------------------------------------------

class TestStartWebui:
    def test_port_conflict_returns_1(self):
        """If port is in use, start_webui should return 1."""
        import socket

        # Find a free port and occupy it
        blocker_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        blocker_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        blocker_sock.bind(("127.0.0.1", 0))
        test_port = blocker_sock.getsockname()[1]
        blocker_sock.listen(1)
        try:
            rc = start_webui(port=test_port)
            assert rc == 1
        finally:
            blocker_sock.close()

    def test_starts_server_and_serves_html(self):
        """Server starts and serves HTML on a custom port."""
        from http.server import HTTPServer

        class ReuseHTTPServer(HTTPServer):
            allow_reuse_address = True

        test_port = 28398
        server = ReuseHTTPServer(("127.0.0.1", test_port), LoreRequestHandler)
        srv_thread = threading.Thread(target=server.serve_forever, daemon=True)
        srv_thread.start()
        time.sleep(0.2)
        try:
            resp = urlopen(f"http://127.0.0.1:{test_port}/")
            html = resp.read().decode("utf-8")
            assert "LORE" in html
            assert "serial-input" in html
        finally:
            server.shutdown()
            server.server_close()


# ---------------------------------------------------------------------------
# HTTP endpoint integration tests
# ---------------------------------------------------------------------------

class TestHTTPEndpoints:
    @classmethod
    def setup_class(cls):
        """Start a test HTTP server on an ephemeral port."""
        from http.server import HTTPServer
        import socket

        # Find a free port
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        cls.test_port = s.getsockname()[1]
        s.close()

        cls.server = HTTPServer(("127.0.0.1", cls.test_port), LoreRequestHandler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.2)

    @classmethod
    def teardown_class(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_root_serves_html(self):
        resp = urlopen(f"http://127.0.0.1:{self.test_port}/")
        assert resp.status == 200
        content_type = resp.headers.get("Content-Type", "")
        assert "text/html" in content_type
        html = resp.read().decode("utf-8")
        assert "LORE" in html

    def test_index_html_serves_html(self):
        resp = urlopen(f"http://127.0.0.1:{self.test_port}/index.html")
        assert resp.status == 200
        html = resp.read().decode("utf-8")
        assert "LORE" in html

    def test_404_for_unknown_path(self):
        try:
            urlopen(f"http://127.0.0.1:{self.test_port}/nonexistent")
            assert False, "Should have raised URLError"
        except URLError as e:
            assert e.code == 404

    def test_api_search_empty_serial(self):
        resp = urlopen(f"http://127.0.0.1:{self.test_port}/api/search?serial=")
        assert resp.status == 200
        data = json.loads(resp.read().decode("utf-8"))
        assert data["success"] is False


# ---------------------------------------------------------------------------
# webui.html file tests
# ---------------------------------------------------------------------------

class TestWebuiHtml:
    def test_file_exists(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        assert html_path.exists(), "webui.html not found at expected path"

    def test_contains_search_input(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert 'id="serial-input"' in content
        assert 'id="search-btn"' in content

    def test_contains_product_info_section(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert 'id="product-info"' in content
        assert 'id="product-name"' in content

    def test_contains_driver_list(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert 'id="driver-list"' in content

    def test_contains_warranty_tab(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert 'id="tab-warranty"' in content
        assert 'id="warranty-content"' in content

    def test_contains_lore_branding(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert "LORE" in content
        assert "Lenovo Online Research" in content

    def test_uses_fetch_api(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert "fetch(" in content
        assert "/api/search" in content
        assert "/api/readme" in content

    def test_no_window_api_calls(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert "window.api.search" not in content
        assert "window.api.get_readme" not in content

    def test_self_contained_no_external_deps(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert "cdn.jsdelivr" not in content
        assert "unpkg.com" not in content

    def test_contains_dark_mode_css(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert "prefers-color-scheme" in content

    def test_contains_filter_bar(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert 'id="filter-input"' in content
        assert 'data-priority="Critical"' in content

    def test_contains_enter_key_support(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert "keydown" in content
        assert "Enter" in content

    def test_contains_loading_spinner(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert "spinner" in content
        assert 'id="loading"' in content