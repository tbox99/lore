"""Tests for webview HTML generation and data preparation."""

from __future__ import annotations

import json
from pathlib import Path

from lore.webview import (
    generate_html,
    _prepare_webview_data,
    _strip_url,
    open_webview,
    _build_readme_url,
    _fetch_readme_changes,
)

from conftest import SAMPLE_DRIVER_RESPONSE, SAMPLE_PRODUCT_RESPONSE


# ---------------------------------------------------------------------------
# _strip_url tests
# ---------------------------------------------------------------------------

class TestStripUrl:
    def test_strips_https(self):
        assert _strip_url("https://download.lenovo.com/file.exe") == "download.lenovo.com/file.exe"

    def test_strips_http(self):
        assert _strip_url("http://download.lenovo.com/file.exe") == "download.lenovo.com/file.exe"

    def test_no_protocol(self):
        assert _strip_url("download.lenovo.com/file.exe") == "download.lenovo.com/file.exe"

    def test_preserves_path(self):
        result = _strip_url("https://download.lenovo.com/pccbbs/mobiles/r2euj90d.exe")
        assert "pccbbs/mobiles/r2euj90d.exe" in result


# ---------------------------------------------------------------------------
# _prepare_webview_data tests
# ---------------------------------------------------------------------------

class TestPrepareWebviewData:
    def test_extracts_all_drivers(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE)
        assert len(data["drivers"]) == 3

    def test_contains_serial(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        assert data["serial"] == "PF4SQLH9"

    def test_contains_product_name(self):
        product = SAMPLE_PRODUCT_RESPONSE[0]
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE, product_info=product)
        assert "T14s" in data["productName"]

    def test_driver_fields(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE)
        first = data["drivers"][0]
        assert first["title"] == "Realtek Audio Driver for Windows 11 (64-bit), Windows 10 (64-bit) - ThinkPad"
        assert first["shortTitle"] == "Realtek Audio Driver"
        assert first["docId"] == "DS543210"
        assert first["category"] == "Audio"
        assert first["version"] == "6.0.9847.1"
        assert first["priority"] == "Critical"
        assert first["url"] == "https://download.lenovo.com/pccbbs/mobiles/rtaudio.exe"
        assert first["size"] == "318 MB"
        assert first["sha256"] == "def456"
        assert first["released"] == "2024-01-01"
        assert first["updated"] == "2024-04-01"
        assert first["requireLogin"] is False

    def test_categories_extracted(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE)
        assert "Audio" in data["categories"]
        assert "Display and Video Graphics" in data["categories"]
        assert "Software and Utilities" in data["categories"]

    def test_categories_sorted(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE)
        assert data["categories"] == sorted(data["categories"])

    def test_generated_at_present(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE)
        assert data["generatedAt"]
        assert "UTC" in data["generatedAt"]

    def test_category_filter(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE, category_filter="Audio")
        assert len(data["drivers"]) == 1
        assert data["drivers"][0]["category"] == "Audio"

    def test_priority_filter(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE, priority_filter="Critical")
        assert len(data["drivers"]) == 1
        assert data["drivers"][0]["priority"] == "Critical"

    def test_active_only_filter(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE, active_only=True)
        assert len(data["drivers"]) == 2
        for d in data["drivers"]:
            assert d["requireLogin"] is False

    def test_os_filter(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE, os_filter="Windows 10")
        assert len(data["drivers"]) == 1
        assert data["drivers"][0]["docId"] == "DS543210"

    def test_full_urls_mode(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE, full_urls=True)
        first = data["drivers"][0]
        # In full_urls mode, shortTitle should be the same as title
        assert first["shortTitle"] == first["title"]

    def test_empty_drivers(self):
        data = _prepare_webview_data({"body": {"DownloadItems": []}})
        assert data["drivers"] == []
        assert data["categories"] == []

    def test_handles_missing_body(self):
        data = _prepare_webview_data({})
        assert data["drivers"] == []


# ---------------------------------------------------------------------------
# generate_html tests
# ---------------------------------------------------------------------------

