"""Output formatting for LORE — rich tables, plain text, and JSON."""

from __future__ import annotations

import json as _json
import re as _re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from rich.console import Console
from rich.table import Table
from rich.text import Text

# ---------------------------------------------------------------------------
# Formatting mode
# ---------------------------------------------------------------------------

class FormatMode:
    RICH = "rich"
    PLAIN = "plain"
    JSON = "json"


# Priority sort order: Critical first, then Recommended, then everything else
_PRIORITY_ORDER = {"critical": 0, "recommended": 1}


def _make_console(no_color: bool = False) -> Console:
    return Console(no_color=no_color, highlight=False, width=120)


# ---------------------------------------------------------------------------
# Product formatting
# ---------------------------------------------------------------------------

def format_product(products: list[dict], fmt: str = FormatMode.RICH, no_emoji: bool = False) -> str:
    """Format product lookup results."""
    if fmt == FormatMode.JSON:
        return _json.dumps(products, indent=2, default=str)

    if not products:
        return "No products found."

    if fmt == FormatMode.PLAIN:
        lines: list[str] = []
        for p in products:
            lines.append(f"Name:       {p.get('Name', 'N/A')}")
            lines.append(f"Type:       {p.get('Type', 'N/A')}")
            lines.append(f"Serial:     {p.get('Serial', 'N/A')}")
            lines.append(f"Brand:      {p.get('Brand', 'N/A')}")
            lines.append(f"Image:      {p.get('Image', 'N/A')}")
            lines.append(f"Supported:  {p.get('IsSupported', 'N/A')}")
            lines.append(f"Product ID: {p.get('Id', 'N/A')}")
            lines.append("---")
        return "\n".join(lines)

    # Rich table
    console = _make_console()
    table = Table(title="Product Information", show_header=True, header_style="bold cyan")
    table.add_column("Field", style="bold")
    table.add_column("Value")

    p = products[0]
    emoji = "" if no_emoji else "🖥️ "
    table.add_row("Name", f"{emoji}{p.get('Name', 'N/A')}")
    table.add_row("Type", p.get('Type', 'N/A'))
    table.add_row("Serial", p.get('Serial', 'N/A'))
    table.add_row("Brand", p.get('Brand', 'N/A'))
    table.add_row("Image", p.get('Image', 'N/A'))

    supported = p.get('IsSupported', False)
    status_icon = "" if no_emoji else ("✅ " if supported else "❌ ")
    table.add_row("Supported", f"{status_icon}{supported}")
    table.add_row("Product ID", p.get('Id', 'N/A'))

    with console.capture() as capture:
        console.print(table)
    return capture.get()


# ---------------------------------------------------------------------------
# Driver formatting
# ---------------------------------------------------------------------------

def _short_title(title: str) -> str:
    """Shorten a Lenovo driver title.

    Truncates at 'for Windows' or ' - ' (whichever comes first),
    stripping trailing whitespace and hyphens.
    """
    for pattern in (r"\s+for\s+Windows", r"\s+-\s+"):
        m = _re.search(pattern, title)
        if m:
            title = title[: m.start()]
            break
    return title.rstrip(" -")


def _epoch_ms_to_date(epoch_ms: int | float | None) -> str:
    """Convert epoch milliseconds to YYYY-MM-DD string."""
    if not epoch_ms:
        return "N/A"
    try:
        dt = datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc)
        return dt.strftime("%Y-%m-%d")
    except (ValueError, OSError):
        return "N/A"


def _enrich_driver_item(item: dict) -> dict:
    """Extract enriched fields from a DownloadItem for JSON output."""
    files = item.get("Files", [])
    first_file = files[0] if files else {}
    date_unix = item.get("Date", {}).get("Unix")
    updated_unix = item.get("Updated", {}).get("Unix")
    return {
        "title": item.get("Title", ""),
        "docId": item.get("DocId", ""),
        "summary": item.get("Summary", ""),
        "category": item.get("Category", {}).get("Name", ""),
        "version": first_file.get("Version", "N/A"),
        "priority": first_file.get("Priority", "N/A"),
        "url": first_file.get("URL", "N/A"),
        "size": first_file.get("Size", "N/A"),
        "sha256": first_file.get("SHA256", "N/A"),
        "os": item.get("OperatingSystemKeys", []),
        "released": _epoch_ms_to_date(date_unix),
        "updated": _epoch_ms_to_date(updated_unix),
        "requireLogin": item.get("RequireLogin", False),
    }


