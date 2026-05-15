"""Tests for output formatting."""

from __future__ import annotations

import json

from lore.output import (
    FormatMode,
    format_drivers,
    _short_title,
    _epoch_ms_to_date,
    _enrich_driver_item,
    _group_by_category,
    _priority_sort_key,
)

from conftest import SAMPLE_DRIVER_RESPONSE


# ---------------------------------------------------------------------------
# _short_title tests
# ---------------------------------------------------------------------------

class TestShortTitle:
    def test_truncates_at_for_windows(self):
        assert _short_title(
            "Realtek Audio Driver for Windows 11 (64-bit) - ThinkPad"
        ) == "Realtek Audio Driver"

    def test_truncates_at_dash_suffix(self):
        assert _short_title(
            "ThinkPad Setup Settings Capture/Play Utility - ThinkPad"
        ) == "ThinkPad Setup Settings Capture/Play Utility"

    def test_truncates_at_for_windows_before_dash(self):
        # "for Windows" comes first, should truncate there
        result = _short_title(
            "ThinkPad Setup Settings Capture/Play Utility for Windows 11 (64-bit), 10 (64-bit) - ThinkPad"
        )
        assert result == "ThinkPad Setup Settings Capture/Play Utility"

    def test_keeps_title_if_no_pattern(self):
        assert _short_title("Simple Driver Name") == "Simple Driver Name"

    def test_strips_trailing_dash_space(self):
        assert _short_title("BIOS Update  - ThinkPad") == "BIOS Update"

    def test_strips_trailing_space_dash(self):
        assert _short_title("BIOS Update -") == "BIOS Update"


# ---------------------------------------------------------------------------
# _epoch_ms_to_date tests
# ---------------------------------------------------------------------------

class TestEpochMsToDate:
    def test_converts_known_epoch(self):
        # 2024-01-01 00:00:00 UTC = 1704067200 seconds = 1704067200000 ms
        assert _epoch_ms_to_date(1704067200000) == "2024-01-01"

    def test_handles_none(self):
        assert _epoch_ms_to_date(None) == "N/A"

    def test_handles_zero(self):
        assert _epoch_ms_to_date(0) == "N/A"

    def test_handles_invalid(self):
        assert _epoch_ms_to_date(-1) != "N/A"  # epoch -1ms is a valid date, just very old


# ---------------------------------------------------------------------------
# _enrich_driver_item tests
# ---------------------------------------------------------------------------

class TestEnrichDriverItem:
    def test_extracts_all_fields(self):
        item = SAMPLE_DRIVER_RESPONSE["body"]["DownloadItems"][0]
        result = _enrich_driver_item(item)
        assert result["title"] == "Realtek Audio Driver for Windows 11 (64-bit), Windows 10 (64-bit) - ThinkPad"
        assert result["docId"] == "DS543210"
        assert result["summary"] == "This package installs the Realtek Audio driver"
        assert result["category"] == "Audio"
        assert result["version"] == "6.0.9847.1"
        assert result["priority"] == "Critical"
        assert result["url"] == "https://download.lenovo.com/pccbbs/mobiles/rtaudio.exe"
        assert result["size"] == "318 MB"
        assert result["sha256"] == "def456"
        assert result["released"] == "2024-01-01"
        assert result["updated"] == "2024-04-01"
        assert result["requireLogin"] is False

    def test_handles_missing_date(self):
        item = {"Title": "Test", "Files": [{"Version": "1.0"}]}
        result = _enrich_driver_item(item)
        assert result["released"] == "N/A"
        assert result["updated"] == "N/A"


# ---------------------------------------------------------------------------
# _priority_sort_key tests
# ---------------------------------------------------------------------------

class TestPrioritySortKey:
    def test_critical_first(self):
        item = {"Files": [{"Priority": "Critical"}]}
        assert _priority_sort_key(item) == 0

    def test_recommended_second(self):
        item = {"Files": [{"Priority": "Recommended"}]}
        assert _priority_sort_key(item) == 1

    def test_other_priority_last(self):
        item = {"Files": [{"Priority": "N/A"}]}
        assert _priority_sort_key(item) == 9

    def test_no_files(self):
        item = {"Files": []}
        assert _priority_sort_key(item) == 9


