"""LORE WebView — Browser-based driver listing using a self-contained HTML page."""

from __future__ import annotations

import concurrent.futures
import json
import re
import tempfile
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from platformdirs import user_cache_dir

from .output import _short_title, _epoch_ms_to_date
from .support_client import DiskCache


# ---------------------------------------------------------------------------
# Data preparation for the webview
# ---------------------------------------------------------------------------

def _open_browser_app_mode(url: str) -> bool:
    """Try to open URL in a browser window without toolbars/tabs.
    
    Tries known browsers with --app flag (Chromium/Chrome) or equivalent.
    Falls back to returning False if no suitable browser found.
    """
    import shutil
    import subprocess

    # Common browser commands that support --app mode (no chrome)
    app_browsers = [
        # (command, extra_args)
        ("google-chrome-stable", ["--app={url}", "--window-size=1100,750"]),
        ("google-chrome", ["--app={url}", "--window-size=1100,750"]),
        ("chromium", ["--app={url}", "--window-size=1100,750"]),
        ("chromium-browser", ["--app={url}", "--window-size=1100,750"]),
        ("brave-browser", ["--app={url}", "--window-size=1100,750"]),
        ("microsoft-edge", ["--app={url}", "--window-size=1100,750"]),
        ("vivaldi", ["--app={url}", "--window-size=1100,750"]),
    ]

    for cmd, args_template in app_browsers:
        if shutil.which(cmd):
            try:
                args = [a.format(url=url) for a in args_template]
                subprocess.Popen(
                    [cmd] + args,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return True
            except (OSError, subprocess.SubprocessError):
                continue

    return False


def _build_readme_url(download_url: str) -> str:
    """Derive the readme HTML URL from the download URL."""
    if not download_url or download_url == "N/A":
        return ""
    # Strip query parameters (token auth)
    base = download_url.split("?")[0]
    # Get the last path segment to check for extension
    last_slash = base.rfind("/")
    if last_slash == -1:
        last_slash = 0
    filename = base[last_slash + 1:]
    if "." in filename:
        # Replace the file extension with .html
        base_no_ext = filename.rsplit(".", 1)[0]
        return base[:last_slash + 1] + base_no_ext + ".html"
    # No extension: just append .html
    return base + ".html"


# TTL for readme cache (24 hours)
_TTL_README = 3600 * 24

# Module-level readme cache (lazy-init on first use)
_readme_cache: DiskCache | None = None


def _get_readme_cache() -> DiskCache:
    """Get or create the readme DiskCache."""
    global _readme_cache
    if _readme_cache is None:
        _readme_cache = DiskCache()
    return _readme_cache


def _fetch_readme_changes(readme_url: str, client: Any) -> str:
    """Fetch a readme HTML page and extract 'Changes in this release'.

    Uses the provided httpx client for the request. Results are cached
    with a 24h TTL. Returns formatted HTML string or empty string on failure.
    """
    cache = _get_readme_cache()
    cache_key = f"readme:{readme_url}"
    cached = cache.get(cache_key, _TTL_README)
    if cached is not None:
        return cached if isinstance(cached, str) else ""
    try:
        resp = client.get(readme_url, timeout=5.0, follow_redirects=True)
        if resp.status_code != 200:
            cache.set(cache_key, "")
            return ""
        text = resp.text
        # Extract "Changes in this release" section (line-aware)
        html = _extract_changes_section(text)
        cache.set(cache_key, html)
        return html
    except Exception:
        cache.set(cache_key, "")
        return ""


def _extract_changes_section(html_text: str) -> str:
    """Extract the 'Changes in this release' section from Lenovo readme HTML.

    The readme uses accordion buttons (<button class="collapsible">) as section
    headers. We extract content between "Changes in This Release" and the
    next collapsible button.

    Falls back to plain-text extraction for readmes without the accordion pattern.

    Returns formatted HTML with bullet points, or empty string.
    """
    # Strategy 1: Find accordion "Changes in This Release" collapsible button
    changes_pattern = re.compile(
        r'<button[^>]*class="collapsible"[^>]*>\s*'
        r'Changes\s+in\s+(?:This|the)\s+Release\s*<',
        re.DOTALL | re.IGNORECASE,
    )
    changes_match = changes_pattern.search(html_text)

    if changes_match:
        # Find the card-body content div after this button
        after_button = html_text[changes_match.end():]
        card_pattern = re.compile(
            r'<div\s+class="card\s+card-body"[^>]*>(.*?)</div>\s*</div>',
            re.DOTALL,
        )
        card_match = card_pattern.search(after_button)
        if card_match:
            content_html = card_match.group(1)
            lines = _html_to_lines(content_html)
            # Remove leading "CHANGES IN THIS RELEASE" (redundant with our heading)
            if lines and re.match(r'CHANGES\s+IN\s+THIS\s+RELEASE', lines[0], re.IGNORECASE):
                lines = lines[1:]
            if lines:
                return _parse_changes_lines(lines)

    # Strategy 2: Fallback — plain text search for CHANGES IN THIS RELEASE
    # For simpler HTML or plain text readmes
    lines = _html_to_lines(html_text)
    start_idx = None
    for i, line in enumerate(lines):
        if re.search(r'CHANGES\s+IN\s+THIS\s+RELEASE', line, re.IGNORECASE):
            start_idx = i + 1  # skip the header line
            break

    if start_idx is None:
        return ""

    # Collect lines until a stop section
    stop_patterns = [
        re.compile(r'^\s*(Determining|Installing|Installation|Manual Install|Unattended)\b', re.IGNORECASE),
        re.compile(r'^\s*\d+\.\s+(Hold|Select|Press|Make|Open|Locate|Double|Type|Click|Follow)\b', re.IGNORECASE),
    ]

    section_lines = []
    for i in range(start_idx, len(lines)):
        line = lines[i].strip()
        if not line:
            continue
        stopped = False
        for pat in stop_patterns:
            if pat.match(line):
                stopped = True
                break
        if stopped:
            break
        section_lines.append(line)

    if not section_lines:
        return ""

    return _parse_changes_lines(section_lines)


def _html_to_lines(html_text: str) -> list[str]:
    """Convert HTML to a list of text lines, preserving structure."""
    text = re.sub(r'</p>', '\n', html_text)
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&gt;', '>', text)
    lines = [line.strip() for line in text.splitlines()]
    return [l for l in lines if l]


def _parse_changes_lines(lines: list[str]) -> str:
    """Parse lines into HTML with sections and bullet points."""
    sections = []  # list of (title, [items])
    current_title = None
    current_items = []

    for line in lines:
        # Check for section header like [Important updates]
        bracket_match = re.match(r"^\[([^\]]+)\]\s*$", line)
        if bracket_match:
            # Save previous section
            if current_items:
                sections.append((current_title, current_items))
                current_items = []
            current_title = bracket_match.group(1)
            continue

        # Check for bullet item starting with '- '
        bullet_match = re.match(r"^-\s+(.+)$", line)
        if bullet_match:
            current_items.append(bullet_match.group(1).strip())
            continue

        # Other text — could be a standalone line
        # Check for lines like "Nothing." that are content
        if line and not line.startswith("["):
            # Could be a note or continuation
            current_items.append(line)

    # Don't forget last section
    if current_items:
        sections.append((current_title, current_items))

    if not sections:
        return ""

    # Build HTML
    html_parts = []
    for title, items in sections:
        if title:
            html_parts.append(f"<strong>{_esc_html(title)}</strong>")
        lis = "\n".join(f"<li>{_esc_html(it)}</li>" for it in items)
        html_parts.append(f"<ul>\n{lis}\n</ul>")

    return "\n".join(html_parts)


def _format_release_notes_html(raw: str) -> str:
    """Convert raw release notes text into formatted HTML with bullet points.

    Parses sections like [Important updates], [New functions], [Problem fixes]
    and formats items starting with '- ' as <li> elements.
    """
    if not raw:
        return ""

    # Split by bracketed section headers like [Important updates]
    # Pattern: text before first bracket, then alternating [title] content pairs
    section_pattern = re.compile(r"\[([^\]]+)\]")
    splits = section_pattern.split(raw)
    # splits = [pre_text, section1_title, section1_content, section2_title, section2_content, ...]

    html_parts = []

    # Process pre-section content (items before first [Section])
    if splits and not raw.startswith("["):
        pre = splits[0].strip()
        if pre:
            html_parts.append(_format_items_as_list(pre))
        splits = splits[1:]

    # Process section-title + content pairs
    i = 0
    while i < len(splits) - 1:
        title = splits[i].strip()
        content = splits[i + 1].strip() if i + 1 < len(splits) else ""
        if title:
            html_parts.append(f"<strong>{_esc_html(title)}</strong>")
        if content:
            html_parts.append(_format_items_as_list(content))
        i += 2

    # Remaining text after last section
    if i < len(splits):
        remaining = splits[i].strip()
        if remaining:
            html_parts.append(_format_items_as_list(remaining))

    result = "\n".join(html_parts)
    return result if result else _esc_html(raw)


def _format_items_as_list(text: str) -> str:
    """Format text with '- ' items as an HTML <ul> list."""
    if not text:
        return ""
    # Split on '- ' bullet points
    items = re.split(r"\s*-\s+", text)
    items = [it.strip() for it in items if it.strip()]
    if not items:
        return ""
    lis = "\n".join(f"<li>{_esc_html(it)}</li>" for it in items)
    return f"<ul>\n{lis}\n</ul>"


def _esc_html(text: str) -> str:
    """Escape HTML special characters."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _prepare_webview_data(
    driver_data: dict,
    product_info: dict | None = None,
    serial: str = "",
    full_urls: bool = False,
    os_filter: str | None = None,
    category_filter: str | None = None,
    priority_filter: str | None = None,
    active_only: bool = False,
    no_readme: bool = False,
    readme_client: Any = None,
) -> dict:
    """Prepare driver data for embedding in the HTML page.

    Returns a dict with keys: serial, productName, drivers, categories, generatedAt.
    Each driver entry has: title, shortTitle, docId, summary, category, version,
    priority, url, size, sha256, released, updated, requireLogin, osKeys,
    readmeUrl, releaseNotes.
    """
    body = driver_data.get("body", driver_data)
    items = body.get("DownloadItems", [])

    # Apply server-side filters
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

    # Build driver entries
    drivers: list[dict] = []
    categories_set: set[str] = set()
    for item in filtered:
        files = item.get("Files", [])
        first_file = files[0] if files else {}
        date_unix = item.get("Date", {}).get("Unix")
        updated_unix = item.get("Updated", {}).get("Unix")
        title = item.get("Title", "N/A")
        category = item.get("Category", {}).get("Name", "Uncategorized")
        categories_set.add(category)

        drivers.append({
            "title": title,
            "shortTitle": _short_title(title) if not full_urls else title,
            "docId": item.get("DocId", "N/A"),
            "summary": item.get("Summary", ""),
            "category": category,
            "version": first_file.get("Version", "N/A"),
            "priority": first_file.get("Priority", "N/A"),
            "url": first_file.get("URL", "N/A"),
            "size": first_file.get("Size", "N/A"),
            "sha256": first_file.get("SHA256", "N/A"),
            "released": _epoch_ms_to_date(date_unix),
            "updated": _epoch_ms_to_date(updated_unix),
            "requireLogin": item.get("RequireLogin", False),
            "osKeys": item.get("OperatingSystemKeys", []),
            "readmeUrl": _build_readme_url(first_file.get("URL", "N/A")),
            "releaseNotes": "",
        })

    # Fetch readme release notes concurrently (unless skipped)
    if not no_readme and readme_client is not None:
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            future_to_idx = {}
            for idx, entry in enumerate(drivers):
                readme_url = entry["readmeUrl"]
                if readme_url:
                    future = executor.submit(_fetch_readme_changes, readme_url, readme_client)
                    future_to_idx[future] = idx
            for future in concurrent.futures.as_completed(future_to_idx):
                idx = future_to_idx[future]
                try:
                    changes = future.result()
                    drivers[idx]["releaseNotes"] = changes
                except Exception:
                    drivers[idx]["releaseNotes"] = ""

    categories = sorted(categories_set)
    product_name = (product_info or {}).get("Name", "Unknown Device")

    return {
        "serial": serial,
        "productName": product_name,
        "drivers": drivers,
        "categories": categories,
        "generatedAt": datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }


# ---------------------------------------------------------------------------
# URL display helper
# ---------------------------------------------------------------------------

def _strip_url(url: str) -> str:
    """Strip https:// and http:// prefix for display."""
    return url.removeprefix("https://").removeprefix("http://")


# ---------------------------------------------------------------------------
# HTML generation
# ---------------------------------------------------------------------------

def generate_html(
    driver_data: dict,
    product_info: dict | None = None,
    serial: str = "",
    full_urls: bool = False,
    os_filter: str | None = None,
    category_filter: str | None = None,
    priority_filter: str | None = None,
    active_only: bool = False,
    no_readme: bool = False,
    readme_client: Any = None,
) -> str:
    """Generate a self-contained HTML page with embedded driver data.

    Returns the complete HTML as a string.
    """
    data = _prepare_webview_data(
        driver_data,
        product_info=product_info,
        serial=serial,
        full_urls=full_urls,
        os_filter=os_filter,
        category_filter=category_filter,
        priority_filter=priority_filter,
        active_only=active_only,
        no_readme=no_readme,
        readme_client=readme_client,
    )

    data_json = json.dumps(data, default=str)

    return _HTML_TEMPLATE.replace("__LORE_DATA__", data_json)


# ---------------------------------------------------------------------------
# Browser opening
# ---------------------------------------------------------------------------

def open_webview(
    driver_data: dict,
    product_info: dict | None = None,
    serial: str = "",
    full_urls: bool = False,
    os_filter: str | None = None,
    category_filter: str | None = None,
    priority_filter: str | None = None,
    active_only: bool = False,
    no_readme: bool = False,
    readme_client: Any = None,
) -> str:
    """Generate an HTML page and open it in the default browser.

    Returns the path to the generated HTML file.
    """
    html = generate_html(
        driver_data,
        product_info=product_info,
        serial=serial,
        full_urls=full_urls,
        os_filter=os_filter,
        category_filter=category_filter,
        priority_filter=priority_filter,
        active_only=active_only,
        no_readme=no_readme,
        readme_client=readme_client,
    )

    # Write to a persistent location (cache dir, not /tmp which may be cleared)
    cache_dir = Path(user_cache_dir("lore", "lenovo"))
    cache_dir.mkdir(parents=True, exist_ok=True)

    safe_serial = "".join(c if c.isalnum() else "_" for c in serial)
    filename = f"drivers_{safe_serial}.html"
    html_path = cache_dir / filename
    html_path.write_text(html, encoding="utf-8")

    url = html_path.as_uri()

    # Try to open in app/kiosk mode (no browser chrome) via known browsers
    opened = _open_browser_app_mode(url)
    if not opened:
        webbrowser.open(url)

    return str(html_path)


# ---------------------------------------------------------------------------
# HTML template (self-contained)
# ---------------------------------------------------------------------------

_HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LORE — Drivers</title>
<style>
:root {
  --lenovo-red: #E2231A;
  --lenovo-dark-red: #B91C1C;
  --lenovo-yellow: #FFB900;
  --lenovo-gray: #5A5A5A;
  --dark-header: #1A1A1A;
  --bg: #F5F5F5;
  --bg-card: #FFFFFF;
  --bg-card-hover: #FAFAFA;
  --text: #333333;
  --text-muted: #666666;
  --text-link: #E2231A;
  --border: #E0E0E0;
  --border-card: #E0E0E0;
  --badge-critical-bg: #E2231A;
  --badge-critical-text: #FFFFFF;
  --badge-critical-border: #E2231A;
  --badge-recommended-bg: #FFB900;
  --badge-recommended-text: #333333;
  --badge-recommended-border: #FFB900;
  --badge-optional-bg: #5A5A5A;
  --badge-optional-text: #FFFFFF;
  --badge-optional-border: #5A5A5A;
  --shadow-hover: 0 2px 6px rgba(0,0,0,0.1);
  --filter-bg: #FFFFFF;
  --btn-active-bg: #E2231A;
  --btn-active-text: #FFFFFF;
  --btn-bg: #FFFFFF;
  --btn-text: #333333;
  --btn-border: #CCCCCC;
  --expand-bg: #F9F9F9;
  --footer-bg: #1A1A1A;
  --footer-text: #999999;
  --subheader-bg: #222222;
  --subheader-text: #CCCCCC;
}

@media (prefers-color-scheme: dark) {
  :root {
    --lenovo-red: #E2231A;
    --lenovo-dark-red: #B91C1C;
    --lenovo-yellow: #FFB900;
    --lenovo-gray: #5A5A5A;
    --dark-header: #1A1A1A;
    --bg: #0D0D0D;
    --bg-card: #1A1A1A;
    --bg-card-hover: #222222;
    --text: #E5E5E5;
    --text-muted: #999999;
    --text-link: #E2231A;
    --border: #333333;
    --border-card: #333333;
    --badge-critical-bg: #E2231A;
    --badge-critical-text: #FFFFFF;
    --badge-critical-border: #E2231A;
    --badge-recommended-bg: #FFB900;
    --badge-recommended-text: #0D0D0D;
    --badge-recommended-border: #FFB900;
    --badge-optional-bg: #5A5A5A;
    --badge-optional-text: #FFFFFF;
    --badge-optional-border: #5A5A5A;
    --shadow-hover: 0 2px 6px rgba(0,0,0,0.3);
    --filter-bg: #1A1A1A;
    --btn-active-bg: #E2231A;
    --btn-active-text: #FFFFFF;
    --btn-bg: #1A1A1A;
    --btn-text: #E5E5E5;
    --btn-border: #444444;
    --expand-bg: #111111;
    --footer-bg: #1A1A1A;
    --footer-text: #666666;
    --subheader-bg: #1A1A1A;
    --subheader-text: #999999;
  }
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  padding: 0;
}

.container {
  max-width: 100%;
  margin: 0 auto;
  padding: 0 16px;
}

/* ---- Top Bar ---- */
.top-bar {
  background: var(--dark-header);
  padding: 14px 24px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: sticky;
  top: 0;
  z-index: 100;
}
.top-bar .lore-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #E2231A;
  user-select: none;
  line-height: 1.2;
}
.top-bar .lore-subtitle {
  font-size: 13px;
  font-weight: 400;
  color: #CCCCCC;
  letter-spacing: 0.3px;
  margin-top: 2px;
}