def _priority_sort_key(item: dict) -> int:
    """Sort key for driver priority: Critical=0, Recommended=1, other=9."""
    files = item.get("Files", [])
    priority = files[0].get("Priority", "") if files else ""
    return _PRIORITY_ORDER.get(priority.lower(), 9)


def _group_by_category(items: list[dict]) -> list[tuple[str, list[dict]]]:
    """Group drivers by category, sorted alphabetically.

    Within each category, items are sorted by priority (Critical first).
    """
    groups: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        cat = item.get("Category", {}).get("Name", "Uncategorized")
        groups[cat].append(item)

    # Sort categories alphabetically
    result: list[tuple[str, list[dict]]] = []
    for cat_name in sorted(groups.keys()):
        # Sort items within category by priority
        sorted_items = sorted(groups[cat_name], key=_priority_sort_key)
        result.append((cat_name, sorted_items))

    return result


def format_drivers(
    driver_data: dict,
    fmt: str = FormatMode.RICH,
    os_filter: str | None = None,
    category_filter: str | None = None,
    priority_filter: str | None = None,
    active_only: bool = False,
    full_urls: bool = False,
    no_emoji: bool = False,
) -> str:
    """Format driver listing results."""
    if fmt == FormatMode.JSON:
        body = driver_data.get("body", driver_data)
        items = body.get("DownloadItems", [])
        enriched = [_enrich_driver_item(it) for it in items]
        return _json.dumps(enriched, indent=2, default=str)

    body = driver_data.get("body", driver_data)
    items = body.get("DownloadItems", [])
    if not items:
        return "No drivers found."

    # Apply filters
    filtered: list[dict] = []
    for item in items:
        # OS filter
        if os_filter:
            os_keys = item.get("OperatingSystemKeys", [])
            if not any(os_filter.lower() in ok.lower() for ok in os_keys):
                continue
        # Category filter
        if category_filter:
            cat = item.get("Category", {}).get("Name", "")
            if category_filter.lower() not in cat.lower():
                continue
        # Priority filter
        if priority_filter:
            files = item.get("Files", [])
            pri_match = False
            for f in files:
                if f.get("Priority", "").lower() == priority_filter.lower():
                    pri_match = True
                    break
            if not pri_match:
                continue
        # Active only (skip items that require login)
        if active_only and item.get("RequireLogin", False):
            continue
        filtered.append(item)

    if not filtered:
        return "No drivers matching filters."

    # Group by category
    groups = _group_by_category(filtered)

    if fmt == FormatMode.PLAIN:
        return _format_drivers_plain(groups, full_urls=full_urls)

    # Rich output — per-category tables
    return _format_drivers_rich(groups, full_urls=full_urls, no_emoji=no_emoji)


def _format_drivers_plain(
    groups: list[tuple[str, list[dict]]],
    full_urls: bool = False,
) -> str:
    """Format drivers as plain text, grouped by category."""
    sections: list[str] = []
    for cat_name, items in groups:
        lines: list[str] = []
        lines.append(f"=== {cat_name} ({len(items)} items) ===")
        for item in items:
            files = item.get("Files", [])
            version = files[0].get("Version", "N/A") if files else "N/A"
            priority = files[0].get("Priority", "N/A") if files else "N/A"
            url = files[0].get("URL", "N/A") if files else "N/A"
            date_unix = item.get("Date", {}).get("Unix")
            released = _epoch_ms_to_date(date_unix)
            title_display = item.get("Title", "N/A") if full_urls else _short_title(item.get("Title", "N/A"))
            lines.append(f"  Title:     {title_display}")
            lines.append(f"  Version:   {version}")
            lines.append(f"  Priority:  {priority}")
            lines.append(f"  Released:  {released}")
            lines.append(f"  URL:       {url}")
            lines.append("")
        sections.append("\n".join(lines).rstrip())
    return "\n\n".join(sections)


