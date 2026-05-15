"""Tests for TUI data preparation logic."""

from __future__ import annotations

from lore.tui import (
    DriverEntry,
    prepare_driver_entries,
    group_entries_by_category,
)

from conftest import SAMPLE_DRIVER_RESPONSE


# ---------------------------------------------------------------------------
# prepare_driver_entries tests
# ---------------------------------------------------------------------------

class TestPrepareDriverEntries:
    def test_extracts_all_entries(self):
        entries = prepare_driver_entries(SAMPLE_DRIVER_RESPONSE)
        assert len(entries) == 3

    def test_extracts_entry_fields(self):
        entries = prepare_driver_entries(SAMPLE_DRIVER_RESPONSE)
        first = entries[0]
        assert isinstance(first, DriverEntry)
        assert first.doc_id == "DS543210"
        assert first.category == "Audio"
        assert first.version == "6.0.9847.1"
        assert first.priority == "Critical"
        assert first.url == "https://download.lenovo.com/pccbbs/mobiles/rtaudio.exe"
        assert first.size == "318 MB"
        assert first.sha256 == "def456"
        assert first.released == "2024-01-01"
        assert first.updated == "2024-04-01"
        assert first.require_login is False

    def test_short_title_is_shortened(self):
        entries = prepare_driver_entries(SAMPLE_DRIVER_RESPONSE)
        # First item has "for Windows" in title
        assert "for Windows" not in entries[0].short_title
        assert "for Windows" in entries[0].title

    def test_category_filter(self):
        entries = prepare_driver_entries(SAMPLE_DRIVER_RESPONSE, category_filter="Audio")
        assert len(entries) == 1
        assert entries[0].category == "Audio"

    def test_priority_filter(self):
        entries = prepare_driver_entries(SAMPLE_DRIVER_RESPONSE, priority_filter="Critical")
        assert len(entries) == 1
        assert entries[0].priority == "Critical"

    def test_active_only_excludes_login_required(self):
        entries = prepare_driver_entries(SAMPLE_DRIVER_RESPONSE, active_only=True)
        assert len(entries) == 2  # Third item has RequireLogin=True
        for e in entries:
            assert not e.require_login

    def test_os_filter(self):
        entries = prepare_driver_entries(SAMPLE_DRIVER_RESPONSE, os_filter="Windows 10")
        # Only the first item has "Windows 10 (64-bit)" in OS keys
        assert len(entries) == 1
        assert entries[0].doc_id == "DS543210"

    def test_empty_results(self):
        entries = prepare_driver_entries(
            SAMPLE_DRIVER_RESPONSE, category_filter="Nonexistent"
        )
        assert len(entries) == 0

    def test_handles_missing_body(self):
        entries = prepare_driver_entries({})
        assert len(entries) == 0

    def test_handles_empty_download_items(self):
        entries = prepare_driver_entries({"body": {"DownloadItems": []}})
        assert len(entries) == 0


# ---------------------------------------------------------------------------
# group_entries_by_category tests
# ---------------------------------------------------------------------------

class TestGroupEntriesByCategory:
    def test_groups_by_category(self):
        entries = prepare_driver_entries(SAMPLE_DRIVER_RESPONSE)
        groups = group_entries_by_category(entries)
        # 3 categories: Audio, Display and Video Graphics, Software and Utilities
        assert len(groups) == 3
        cat_names = [g[0] for g in groups]
        assert cat_names == sorted(cat_names)  # alphabetical

    def test_sorts_by_priority_within_category(self):
        entries = prepare_driver_entries(SAMPLE_DRIVER_RESPONSE)
        groups = group_entries_by_category(entries)
        audio_group = next(g for g in groups if g[0] == "Audio")
        assert len(audio_group[1]) == 1
        assert audio_group[1][0].priority == "Critical"

    def test_empty_entries(self):
        groups = group_entries_by_category([])
        assert len(groups) == 0

    def test_single_category(self):
        entries = prepare_driver_entries(SAMPLE_DRIVER_RESPONSE, category_filter="Audio")
        groups = group_entries_by_category(entries)
        assert len(groups) == 1
        assert groups[0][0] == "Audio"

    def test_combined_filter_and_group(self):
        entries = prepare_driver_entries(SAMPLE_DRIVER_RESPONSE, priority_filter="Recommended")
        groups = group_entries_by_category(entries)
        # Two recommended items: Display and Video Graphics, Software and Utilities
        assert len(groups) == 2
        for cat_name, cat_entries in groups:
            for entry in cat_entries:
                assert entry.priority == "Recommended"