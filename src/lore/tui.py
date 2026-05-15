"""LORE TUI — Interactive terminal UI for driver browsing using Textual."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from typing import Any

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.events import Key
from textual.widgets import Footer, Header, Static

from .output import _short_title, _epoch_ms_to_date, _group_by_category, _priority_sort_key


# ---------------------------------------------------------------------------
# Clipboard helper
# ---------------------------------------------------------------------------

def _copy_to_clipboard(text: str) -> bool:
    """Copy text to system clipboard. Returns True on success."""
    # Try xclip (X11), xsel (X11), wl-copy (Wayland), pbcopy (macOS), clip.exe (WSL)
    commands = [
        ["xclip", "-selection", "clipboard"],
        ["xsel", "--clipboard", "--input"],
        ["wl-copy"],
        ["pbcopy"],
        ["clip.exe"],
    ]
    for cmd in commands:
        try:
            result = subprocess.run(
                cmd, input=text.encode(), capture_output=True, timeout=3,
            )
            if result.returncode == 0:
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return False


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class DriverEntry:
    """Prepared driver data for the TUI."""

    title: str
    short_title: str
    doc_id: str
    summary: str
    category: str
    version: str
    priority: str
    url: str
    size: str
    sha256: str
    released: str
    updated: str
    require_login: bool
    os_keys: list[str] = field(default_factory=list)
    # Keep original for reference
    raw: dict = field(default_factory=dict, repr=False)


# ---------------------------------------------------------------------------
# Data preparation
# ---------------------------------------------------------------------------

def prepare_driver_entries(
    driver_data: dict,
    os_filter: str | None = None,
    category_filter: str | None = None,
    priority_filter: str | None = None,
    active_only: bool = False,
) -> list[DriverEntry]:
    """Extract and filter driver entries from API response data."""
    body = driver_data.get("body", driver_data)
    items = body.get("DownloadItems", [])

    filtered: list[dict] = []
    for item in items:
        if os_filter:
            os_keys = item.get("OperatingSystemKeys", [])
            if not any(os_filter.lower() in ok.lower() for ok in os_keys):
                continue
        if category_filter:
            cat = item.get("Category", {}).get("Name", "")
            if category_filter.lower() not in cat.lower():
                continue
        if priority_filter:
            files = item.get("Files", [])
            pri_match = False
            for f in files:
                if f.get("Priority", "").lower() == priority_filter.lower():
                    pri_match = True
                    break
            if not pri_match:
                continue
        if active_only and item.get("RequireLogin", False):
            continue
        filtered.append(item)

    entries: list[DriverEntry] = []
    for item in filtered:
        files = item.get("Files", [])
        first_file = files[0] if files else {}
        date_unix = item.get("Date", {}).get("Unix")
        updated_unix = item.get("Updated", {}).get("Unix")

        title = item.get("Title", "N/A")
        entries.append(
            DriverEntry(
                title=title,
                short_title=_short_title(title),
                doc_id=item.get("DocId", "N/A"),
                summary=item.get("Summary", ""),
                category=item.get("Category", {}).get("Name", "Uncategorized"),
                version=first_file.get("Version", "N/A"),
                priority=first_file.get("Priority", "N/A"),
                url=first_file.get("URL", "N/A"),
                size=first_file.get("Size", "N/A"),
                sha256=first_file.get("SHA256", "N/A"),
                released=_epoch_ms_to_date(date_unix),
                updated=_epoch_ms_to_date(updated_unix),
                require_login=item.get("RequireLogin", False),
                os_keys=item.get("OperatingSystemKeys", []),
                raw=item,
            )
        )

    return entries


def group_entries_by_category(entries: list[DriverEntry]) -> list[tuple[str, list[DriverEntry]]]:
    """Group driver entries by category, sorted alphabetically.

    Within each category, items are sorted by priority (Critical first).
    """
    groups: dict[str, list[DriverEntry]] = {}
    for entry in entries:
        groups.setdefault(entry.category, []).append(entry)

    result: list[tuple[str, list[DriverEntry]]] = []
    for cat_name in sorted(groups.keys()):
        sorted_entries = sorted(groups[cat_name], key=lambda e: _priority_sort_key(e.raw))
        result.append((cat_name, sorted_entries))

    return result


# ---------------------------------------------------------------------------
# Priority indicator
# ---------------------------------------------------------------------------

def _priority_dot(priority: str) -> str:
    """Return colored dot for priority level."""
    p = priority.lower()
    if p == "critical":
        return "🔴"
    elif p == "recommended":
        return "🟡"
    return "⚪"


# ---------------------------------------------------------------------------
# URL formatting
# ---------------------------------------------------------------------------

def _format_url_display(url: str, full: bool = False) -> str:
    """Format URL for display. 
    
    Default (non-full): strip https:// prefix, show rest as-is.
    Full: show complete URL.
    """
    if full:
        return url
    return url.removeprefix("https://").removeprefix("http://")


# ---------------------------------------------------------------------------
# Widgets
# ---------------------------------------------------------------------------

class CategoryHeader(Static):
    """A styled category separator/header."""

    DEFAULT_CSS = """
    CategoryHeader {
        width: 100%;
        padding: 1 0 0 1;
        color: $text-muted;
        text-style: bold;
        border-bottom: heavy $border;
    }
    """


class DriverItem(Static):
    """A single driver row — expandable on Enter."""

    DEFAULT_CSS = """
    DriverItem {
        width: 100%;
        padding: 0 1;
        height: auto;
    }
    DriverItem:focus {
        background: $primary 15%;
        color: $text;
        border-left: tall $primary;
    }
    DriverItem:hover {
        background: $primary 8%;
    }
    DriverItem .driver-title {
        padding: 0;
        height: auto;
    }
    DriverItem .expanded-detail {
        padding: 0 2;
        color: $text-muted;
        border-left: solid $primary;
        margin: 0 0 0 1;
    }
    DriverItem .copy-hint {
        color: $success;
        text-style: italic;
    }
    """

    def __init__(
        self,
        entry: DriverEntry,
        full_urls: bool = False,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.entry = entry
        self.full_urls = full_urls
        self._expanded = False
        self.can_focus = True

    def compose(self) -> ComposeResult:
        dot = _priority_dot(self.entry.priority)
        title = self.entry.title if self.full_urls else self.entry.short_title
        # Truncate long versions for the list view
        ver = self.entry.version
        if len(ver) > 15:
            ver = ver[:12] + "..."
        line = f"{dot} {title}    [dim]v{ver}[/]  [dim]{self.entry.released}[/]"
        yield Static(line, classes="driver-title")
        # Expanded detail (initially hidden)
        detail_widget = Static(self._detail_text(), classes="expanded-detail")
        detail_widget.display = False
        yield detail_widget

    def _detail_text(self) -> str:
        """Build the expanded detail string."""
        e = self.entry
        url_display = _format_url_display(e.url, full=self.full_urls)
        lines = [
            f"  Released: {e.released}    Updated: {e.updated}",
            f"  Category: {e.category}    Size: {e.size}",
            f"  URL: {url_display}",
            f"  DocId: {e.doc_id}",
        ]
        if e.sha256 and e.sha256 != "N/A":
            lines.append(f"  SHA256: {e.sha256}")
        if e.summary:
            lines.append(f"  Summary: {e.summary}")
        if e.require_login:
            lines.append("  [dim italic]⚠ Login required[/]")
        lines.append("  [dim]c = copy URL  y = copy all[/]")
        return "\n".join(lines)

    def toggle_expand(self) -> None:
        """Toggle expanded/collapsed state."""
        self._expanded = not self._expanded
        try:
            detail = self.query_one(".expanded-detail", Static)
            detail.display = self._expanded
        except Exception:
            pass

    def copy_url(self) -> bool:
        """Copy the download URL to clipboard."""
        return _copy_to_clipboard(self.entry.url)

    def copy_all(self) -> bool:
        """Copy all driver details as text to clipboard."""
        e = self.entry
        text = (
            f"Title: {e.title}\n"
            f"Version: {e.version}\n"
            f"Priority: {e.priority}\n"
            f"Released: {e.released}\n"
            f"Updated: {e.updated}\n"
            f"Category: {e.category}\n"
            f"Size: {e.size}\n"
            f"URL: {e.url}\n"
            f"DocId: {e.doc_id}\n"
        )
        if e.sha256 and e.sha256 != "N/A":
            text += f"SHA256: {e.sha256}\n"
        if e.summary:
            text += f"Summary: {e.summary}\n"
        return _copy_to_clipboard(text)


# ---------------------------------------------------------------------------
# Filter bar
# ---------------------------------------------------------------------------

class FilterBar(Static):
    """A simple filter status bar."""

    DEFAULT_CSS = """
    FilterBar {
        width: 100%;
        height: 1;
        padding: 0 1;
        color: $text-muted;
        background: $surface;
    }
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__("", **kwargs)
        self._filter_text = ""

    @property
    def filter_text(self) -> str:
        return self._filter_text

    @filter_text.setter
    def filter_text(self, value: str) -> None:
        self._filter_text = value
        if value:
            self.update(f"[bold]/[/] {value}")
        else:
            self.update("")