def _format_drivers_rich(
    groups: list[tuple[str, list[dict]]],
    full_urls: bool = False,
    no_emoji: bool = False,
) -> str:
    """Format drivers as Rich tables, one per category."""
    console = _make_console()
    output_parts: list[str] = []

    for cat_name, items in groups:
        table = Table(
            title=f"{cat_name} ({len(items)} items)",
            show_header=True,
            header_style="bold cyan",
        )
        table.add_column(
            "Title",
            style="bold",
            max_width=None if full_urls else 35,
            no_wrap=not full_urls,
        )
        table.add_column("Version", width=12)
        table.add_column("Priority", width=18)
        table.add_column("Released", width=12)
        table.add_column(
            "URL",
            max_width=None if full_urls else 45,
            no_wrap=not full_urls,
        )

        for item in items:
            files = item.get("Files", [])
            version = files[0].get("Version", "N/A") if files else "N/A"
            priority = files[0].get("Priority", "N/A") if files else "N/A"
            url = files[0].get("URL", "N/A") if files else "N/A"
            date_unix = item.get("Date", {}).get("Unix")
            released = _epoch_ms_to_date(date_unix)
            title_display = item.get("Title", "N/A") if full_urls else _short_title(item.get("Title", "N/A"))

            pri_style = ""
            pri_icon = ""
            if not no_emoji:
                if priority.lower() == "critical":
                    pri_style = "bold red"
                    pri_icon = "🔴 "
                elif priority.lower() == "recommended":
                    pri_style = "yellow"
                    pri_icon = "🟡 "

            table.add_row(
                title_display,
                version,
                Text(f"{pri_icon}{priority}", style=pri_style or None),
                released,
                url,
            )

        with console.capture() as capture:
            console.print(table)
        output_parts.append(capture.get())

    return "\n".join(output_parts)


# ---------------------------------------------------------------------------
# Warranty formatting
# ---------------------------------------------------------------------------

def format_warranty(warranty_data: dict, fmt: str = FormatMode.RICH, no_emoji: bool = False) -> str:
    """Format warranty status results."""
    if fmt == FormatMode.JSON:
        return _json.dumps(warranty_data, indent=2, default=str)

    if fmt == FormatMode.PLAIN:
        return _format_warranty_plain(warranty_data)

    # Rich table
    console = _make_console()
    machine = warranty_data.get("machineInfo", {})

    # Machine info table
    if machine:
        table = Table(title="Machine Information", show_header=True, header_style="bold cyan")
        table.add_column("Field", style="bold")
        table.add_column("Value")
        table.add_row("Serial", machine.get("serial", "N/A"))
        table.add_row("Product", machine.get("product", "N/A"))
        table.add_row("Name", machine.get("productName", "N/A"))
        table.add_row("Type", machine.get("type", "N/A"))
        table.add_row("Ship Date", machine.get("shipDate", "N/A"))
        table.add_row("Ship To Country", machine.get("shipToCountry", "N/A"))
        table.add_row("End of Service", machine.get("eosDate", "N/A"))
        with console.capture() as capture:
            console.print(table)
        machine_text = capture.get()
    else:
        machine_text = ""

    # Warranty status
    status = warranty_data.get("warrantyStatus", "Unknown")
    oow = warranty_data.get("oow", True)
    status_icon = "" if no_emoji else ("✅ " if not oow else "⚠️ ")

    status_table = Table(title="Warranty Status", show_header=True, header_style="bold cyan")
    status_table.add_column("Field", style="bold")
    status_table.add_column("Value")
    status_table.add_row("Status", f"{status_icon}{status}")
    status_table.add_row("Out of Warranty", str(oow))

    # Current warranty details
    current = warranty_data.get("currentWarranty", {})
    if current:
        start = current.get("startDate", "N/A")
        end = current.get("endDate", "N/A")
        remaining = _calc_remaining(end)
        status_table.add_row("Current Start", start)
        status_table.add_row("Current End", end)
        status_table.add_row("Remaining", remaining)

    # Base warranties
    base_warranties = warranty_data.get("baseWarranties", [])
    if base_warranties:
        w_table = Table(title="Base Warranties", show_header=True, header_style="bold cyan")
        w_table.add_column("Type")
        w_table.add_column("Name")
        w_table.add_column("Start")
        w_table.add_column("End")
        w_table.add_column("Status")
        for w in base_warranties:
            w_table.add_row(
                w.get("type", "N/A"),
                w.get("name", "N/A"),
                w.get("startDate", "N/A"),
                w.get("endDate", "N/A"),
                w.get("status", "N/A"),
            )
        with console.capture() as capture:
            console.print(w_table)
        warranty_text = capture.get()
    else:
        warranty_text = ""

    # Upgrade warranties
    upgrade_warranties = warranty_data.get("upgradeWarranties", [])
    if upgrade_warranties:
        u_table = Table(title="Upgrade Warranties", show_header=True, header_style="bold cyan")
        u_table.add_column("Type")
        u_table.add_column("Name")
        u_table.add_column("Start")
        u_table.add_column("End")
        u_table.add_column("Status")
        for w in upgrade_warranties:
            u_table.add_row(
                w.get("type", "N/A"),
                w.get("name", "N/A"),
                w.get("startDate", "N/A"),
                w.get("endDate", "N/A"),
                w.get("status", "N/A"),
            )
        with console.capture() as capture:
            console.print(u_table)
        upgrade_text = capture.get()
    else:
        upgrade_text = ""

    with console.capture() as capture:
        console.print(status_table)
    status_text = capture.get()

    return machine_text + status_text + warranty_text + upgrade_text