class TestGenerateHtml:
    def test_returns_valid_html(self):
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        assert html.startswith("<!DOCTYPE html>")
        assert "</html>" in html

    def test_contains_serial(self):
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        assert "PF4SQLH9" in html

    def test_contains_product_name(self):
        product = SAMPLE_PRODUCT_RESPONSE[0]
        html = generate_html(SAMPLE_DRIVER_RESPONSE, product_info=product, serial="PF4SQLH9")
        assert "T14s" in html

    def test_contains_driver_titles(self):
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        # The short title should be in the embedded data
        assert "Realtek Audio Driver" in html

    def test_contains_category_headers(self):
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        assert "Audio" in html
        assert "Display and Video Graphics" in html
        assert "Software and Utilities" in html

    def test_contains_filter_elements(self):
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        assert 'id="filter-input"' in html
        assert 'data-priority="Critical"' in html
        assert 'data-priority="Recommended"' in html
        assert 'data-priority="Optional"' in html

    def test_contains_priority_legend(self):
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        assert "badge-critical" in html
        assert "badge-recommended" in html
        assert "badge-optional" in html

    def test_embedded_data_is_valid_json(self):
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        # Extract the JSON data from the script
        start_marker = "var DATA = "
        end_marker = ";\n"
        start_idx = html.find(start_marker)
        assert start_idx >= 0, "Could not find embedded DATA variable"
        start_idx += len(start_marker)
        end_idx = html.find(end_marker, start_idx)
        assert end_idx >= 0, "Could not find end of embedded DATA"
        json_str = html[start_idx:end_idx]
        data = json.loads(json_str)
        assert data["serial"] == "PF4SQLH9"
        assert len(data["drivers"]) == 3

    def test_contains_clipboard_js(self):
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        assert "navigator.clipboard" in html

    def test_contains_dark_mode_css(self):
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        assert "prefers-color-scheme" in html

    def test_self_contained_no_external_requests(self):
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        # Should not have any external script or link tags
        assert 'src="http' not in html
        assert 'href="http' not in html.replace("https://download.lenovo.com", "")
        # CDN check
        assert "cdn.jsdelivr" not in html
        assert "unpkg.com" not in html
        assert "cdnjs." not in html

    def test_url_stripped_in_display(self):
        """The JS should strip https:// for display."""
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        assert "stripUrl" in html

    def test_respects_category_filter(self):
        html = generate_html(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9", category_filter="Audio")
        # The embedded data should only contain Audio drivers
        start_marker = "var DATA = "
        end_marker = ";\n"
        start_idx = html.find(start_marker) + len(start_marker)
        end_idx = html.find(end_marker, start_idx)
        data = json.loads(html[start_idx:end_idx])
        assert len(data["drivers"]) == 1
        assert data["drivers"][0]["category"] == "Audio"


# ---------------------------------------------------------------------------
# open_webview tests
# ---------------------------------------------------------------------------

class TestOpenWebview:
    def test_creates_html_file(self, tmp_path, monkeypatch):
        # Redirect cache dir to tmp_path
        monkeypatch.setattr("lore.webview.user_cache_dir", lambda *a, **kw: str(tmp_path))
        # Mock webbrowser.open to avoid actually opening a browser
        opened_urls = []
        monkeypatch.setattr("lore.webview.webbrowser.open", lambda url: opened_urls.append(url))

        html_path = open_webview(
            SAMPLE_DRIVER_RESPONSE,
            product_info=SAMPLE_PRODUCT_RESPONSE[0],
            serial="PF4SQLH9",
        )

        path = Path(html_path)
        assert path.exists()
        content = path.read_text()
        assert "<!DOCTYPE html>" in content
        assert "PF4SQLH9" in content
        assert len(opened_urls) == 1
        assert opened_urls[0].startswith("file://")

    def test_file_is_persistent(self, tmp_path, monkeypatch):
        monkeypatch.setattr("lore.webview.user_cache_dir", lambda *a, **kw: str(tmp_path))
        monkeypatch.setattr("lore.webview.webbrowser.open", lambda url: None)

        html_path = open_webview(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        path = Path(html_path)
        assert path.exists()
        # File should remain on disk
        assert path.stat().st_size > 0

    def test_filename_includes_serial(self, tmp_path, monkeypatch):
        monkeypatch.setattr("lore.webview.user_cache_dir", lambda *a, **kw: str(tmp_path))
        monkeypatch.setattr("lore.webview.webbrowser.open", lambda url: None)

        html_path = open_webview(SAMPLE_DRIVER_RESPONSE, serial="PF4SQLH9")
        assert "PF4SQLH9" in Path(html_path).name


# ---------------------------------------------------------------------------
# _build_readme_url tests
# ---------------------------------------------------------------------------

class TestBuildReadmeUrl:
    def test_exe_to_html(self):
        assert _build_readme_url("https://download.lenovo.com/pccbbs/mobiles/r2euj90d.exe") == (
            "https://download.lenovo.com/pccbbs/mobiles/r2euj90d.html"
        )

    def test_zip_to_html(self):
        assert _build_readme_url("https://download.lenovo.com/pccbbs/mobiles/driver.zip") == (
            "https://download.lenovo.com/pccbbs/mobiles/driver.html"
        )

    def test_msixbundle_to_html(self):
        assert _build_readme_url("https://download.lenovo.com/pccbbs/mobiles/app.msixbundle") == (
            "https://download.lenovo.com/pccbbs/mobiles/app.html"
        )

    def test_rar_to_html(self):
        assert _build_readme_url("https://download.lenovo.com/pccbbs/mobiles/drv.rar") == (
            "https://download.lenovo.com/pccbbs/mobiles/drv.html"
        )

    def test_strips_query_params(self):
        assert _build_readme_url("https://download.lenovo.com/pccbbs/mobiles/r2euj90d.exe?token=abc123") == (
            "https://download.lenovo.com/pccbbs/mobiles/r2euj90d.html"
        )

    def test_already_html(self):
        assert _build_readme_url("https://download.lenovo.com/pccbbs/mobiles/readme.html") == (
            "https://download.lenovo.com/pccbbs/mobiles/readme.html"
        )

    def test_na_returns_empty(self):
        assert _build_readme_url("N/A") == ""

    def test_empty_returns_empty(self):
        assert _build_readme_url("") == ""

    def test_none_returns_empty(self):
        assert _build_readme_url(None) == ""

    def test_no_extension(self):
        # No extension: just append .html
        result = _build_readme_url("https://download.lenovo.com/pccbbs/mobiles/readme")
        assert result == "https://download.lenovo.com/pccbbs/mobiles/readme.html"


# ---------------------------------------------------------------------------
# _fetch_readme_changes tests
# ---------------------------------------------------------------------------

class TestFetchReadmeChanges:
    def _make_fake_client(self, status_code=200, text=""):
        """Create a mock httpx client that returns the given response."""
        class FakeResponse:
            def __init__(self, status_code, text):
                self.status_code = status_code
                self.text = text
        class FakeClient:
            def __init__(self, resp):
                self._resp = resp
            def get(self, url, **kwargs):
                return self._resp
        return FakeClient(FakeResponse(status_code, text))

    def test_extracts_changes_section(self, tmp_path, monkeypatch):
        """Test extraction of a typical 'Changes in this release' section."""
        monkeypatch.setattr("lore.webview._readme_cache", None)
        monkeypatch.setattr("lore.webview._get_readme_cache", lambda: __import__(
            "lore.support_client", fromlist=["DiskCache"]
        ).DiskCache(cache_dir=tmp_path))
        html = """\
<HTML><HEAD></HEAD><BODY>
CHANGES IN THIS RELEASE
- Update ACP driver to latest version.
[Important updates]
- Remove win10 support.
[New functions]
- Nothing.
[Problem fixes]
- Nothing.
Determining which version is installed
</BODY></HTML>
"""
        client = self._make_fake_client(text=html)
        result = _fetch_readme_changes("https://example.com/readme.html", client)
        assert "Update ACP driver" in result
        assert "Remove win10 support" in result
        assert "Determining" not in result

    def test_404_returns_empty(self, tmp_path, monkeypatch):
        monkeypatch.setattr("lore.webview._readme_cache", None)
        monkeypatch.setattr("lore.webview._get_readme_cache", lambda: __import__(
            "lore.support_client", fromlist=["DiskCache"]
        ).DiskCache(cache_dir=tmp_path))
        client = self._make_fake_client(status_code=404)
        result = _fetch_readme_changes("https://example.com/missing.html", client)
        assert result == ""

    def test_no_changes_section_returns_empty(self, tmp_path, monkeypatch):
        monkeypatch.setattr("lore.webview._readme_cache", None)
        monkeypatch.setattr("lore.webview._get_readme_cache", lambda: __import__(
            "lore.support_client", fromlist=["DiskCache"]
        ).DiskCache(cache_dir=tmp_path))
        html = "<html><body>Some random content without changes</body></html>"
        client = self._make_fake_client(text=html)
        result = _fetch_readme_changes("https://example.com/nochanges.html", client)
        assert result == ""

    def test_network_error_returns_empty(self, tmp_path, monkeypatch):
        monkeypatch.setattr("lore.webview._readme_cache", None)
        monkeypatch.setattr("lore.webview._get_readme_cache", lambda: __import__(
            "lore.support_client", fromlist=["DiskCache"]
        ).DiskCache(cache_dir=tmp_path))
        class FailingClient:
            def get(self, url, **kwargs):
                raise Exception("connection error")
        result = _fetch_readme_changes("https://example.com/fail.html", FailingClient())
        assert result == ""

    def test_strips_html_tags(self, tmp_path, monkeypatch):
        monkeypatch.setattr("lore.webview._readme_cache", None)
        monkeypatch.setattr("lore.webview._get_readme_cache", lambda: __import__(
            "lore.support_client", fromlist=["DiskCache"]
        ).DiskCache(cache_dir=tmp_path))
        html = "CHANGES IN THIS RELEASE<br/>- Fixed bug <b>123</b><br/>Determining version"
        client = self._make_fake_client(text=html)
        result = _fetch_readme_changes("https://example.com/tags.html", client)
        assert "<script" not in result
        assert "Fixed bug 123" in result

    def test_truncates_long_text(self, tmp_path, monkeypatch):
        monkeypatch.setattr("lore.webview._readme_cache", None)
        monkeypatch.setattr("lore.webview._get_readme_cache", lambda: __import__(
            "lore.support_client", fromlist=["DiskCache"]
        ).DiskCache(cache_dir=tmp_path))
        long_text = "A" * 600
        html = f"CHANGES IN THIS RELEASE\n- {long_text}\nDetermining version"
        client = self._make_fake_client(text=html)
        result = _fetch_readme_changes("https://example.com/long.html", client)
        # Result should contain the long item (no truncation in new parser)
        assert long_text[:100] in result

    def test_case_insensitive(self, tmp_path, monkeypatch):
        monkeypatch.setattr("lore.webview._readme_cache", None)
        monkeypatch.setattr("lore.webview._get_readme_cache", lambda: __import__(
            "lore.support_client", fromlist=["DiskCache"]
        ).DiskCache(cache_dir=tmp_path))
        html = "changes in this release\n- Fixed audio driver.\nDetermining version"
        client = self._make_fake_client(text=html)
        result = _fetch_readme_changes("https://example.com/case.html", client)
        assert "Fixed audio driver" in result


# ---------------------------------------------------------------------------
# releaseNotes in _prepare_webview_data tests
# ---------------------------------------------------------------------------

class TestReleaseNotesInData:
    def test_readme_url_in_driver_entry(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE)
        first = data["drivers"][0]
        assert first["readmeUrl"] == "https://download.lenovo.com/pccbbs/mobiles/rtaudio.html"

    def test_release_notes_empty_by_default(self):
        """Without a readme_client, releaseNotes should be empty string."""
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE)
        for d in data["drivers"]:
            assert d["releaseNotes"] == ""

    def test_no_readme_skips_fetch(self):
        data = _prepare_webview_data(SAMPLE_DRIVER_RESPONSE, no_readme=True)
        for d in data["drivers"]:
            assert d["releaseNotes"] == ""

    def test_na_url_gives_empty_readme_url(self):
        """Driver with N/A URL should have empty readmeUrl."""
        # Modify the sample data to have N/A url
        import copy
        modified = copy.deepcopy(SAMPLE_DRIVER_RESPONSE)
        modified["body"]["DownloadItems"][0]["Files"][0]["URL"] = "N/A"
        data = _prepare_webview_data(modified)
        assert data["drivers"][0]["readmeUrl"] == ""

    def test_with_readme_client(self, tmp_path, monkeypatch):
        """When a readme_client is provided, it should attempt to fetch release notes."""
        monkeypatch.setattr("lore.webview._readme_cache", None)
        monkeypatch.setattr("lore.webview._get_readme_cache", lambda: __import__(
            "lore.support_client", fromlist=["DiskCache"]
        ).DiskCache(cache_dir=tmp_path))

        class FakeResponse:
            def __init__(self):
                self.status_code = 200
                self.text = "CHANGES IN THIS RELEASE\n- Updated driver v2.0\nDetermining version"

        class FakeClient:
            def get(self, url, **kwargs):
                return FakeResponse()

        data = _prepare_webview_data(
            SAMPLE_DRIVER_RESPONSE,
            readme_client=FakeClient(),
        )
        # At least one driver should have release notes
        has_notes = any(d["releaseNotes"] for d in data["drivers"])
        assert has_notes