# ---------------------------------------------------------------------------
# Copy notification
# ---------------------------------------------------------------------------

class CopyNotification(Static):
    """Brief notification shown after copying to clipboard."""

    DEFAULT_CSS = """
    CopyNotification {
        width: auto;
        height: auto;
        padding: 0 2;
        background: $success;
        color: $text;
        dock: bottom;
    }
    """

    def __init__(self, message: str, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)


# ---------------------------------------------------------------------------
# The TUI App
# ---------------------------------------------------------------------------

class LoreDriversApp(App):
    """LORE Drivers TUI — browse, expand, and filter drivers."""

    TITLE = "LORE — Lenovo Online Research & Equipment"

    CSS = """
    Screen {
        layout: vertical;
    }

    #header-info {
        width: 100%;
        height: auto;
        padding: 0 1;
        border-bottom: heavy $border;
    }

    #driver-list {
        width: 100%;
        height: 1fr;
    }

    #filter-bar {
        width: 100%;
        height: auto;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit", show=True),
        Binding("escape", "clear_filter_or_quit", "Clear/Quit", show=False),
        Binding("slash", "start_filter", "Filter", show=True),
        Binding("enter", "toggle_expand", "Expand", show=True),
        Binding("c", "copy_url", "Copy URL", show=True),
        Binding("y", "copy_all", "Copy All", show=True),
        Binding("up", "navigate_up", "↑", show=False),
        Binding("down", "navigate_down", "↓", show=False),
        Binding("pageup", "page_up", "PgUp", show=False),
        Binding("pagedown", "page_down", "PgDn", show=False),
        Binding("home", "go_home", "Home", show=False),
        Binding("end", "go_end", "End", show=False),
    ]

    def __init__(
        self,
        driver_data: dict,
        product_info: dict | None = None,
        serial: str = "",
        full_urls: bool = False,
        os_filter: str | None = None,
        category_filter: str | None = None,
        priority_filter: str | None = None,
        active_only: bool = False,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.driver_data = driver_data
        self.product_info = product_info or {}
        self.serial = serial
        self.full_urls = full_urls
        self.os_filter = os_filter
        self.category_filter = category_filter
        self.priority_filter = priority_filter
        self.active_only = active_only
        self._filter_mode = False
        self._filter_text = ""

    def compose(self) -> ComposeResult:
        # Header with product info
        product_name = self.product_info.get("Name", "Unknown Device")
        header_text = f"[bold]Serial:[/] {self.serial}  │  {product_name}"
        yield Static(header_text, id="header-info")

        # Filter bar (initially empty)
        yield FilterBar(id="filter-bar")

        # Scrollable driver list
        yield VerticalScroll(id="driver-list")

        # Footer
        yield Footer()

    def on_mount(self) -> None:
        self._populate_list()
        # Focus the first DriverItem so navigation works immediately
        try:
            first_item = self.query(DriverItem).first()
            first_item.focus()
        except Exception:
            pass

    def _populate_list(self, filter_text: str = "") -> None:
        """Populate the driver list, optionally filtering by title substring."""
        entries = prepare_driver_entries(
            self.driver_data,
            os_filter=self.os_filter,
            category_filter=self.category_filter,
            priority_filter=self.priority_filter,
            active_only=self.active_only,
        )

        if filter_text:
            ft = filter_text.lower()
            entries = [e for e in entries if ft in e.title.lower() or ft in e.short_title.lower()]

        groups = group_entries_by_category(entries)

        driver_list = self.query_one("#driver-list", VerticalScroll)
        # Remove existing children
        for child in list(driver_list.children):
            child.remove()

        if not groups:
            driver_list.mount(Static("[dim]No drivers found.[/]"))
            return

        for cat_name, cat_entries in groups:
            header = CategoryHeader(f"{cat_name}")
            driver_list.mount(header)
            for entry in cat_entries:
                item = DriverItem(entry, full_urls=self.full_urls)
                driver_list.mount(item)

    # ------------------------------------------------------------------
    # Copy actions
    # ------------------------------------------------------------------

    def action_copy_url(self) -> None:
        """Copy URL of focused driver to clipboard."""
        focused = self.focused
        if isinstance(focused, DriverItem):
            if focused.copy_url():
                self._show_copy_notification("✓ URL copied to clipboard")
            else:
                self._show_copy_notification("⚠ Clipboard not available")

    def action_copy_all(self) -> None:
        """Copy all details of focused driver to clipboard."""
        focused = self.focused
        if isinstance(focused, DriverItem):
            if focused.copy_all():
                self._show_copy_notification("✓ All details copied to clipboard")
            else:
                self._show_copy_notification("⚠ Clipboard not available")

    def _show_copy_notification(self, message: str) -> None:
        """Show a brief copy notification that auto-removes."""
        notif = CopyNotification(message)
        self.mount(notif)
        self.set_timer(2.0, lambda: notif.remove() if notif.is_mounted else None)

    # ------------------------------------------------------------------
    # Navigation actions
    # ------------------------------------------------------------------

    def action_toggle_expand(self) -> None:
        """Toggle expand/collapse on the focused driver item."""
        focused = self.focused
        if isinstance(focused, DriverItem):
            focused.toggle_expand()

    def action_navigate_up(self) -> None:
        """Move focus to previous DriverItem."""
        items = self.query(DriverItem)
        item_list = [i for i in items]
        if not item_list:
            return
        focused = self.focused
        try:
            idx = item_list.index(focused)
        except ValueError:
            idx = 0
        if idx > 0:
            item_list[idx - 1].focus()
            scroll = self.query_one("#driver-list", VerticalScroll)
            scroll.scroll_to_widget(item_list[idx - 1])

    def action_navigate_down(self) -> None:
        """Move focus to next DriverItem."""
        items = self.query(DriverItem)
        item_list = [i for i in items]
        if not item_list:
            return
        focused = self.focused
        try:
            idx = item_list.index(focused)
        except ValueError:
            idx = -1
        if idx < len(item_list) - 1:
            item_list[idx + 1].focus()
            scroll = self.query_one("#driver-list", VerticalScroll)
            scroll.scroll_to_widget(item_list[idx + 1])

    def action_page_up(self) -> None:
        scroll = self.query_one("#driver-list", VerticalScroll)
        scroll.scroll_page_up()

    def action_page_down(self) -> None:
        scroll = self.query_one("#driver-list", VerticalScroll)
        scroll.scroll_page_down()

    def action_go_home(self) -> None:
        scroll = self.query_one("#driver-list", VerticalScroll)
        scroll.scroll_home()

    def action_go_end(self) -> None:
        scroll = self.query_one("#driver-list", VerticalScroll)
        scroll.scroll_end()

    def action_start_filter(self) -> None:
        """Enter filter mode."""
        self._filter_mode = True

    def action_clear_filter_or_quit(self) -> None:
        """Clear filter if active, otherwise quit."""
        if self._filter_mode or self._filter_text:
            self._filter_mode = False
            self._filter_text = ""
            filter_bar = self.query_one("#filter-bar", FilterBar)
            filter_bar.filter_text = ""
            self._populate_list()
        else:
            self.exit()

    def on_key(self, event: Key) -> None:
        """Handle key events for filter mode and copy keys on expanded items."""
        # Filter mode intercepts all keys
        if self._filter_mode:
            if event.key == "enter" or event.key == "escape":
                self._filter_mode = False
                event.prevent_default()
                return
            elif event.key == "backspace":
                self._filter_text = self._filter_text[:-1]
                event.prevent_default()
            elif event.key == "ctrl+c":
                self._filter_mode = False
                self._filter_text = ""
                filter_bar = self.query_one("#filter-bar", FilterBar)
                filter_bar.filter_text = ""
                self._populate_list()
                event.prevent_default()
                return
            elif event.character and event.character.isprintable():
                self._filter_text += event.character
                event.prevent_default()
            else:
                event.prevent_default()
                return

            filter_bar = self.query_one("#filter-bar", FilterBar)
            filter_bar.filter_text = self._filter_text
            self._populate_list(self._filter_text)
            return


def run_tui(
    driver_data: dict,
    product_info: dict | None = None,
    serial: str = "",
    full_urls: bool = False,
    os_filter: str | None = None,
    category_filter: str | None = None,
    priority_filter: str | None = None,
    active_only: bool = False,
) -> None:
    """Launch the LORE Drivers TUI app."""
    app = LoreDriversApp(
        driver_data=driver_data,
        product_info=product_info,
        serial=serial,
        full_urls=full_urls,
        os_filter=os_filter,
        category_filter=category_filter,
        priority_filter=priority_filter,
        active_only=active_only,
    )
    app.run()