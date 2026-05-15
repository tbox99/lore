"""Tests for webui (PyWebView GUI mode)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from lore.webui import LoreApi, start_webui


# ---------------------------------------------------------------------------
# LoreApi.search tests
# ---------------------------------------------------------------------------

class TestLoreApiSearch:
    def _make_api(self, products=None, drivers=None, warranty=None):
        """Create a LoreApi with mocked SupportClient."""
        api = LoreApi()
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

        api._client = mock_client
        return api

    def test_empty_serial_returns_error(self):
        api = self._make_api()
        result = json.loads(api.search("  "))
        assert result["success"] is False
        assert "serial" in result["error"].lower() or "enter" in result["error"].lower()

    def test_successful_search(self):
        api = self._make_api()
        result = json.loads(api.search("PF4SQLH9"))
        assert result["success"] is True
        assert result["serial"] == "PF4SQLH9"

    def test_product_info_in_result(self):
        api = self._make_api()
        result = json.loads(api.search("PF4SQLH9"))
        assert result["product"]["name"] == "T14s Gen 4 Laptop (ThinkPad) - Type 21F9"

    def test_no_products_found(self):
        api = self._make_api(products=[])
        result = json.loads(api.search("NONEXIST"))
        assert result["success"] is False
        assert "No products" in result["error"]

    def test_serial_uppercased(self):
        api = self._make_api()
        result = json.loads(api.search("pf4sqlh9"))
        assert result["serial"] == "PF4SQLH9"

    def test_exception_returns_error(self):
        api = self._make_api()
        api._client.lookup_product.side_effect = RuntimeError("API down")
        result = json.loads(api.search("PF4SQLH9"))
        assert result["success"] is False
        assert "API down" in result["error"]

    def test_warranty_failure_is_graceful(self):
        api = self._make_api()
        # extract_machine_type returns a value so warranty is attempted
        api._client.get_warranty.side_effect = RuntimeError("Auth failed")
        result = json.loads(api.search("PF4SQLH9"))
        assert result["success"] is True
        assert result["warranty"] == {}

    def test_drivers_key_present(self):
        api = self._make_api()
        result = json.loads(api.search("PF4SQLH9"))
        assert "drivers" in result
        assert "drivers" in result["drivers"]
        assert "categories" in result["drivers"]

    def test_with_driver_data(self):
        from conftest import SAMPLE_DRIVER_RESPONSE
        api = self._make_api(drivers=SAMPLE_DRIVER_RESPONSE)
        result = json.loads(api.search("PF4SQLH9"))
        assert result["success"] is True
        assert len(result["drivers"]["drivers"]) == 3

    def test_with_warranty_data(self):
        from conftest import SAMPLE_WARRANTY_SUCCESS
        api = self._make_api(warranty=SAMPLE_WARRANTY_SUCCESS["data"])
        result = json.loads(api.search("PF4SQLH9"))
        assert result["success"] is True
        assert "warrantyStatus" in result["warranty"]


# ---------------------------------------------------------------------------
# LoreApi.get_readme tests
# ---------------------------------------------------------------------------

class TestLoreApiGetReadme:
    def test_returns_string(self):
        api = LoreApi()
        mock_client = MagicMock()
        api._client = mock_client
        result = api.get_readme("https://example.com/readme.html")
        assert isinstance(result, str)

    def test_exception_returns_empty(self):
        api = LoreApi()
        mock_client = MagicMock()
        mock_client._client = MagicMock()
        # Force _fetch_readme_changes to raise
        with patch("lore.webview._fetch_readme_changes", side_effect=RuntimeError("fail")):
            result = api.get_readme("https://example.com/readme.html")
            assert result == ""


# ---------------------------------------------------------------------------
# start_webui tests
# ---------------------------------------------------------------------------

class TestStartWebui:
    def test_returns_1_without_pywebview(self):
        with patch("lore.webui.pywebview", None):
            rc = start_webui()
            assert rc == 1

    def test_creates_window_with_pywebview(self):
        with patch("lore.webui.pywebview") as mock_pw:
            mock_pw.create_window.return_value = MagicMock()
            rc = start_webui()
            assert rc == 0
            mock_pw.create_window.assert_called_once()
            # Check window title
            call_kwargs = mock_pw.create_window.call_args
            assert "LORE" in call_kwargs[0][0] or "LORE" in call_kwargs[1].get("title", "")
            mock_pw.start.assert_called_once()

    def test_window_has_js_api(self):
        with patch("lore.webui.pywebview") as mock_pw:
            mock_pw.create_window.return_value = MagicMock()
            start_webui()
            call_args = mock_pw.create_window.call_args
            # js_api should be a LoreApi instance
            api_arg = call_args[1].get("js_api") or call_args[0][2] if len(call_args[0]) > 2 else call_args[1].get("js_api")
            assert api_arg is not None
            assert isinstance(api_arg, LoreApi)


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

    def test_calls_window_api_search(self):
        html_path = Path(__file__).parent.parent / "src" / "lore" / "webui.html"
        content = html_path.read_text()
        assert "window.api.search" in content

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