/* ---- Sub-header ---- */
.sub-header {
  background: var(--subheader-bg);
  padding: 10px 24px;
  color: var(--subheader-text);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.sub-header .serial {
  font-family: 'SF Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  background: rgba(255,255,255,0.1);
  color: #E5E5E5;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 12px;
}
.sub-header .product-name {
  color: #CCCCCC;
}

/* ---- Filter bar ---- */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  margin: 16px 0;
  background: var(--filter-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  flex-wrap: wrap;
}
.filter-bar input[type="text"] {
  flex: 1;
  min-width: 200px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
}
.filter-bar input[type="text"]:focus {
  border-color: var(--lenovo-red);
  box-shadow: 0 0 0 2px rgba(226,35,26,0.15);
}
.filter-bar input[type="text"]::placeholder {
  color: var(--text-muted);
}
.filter-btn {
  padding: 6px 14px;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  color: var(--btn-text);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}
.filter-btn:hover {
  border-color: var(--lenovo-red);
  color: var(--lenovo-red);
}
.filter-btn.active {
  background: var(--btn-active-bg);
  color: var(--btn-active-text);
  border-color: var(--btn-active-bg);
}
.filter-btn.active:hover {
  background: var(--lenovo-dark-red);
  border-color: var(--lenovo-dark-red);
  color: #FFFFFF;
}

/* ---- Category section ---- */
.category-section {
  margin-bottom: 24px;
}
.category-header {
  font-size: 16px;
  font-weight: 700;
  padding-bottom: 6px;
  border-bottom: 2px solid var(--lenovo-red);
  margin-bottom: 10px;
  color: var(--text);
}
.category-count {
  font-weight: 400;
  color: var(--text-muted);
  font-size: 13px;
  margin-left: 4px;
}

/* ---- Driver card ---- */
.driver-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 4px;
  padding: 12px 14px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, background 0.15s ease;
  border-left: 3px solid var(--border-card);
  display: flex;
  flex-direction: row;
  gap: 16px;
}
.driver-card:hover {
  box-shadow: var(--shadow-hover);
  background: var(--bg-card-hover);
}
.driver-card.priority-critical {
  border-left-color: var(--lenovo-red);
}
.driver-card.priority-recommended {
  border-left-color: var(--lenovo-yellow);
}
.driver-card.priority-optional {
  border-left-color: var(--lenovo-gray);
}
.driver-card-left {
  flex: 1;
  min-width: 0;
}
.driver-card-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding-left: 12px;
  border-left: 1px solid var(--border-card);
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}
.driver-card-right .changes-label {
  font-weight: 700;
  color: var(--text);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  text-align: center;
  border-bottom: 1px solid var(--border-card);
  padding-bottom: 6px;
}
.driver-card-right .changes-text {
  color: var(--text-muted);
}
.driver-card-right .changes-text strong {
  color: var(--text);
  font-size: 12px;
  display: block;
  margin-top: 8px;
  margin-bottom: 2px;
  font-weight: 600;
}
.driver-card-right .changes-text ul {
  margin: 0;
  padding-left: 16px;
  list-style-type: disc;
}
.driver-card-right .changes-text li {
  margin-bottom: 2px;
}
.driver-card-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.driver-card-header .priority-dot {
  flex-shrink: 0;
  margin-top: 3px;
  font-size: 12px;
  line-height: 1;
}
.driver-card-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  flex: 1;
}
.driver-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  margin-left: 20px;
  flex-wrap: wrap;
  color: var(--text-muted);
  font-size: 13px;
}
.driver-meta .version {
  font-family: 'SF Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
}
.driver-url-row {
  margin-top: 4px;
  margin-left: 20px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.driver-url {
  color: var(--text-link);
  text-decoration: none;
  word-break: break-all;
  font-size: 12px;
  font-family: 'SF Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
.driver-url:hover {
  text-decoration: underline;
}
.copy-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1;
  flex-shrink: 0;
  transition: all 0.15s ease;
}
.copy-btn:hover {
  color: var(--lenovo-red);
  border-color: var(--lenovo-red);
}
.copy-btn.copied {
  color: #1a7f37;
  border-color: #1a7f37;
}

/* ---- Badge ---- */
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid;
  white-space: nowrap;
  letter-spacing: 0.3px;
}
.badge-critical {
  background: var(--badge-critical-bg);
  color: var(--badge-critical-text);
  border-color: var(--badge-critical-border);
}
.badge-recommended {
  background: var(--badge-recommended-bg);
  color: var(--badge-recommended-text);
  border-color: var(--badge-recommended-border);
}
.badge-optional {
  background: var(--badge-optional-bg);
  color: var(--badge-optional-text);
  border-color: var(--badge-optional-border);
}