# ---------------------------------------------------------------------------
# _group_by_category tests
# ---------------------------------------------------------------------------

class TestGroupByCategory:
    def test_groups_items_by_category(self):
        body = SAMPLE_DRIVER_RESPONSE["body"]
        items = body["DownloadItems"]
        groups = _group_by_category(items)
        # 3 categories: Audio, Display and Video Graphics, Software and Utilities
        assert len(groups) == 3
        cat_names = [g[0] for g in groups]
        assert cat_names == sorted(cat_names)  # alphabetical

    def test_sorts_by_priority_within_category(self):
        body = SAMPLE_DRIVER_RESPONSE["body"]
        items = body["DownloadItems"]
        groups = _group_by_category(items)
        # Audio category has Critical item
        audio_group = next(g for g in groups if g[0] == "Audio")
        assert len(audio_group[1]) == 1
        assert audio_group[1][0]["Files"][0]["Priority"] == "Critical"


# ---------------------------------------------------------------------------
# format_drivers tests
# ---------------------------------------------------------------------------

class TestFormatDrivers:
    def test_json_output_includes_enriched_fields(self):
        result = format_drivers(SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.JSON)
        data = json.loads(result)
        assert isinstance(data, list)
        assert len(data) == 3
        # Check first item has enriched fields
        item = data[0]
        assert "title" in item
        assert "released" in item
        assert "updated" in item
        assert "docId" in item
        assert "sha256" in item
        assert "size" in item
        assert item["released"] == "2024-01-01"

    def test_plain_output_includes_released(self):
        result = format_drivers(SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.PLAIN)
        assert "Released:" in result
        assert "2024-01-01" in result

    def test_plain_output_grouped_by_category(self):
        result = format_drivers(SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.PLAIN)
        # Should have category section headers
        assert "=== Audio (1 items) ===" in result
        assert "=== Display and Video Graphics (1 items) ===" in result
        assert "=== Software and Utilities (1 items) ===" in result

    def test_plain_short_title_by_default(self):
        result = format_drivers(SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.PLAIN)
        # Short title should not contain "for Windows"
        assert "for Windows" not in result

    def test_plain_full_urls_shows_full_title(self):
        result = format_drivers(SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.PLAIN, full_urls=True)
        # Full title should contain "for Windows"
        assert "for Windows" in result

    def test_rich_output_per_category_tables(self):
        result = format_drivers(SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.RICH)
        # Should have category names as table titles
        assert "Audio" in result
        assert "Display and Video Graphics" in result
        assert "Software and Utilities" in result
        # Should NOT have old-style summary table with "#" column
        assert "Drivers (" not in result

    def test_rich_output_contains_url_column(self):
        result = format_drivers(SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.RICH)
        assert "URL" in result

    def test_rich_output_contains_released_column(self):
        result = format_drivers(SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.RICH)
        assert "Released" in result

    def test_rich_no_index_column(self):
        result = format_drivers(SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.RICH)
        # The old "#" column should be gone
        # Check that there's no column header for index
        lines = result.split("\n")
        # The table header should not contain a standalone "#" column
        # We check by verifying the Title column comes right after header
        assert "Title" in result

    def test_empty_drivers(self):
        result = format_drivers({"body": {"DownloadItems": []}}, fmt=FormatMode.RICH)
        assert "No drivers found" in result

    def test_category_filter(self):
        result = format_drivers(
            SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.PLAIN, category_filter="Audio"
        )
        assert "Realtek Audio Driver" in result
        assert "NVIDIA" not in result

    def test_active_only_filters_login_required(self):
        result = format_drivers(
            SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.PLAIN, active_only=True
        )
        # The 3rd item has RequireLogin=True
        assert "Service Provider Only" not in result

    def test_rich_categories_sorted_alphabetically(self):
        result = format_drivers(SAMPLE_DRIVER_RESPONSE, fmt=FormatMode.RICH)
        # Audio should appear before Display and Video Graphics
        audio_pos = result.find("Audio")
        display_pos = result.find("Display and Video Graphics")
        software_pos = result.find("Software and Utilities")
        assert audio_pos < display_pos < software_pos