def _format_warranty_plain(data: dict) -> str:
    lines: list[str] = []
    machine = data.get("machineInfo", {})
    if machine:
        lines.append("=== Machine Information ===")
        lines.append(f"Serial:          {machine.get('serial', 'N/A')}")
        lines.append(f"Product:         {machine.get('product', 'N/A')}")
        lines.append(f"Name:            {machine.get('productName', 'N/A')}")
        lines.append(f"Type:            {machine.get('type', 'N/A')}")
        lines.append(f"Ship Date:       {machine.get('shipDate', 'N/A')}")
        lines.append(f"Ship To Country: {machine.get('shipToCountry', 'N/A')}")
        lines.append(f"End of Service:  {machine.get('eosDate', 'N/A')}")

    lines.append("")
    lines.append("=== Warranty Status ===")
    lines.append(f"Status:  {data.get('warrantyStatus', 'Unknown')}")
    lines.append(f"OOW:     {data.get('oow', 'N/A')}")

    current = data.get("currentWarranty", {})
    if current:
        lines.append(f"Current Start: {current.get('startDate', 'N/A')}")
        lines.append(f"Current End:   {current.get('endDate', 'N/A')}")
        remaining = _calc_remaining(current.get("endDate", "N/A"))
        lines.append(f"Remaining:     {remaining}")

    base = data.get("baseWarranties", [])
    if base:
        lines.append("")
        lines.append("=== Base Warranties ===")
        for w in base:
            lines.append(f"  {w.get('name', 'N/A')} ({w.get('type', 'N/A')})")
            lines.append(f"    Start: {w.get('startDate', 'N/A')}  End: {w.get('endDate', 'N/A')}  Status: {w.get('status', 'N/A')}")

    upgrade = data.get("upgradeWarranties", [])
    if upgrade:
        lines.append("")
        lines.append("=== Upgrade Warranties ===")
        for w in upgrade:
            lines.append(f"  {w.get('name', 'N/A')} ({w.get('type', 'N/A')})")
            lines.append(f"    Start: {w.get('startDate', 'N/A')}  End: {w.get('endDate', 'N/A')}  Status: {w.get('status', 'N/A')}")

    return "\n".join(lines)


def _calc_remaining(end_date: str) -> str:
    """Calculate remaining time from an ISO date string."""
    try:
        end = datetime.fromisoformat(end_date[:10])
        now = datetime.now()
        delta = end - now
        if delta.days < 0:
            return f"Expired ({abs(delta.days)} days ago)"
        months = delta.days // 30
        days = delta.days % 30
        return f"{months} months, {days} days ({delta.days} days)"
    except (ValueError, TypeError):
        return "N/A"


# ---------------------------------------------------------------------------
# Combined report
# ---------------------------------------------------------------------------

def format_report(
    product: list[dict],
    drivers: dict,
    warranty: dict,
    fmt: str = FormatMode.RICH,
    no_emoji: bool = False,
    **driver_kwargs: Any,
) -> str:
    """Format a full device report combining product, drivers, and warranty."""
    sections: list[str] = []

    if product:
        sections.append(format_product(product, fmt=fmt, no_emoji=no_emoji))

    if drivers:
        sections.append(format_drivers(drivers, fmt=fmt, no_emoji=no_emoji, **driver_kwargs))

    if warranty:
        sections.append(format_warranty(warranty, fmt=fmt, no_emoji=no_emoji))

    # For JSON, combine into a single object
    if fmt == FormatMode.JSON:
        return _json.dumps(
            {"product": product, "drivers": drivers, "warranty": warranty},
            indent=2,
            default=str,
        )

    separator = "\n\n"
    return separator.join(s for s in sections if s)