/* ---- Expanded detail ---- */
.driver-detail {
  display: none;
  margin-top: 8px;
  margin-left: 20px;
  padding: 10px 12px;
  background: var(--expand-bg);
  border: 1px solid var(--border-card);
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-muted);
}
.driver-detail.visible {
  display: block;
}
.driver-detail table {
  width: 100%;
  border-collapse: collapse;
}
.driver-detail td {
  padding: 2px 8px 2px 0;
  vertical-align: top;
}
.driver-detail td:first-child {
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  width: 100px;
}
.driver-detail .sha256 {
  font-family: 'SF Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 11px;
  word-break: break-all;
}
.driver-detail .login-warning {
  color: var(--lenovo-yellow);
  font-style: italic;
  margin-top: 4px;
}

/* ---- Footer ---- */
footer {
  margin-top: 32px;
  padding: 14px 24px;
  background: var(--footer-bg);
  color: var(--footer-text);
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: -16px;
  margin-right: -16px;
}
.legend {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ---- No results ---- */
.no-results {
  text-align: center;
  padding: 40px 0;
  color: var(--text-muted);
  font-size: 15px;
}

/* ---- Responsive ---- */

/* Wide screens */
@media (min-width: 1200px) {
  .container {
    max-width: 100%;
    margin: 0 auto;
  }
}

/* Desktop (769px+): full layout */
@media (min-width: 769px) {
  html {
    font-size: 16px;
  }
}

/* Tablet (481px–768px) */
@media (max-width: 768px) {
  html {
    font-size: 15px;
  }
  .container {
    padding: 0 16px;
  }
  .top-bar {
    padding: 12px 16px;
  }
  .top-bar .lore-title {
    font-size: 24px;
  }
  .top-bar .lore-subtitle {
    font-size: 12px;
  }
  .filter-bar {
    flex-wrap: wrap;
    gap: 6px;
  }
  .filter-bar input[type="text"] {
    flex: 1 1 100%;
    min-width: 0;
  }
}

/* Mobile (< 480px) */
@media (max-width: 480px) {
  html {
    font-size: 14px;
  }
  .container {
    padding: 0 8px;
  }
  .top-bar {
    padding: 10px 12px;
  }
  .top-bar .lore-title {
    font-size: 20px;
  }
  .top-bar .lore-subtitle {
    font-size: 10px;
    color: #999999;
  }
  .sub-header {
    padding: 8px 12px;
    font-size: 12px;
  }
  .filter-bar {
    flex-direction: column;
    align-items: stretch;
    padding: 10px 10px;
    gap: 6px;
  }
  .filter-bar input[type="text"] {
    min-width: 0;
    width: 100%;
  }
  .filter-btn {
    min-height: 44px;
    padding: 8px 14px;
    font-size: 14px;
  }
  .driver-card {
    flex-direction: column;
    padding: 10px 10px;
  }
  .driver-card-right {
    border-left: none;
    padding-left: 0;
    padding-top: 8px;
    border-top: 1px solid var(--border-card);
  }
  .driver-meta {
    margin-left: 0;
  }
  .driver-url-row {
    margin-left: 0;
  }
  .driver-detail {
    margin-left: 0;
  }
  .category-header {
    font-size: 14px;
  }
  footer {
    margin-left: -8px;
    margin-right: -8px;
    padding: 12px;
  }
}
</style>
</head>
<body>
<div class="top-bar">
  <div class="lore-title">LORE</div>
  <div class="lore-subtitle">Lenovo Online Research & Equipment</div>
</div>
<div class="sub-header">
  <span>Serial:</span> <span class="serial" id="serial-display"></span>
  <span class="product-name" id="product-name"></span>
</div>

<div class="container">
  <div class="filter-bar">
    <input type="text" id="filter-input" placeholder="Filter drivers by title…">
    <button class="filter-btn active" data-priority="all">All</button>
    <button class="filter-btn" data-priority="Critical">Critical</button>
    <button class="filter-btn" data-priority="Recommended">Recommended</button>
    <button class="filter-btn" data-priority="Optional">Optional</button>
  </div>

  <div id="driver-list"></div>

  <footer>
    <div class="legend">
      <span class="legend-item"><span class="badge badge-critical">Critical</span></span>
      <span class="legend-item"><span class="badge badge-recommended">Recommended</span></span>
      <span class="legend-item"><span class="badge badge-optional">Optional</span></span>
    </div>
    <div id="generated-at"></div>
  </footer>
</div>

<script>
(function() {
  "use strict";

  var DATA = __LORE_DATA__;

  // ---- State ----
  var currentFilter = "";
  var currentPriority = "all";
  var expandedCards = {};

  // ---- Init ----
  document.getElementById("serial-display").textContent = DATA.serial;
  document.getElementById("product-name").textContent = DATA.productName;
  document.getElementById("generated-at").textContent = "Generated by LORE · " + DATA.generatedAt;

  // ---- Filter input ----
  var filterInput = document.getElementById("filter-input");
  filterInput.addEventListener("input", function() {
    currentFilter = this.value.toLowerCase();
    render();
  });

  // ---- Priority buttons ----
  var priorityBtns = document.querySelectorAll(".filter-btn");
  priorityBtns.forEach(function(btn) {
    btn.addEventListener("click", function() {
      currentPriority = this.getAttribute("data-priority");
      priorityBtns.forEach(function(b) { b.classList.remove("active"); });
      this.classList.add("active");
      render();
    });
  });

  // ---- Helpers ----
  function priorityClass(pri) {
    var p = (pri || "").toLowerCase();
    if (p === "critical") return "badge-critical";
    if (p === "recommended") return "badge-recommended";
    return "badge-optional";
  }

  function priorityCardClass(pri) {
    var p = (pri || "").toLowerCase();
    if (p === "critical") return "priority-critical";
    if (p === "recommended") return "priority-recommended";
    return "priority-optional";
  }

  function priorityDot(pri) {
    var p = (pri || "").toLowerCase();
    if (p === "critical") return "🔴";
    if (p === "recommended") return "🟡";
    return "⚪";
  }

  function stripUrl(url) {
    return url.replace(/^https?:\/\//, "");
  }

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ---- Render ----
  function render() {
    var container = document.getElementById("driver-list");
    container.innerHTML = "";

    // Filter drivers
    var drivers = DATA.drivers.filter(function(d) {
      if (currentFilter) {
        var t = (d.title || "").toLowerCase();
        var st = (d.shortTitle || "").toLowerCase();
        if (t.indexOf(currentFilter) === -1 && st.indexOf(currentFilter) === -1) return false;
      }
      if (currentPriority !== "all") {
        var pri = (d.priority || "").toLowerCase();
        if (pri !== currentPriority.toLowerCase()) return false;
      }
      return true;
    });

    if (drivers.length === 0) {
      container.innerHTML = '<div class="no-results">No drivers found.</div>';
      return;
    }

    // Group by category
    var cats = {};
    drivers.forEach(function(d) {
      var c = d.category || "Uncategorized";
      if (!cats[c]) cats[c] = [];
      cats[c].push(d);
    });

    var sortedCats = Object.keys(cats).sort();
    sortedCats.forEach(function(cat) {
      var section = document.createElement("div");
      section.className = "category-section";

      var header = document.createElement("div");
      header.className = "category-header";
      header.textContent = cat;
      var count = document.createElement("span");
      count.className = "category-count";
      count.textContent = "(" + cats[cat].length + ")";
      header.appendChild(count);
      section.appendChild(header);

      // Sort within category: Critical first, then Recommended, then other
      var priOrder = { critical: 0, recommended: 1 };
      cats[cat].sort(function(a, b) {
        var pa = priOrder[(a.priority || "").toLowerCase()] || 9;
        var pb = priOrder[(b.priority || "").toLowerCase()] || 9;
        return pa - pb;
      });

      cats[cat].forEach(function(d) {
        section.appendChild(createCard(d));
      });

      container.appendChild(section);
    });
  }

  function createCard(d) {
    var card = document.createElement("div");
    card.className = "driver-card " + priorityCardClass(d.priority);

    var idx = DATA.drivers.indexOf(d);
    var isExpanded = !!expandedCards[idx];

    // Header row
    var headerRow = document.createElement("div");
    headerRow.className = "driver-card-header";

    var dot = document.createElement("span");
    dot.className = "priority-dot";
    dot.textContent = priorityDot(d.priority);

    var title = document.createElement("span");
    title.className = "driver-card-title";
    title.textContent = d.shortTitle || d.title;

    // Left column
    var leftCol = document.createElement("div");
    leftCol.className = "driver-card-left";

    headerRow.appendChild(dot);
    headerRow.appendChild(title);
    leftCol.appendChild(headerRow);

    // Meta row
    var meta = document.createElement("div");
    meta.className = "driver-meta";

    var badge = document.createElement("span");
    badge.className = "badge " + priorityClass(d.priority);
    badge.textContent = d.priority;

    var ver = document.createElement("span");
    ver.className = "version";
    ver.textContent = "v" + (d.version || "N/A");

    var released = document.createElement("span");
    released.textContent = d.released || "N/A";

    meta.appendChild(badge);
    meta.appendChild(ver);
    meta.appendChild(released);
    leftCol.appendChild(meta);

    // URL row
    var urlRow = document.createElement("div");
    urlRow.className = "driver-url-row";

    var a = document.createElement("a");
    a.className = "driver-url";
    a.href = d.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = d.url;

    var copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "📋";
    copyBtn.title = "Copy URL";
    copyBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      copyToClipboard(d.url, copyBtn);
    });

    urlRow.appendChild(a);
    urlRow.appendChild(copyBtn);
    leftCol.appendChild(urlRow);

    // Detail panel
    var detail = document.createElement("div");
    detail.className = "driver-detail" + (isExpanded ? " visible" : "");

    var table = document.createElement("table");
    var rows = [
      ["Released", d.released || "N/A"],
      ["Updated", d.updated || "N/A"],
      ["Category", d.category || "N/A"],
      ["Size", d.size || "N/A"],
      ["DocId", d.docId || "N/A"],
    ];
    if (d.sha256 && d.sha256 !== "N/A") {
      rows.push(["SHA256", '<span class="sha256">' + escHtml(d.sha256) + '</span>']);
    }
    if (d.osKeys && d.osKeys.length > 0) {
      rows.push(["OS", escHtml(d.osKeys.join(", "))]);
    }

    rows.forEach(function(r) {
      var tr = document.createElement("tr");
      var td1 = document.createElement("td");
      td1.textContent = r[0];
      var td2 = document.createElement("td");
      // Allow HTML for SHA256
      if (r[1] && r[1].indexOf("<") >= 0) {
        td2.innerHTML = r[1];
      } else {
        td2.textContent = r[1];
      }
      tr.appendChild(td1);
      tr.appendChild(td2);
      table.appendChild(tr);
    });

    detail.appendChild(table);

    if (d.requireLogin) {
      var warn = document.createElement("div");
      warn.className = "login-warning";
      warn.textContent = "⚠ Login required to download";
      detail.appendChild(warn);
    }

    leftCol.appendChild(detail);

    // Right column (Release Notes or Summary)
    var rightCol = document.createElement("div");
    rightCol.className = "driver-card-right";

    if (d.releaseNotes) {
      var rnLabel = document.createElement("div");
      rnLabel.className = "changes-label";
      rnLabel.textContent = "Changes in this release";
      rightCol.appendChild(rnLabel);

      var rnText = document.createElement("div");
      rnText.className = "changes-text";
      rnText.innerHTML = d.releaseNotes;
      rightCol.appendChild(rnText);
    } else if (d.summary) {
      var summaryLabel = document.createElement("div");
      summaryLabel.className = "changes-label";
      summaryLabel.textContent = "Summary";
      rightCol.appendChild(summaryLabel);

      var summaryText = document.createElement("div");
      summaryText.className = "changes-text";
      summaryText.textContent = d.summary;
      rightCol.appendChild(summaryText);
    } else {
      var noSummary = document.createElement("div");
      noSummary.className = "changes-text";
      noSummary.style.fontStyle = "italic";
      noSummary.textContent = "No description available";
      rightCol.appendChild(noSummary);
    }

    card.appendChild(leftCol);
    card.appendChild(rightCol);

    // Toggle expand on click
    card.addEventListener("click", function() {
      expandedCards[idx] = !expandedCards[idx];
      detail.classList.toggle("visible");
    });

    return card;
  }

  function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(function() {
      btn.textContent = "✓";
      btn.classList.add("copied");
      setTimeout(function() {
        btn.textContent = "📋";
        btn.classList.remove("copied");
      }, 1500);
    }).catch(function() {
      // Fallback: select a hidden textarea
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch(e) {}
      document.body.removeChild(ta);
      btn.textContent = "✓";
      btn.classList.add("copied");
      setTimeout(function() {
        btn.textContent = "📋";
        btn.classList.remove("copied");
      }, 1500);
    });
  }

  // Initial render
  render();
})();
</script>
</body>
</html>"""