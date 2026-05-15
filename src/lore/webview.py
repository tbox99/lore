"""LORE WebView — Browser-based driver listing using a self-contained HTML page."""

from __future__ import annotations

import json
import tempfile
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from platformdirs import user_cache_dir

from .output import _short_title, _epoch_ms_to_date


# ---------------------------------------------------------------------------
# Data preparation for the webview
# ---------------------------------------------------------------------------

def _prepare_webview_data(
    driver_data: dict,
    product_info: dict | None = None,
    serial: str = "",
    full_urls: bool = False,
    os_filter: str | None = None,
    category_filter: str | None = None,
    priority_filter: str | None = None,
    active_only: bool = False,
) -> dict:
    """Prepare driver data for embedding in the HTML page.

    Returns a dict with keys: serial, productName, drivers, categories, generatedAt.
    Each driver entry has: title, shortTitle, docId, summary, category, version,
    priority, url, size, sha256, released, updated, requireLogin, osKeys.
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
        })

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
    )

    # Write to a persistent location (cache dir, not /tmp which may be cleared)
    cache_dir = Path(user_cache_dir("lore", "lenovo"))
    cache_dir.mkdir(parents=True, exist_ok=True)

    safe_serial = "".join(c if c.isalnum() else "_" for c in serial)
    filename = f"drivers_{safe_serial}.html"
    html_path = cache_dir / filename
    html_path.write_text(html, encoding="utf-8")

    url = html_path.as_uri()
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
  --bg: #ffffff;
  --bg-card: #f6f8fa;
  --bg-card-hover: #f0f3f6;
  --text: #1f2328;
  --text-muted: #656d76;
  --text-link: #0969da;
  --border: #d0d7de;
  --border-card: #d8dee4;
  --badge-critical-bg: #ffebe9;
  --badge-critical-text: #82071e;
  --badge-critical-border: #ff818266;
  --badge-recommended-bg: #fff8c5;
  --badge-recommended-text: #7a5e00;
  --badge-recommended-border: #e3b34166;
  --badge-optional-bg: #eef1f4;
  --badge-optional-text: #57606a;
  --badge-optional-border: #d0d7de66;
  --shadow-hover: 0 2px 8px rgba(0,0,0,0.1);
  --header-bg: #f6f8fa;
  --filter-bg: #ffffff;
  --btn-active-bg: #0969da;
  --btn-active-text: #ffffff;
  --btn-bg: #f6f8fa;
  --btn-text: #1f2328;
  --btn-border: #d0d7de;
  --expand-bg: #f6f8fa;
  --footer-border: #d0d7de;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --bg-card: #161b22;
    --bg-card-hover: #1c2129;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --text-link: #58a6ff;
    --border: #30363d;
    --border-card: #30363d;
    --badge-critical-bg: #490202;
    --badge-critical-text: #ff7b72;
    --badge-critical-border: #f8514966;
    --badge-recommended-bg: #3b2e00;
    --badge-recommended-text: #e3b341;
    --badge-recommended-border: #e3b34166;
    --badge-optional-bg: #21262d;
    --badge-optional-text: #8b949e;
    --badge-optional-border: #30363d66;
    --shadow-hover: 0 2px 8px rgba(0,0,0,0.4);
    --header-bg: #161b22;
    --filter-bg: #0d1117;
    --btn-active-bg: #58a6ff;
    --btn-active-text: #0d1117;
    --btn-bg: #21262d;
    --btn-text: #e6edf3;
    --btn-border: #30363d;
    --expand-bg: #0d1117;
    --footer-border: #30363d;
  }
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  padding: 0;
}

.container {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 16px;
}

/* ---- Header ---- */
header {
  background: var(--header-bg);
  border-bottom: 1px solid var(--border);
  padding: 20px 0;
  margin-bottom: 16px;
}
header h1 {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 4px;
}
header .subtitle {
  color: var(--text-muted);
  font-size: 14px;
}
header .subtitle .serial {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  background: var(--badge-optional-bg);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 13px;
}

/* ---- Filter bar ---- */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.filter-bar input[type="text"] {
  flex: 1;
  min-width: 200px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--filter-bg);
  color: var(--text);
  font-size: 14px;
  outline: none;
}
.filter-bar input[type="text"]:focus {
  border-color: var(--text-link);
  box-shadow: 0 0 0 2px rgba(9,105,218,0.3);
}
.filter-bar input[type="text"]::placeholder {
  color: var(--text-muted);
}
.filter-btn {
  padding: 5px 12px;
  border: 1px solid var(--btn-border);
  border-radius: 6px;
  background: var(--btn-bg);
  color: var(--btn-text);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}
.filter-btn:hover {
  background: var(--bg-card-hover);
}
.filter-btn.active {
  background: var(--btn-active-bg);
  color: var(--btn-active-text);
  border-color: var(--btn-active-bg);
}

/* ---- Category section ---- */
.category-section {
  margin-bottom: 24px;
}
.category-header {
  font-size: 16px;
  font-weight: 600;
  padding-bottom: 6px;
  border-bottom: 2px solid var(--border);
  margin-bottom: 8px;
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
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: box-shadow 0.15s, background 0.15s;
}
.driver-card:hover {
  box-shadow: var(--shadow-hover);
  background: var(--bg-card-hover);
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
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
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
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
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
  transition: background 0.15s;
}
.copy-btn:hover {
  background: var(--bg-card-hover);
}
.copy-btn.copied {
  color: #1a7f37;
  border-color: #1a7f37;
}

/* ---- Badge ---- */
.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid;
  white-space: nowrap;
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
  border-radius: 6px;
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
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 11px;
  word-break: break-all;
}
.driver-detail .login-warning {
  color: var(--badge-recommended-text);
  font-style: italic;
  margin-top: 4px;
}

/* ---- Footer ---- */
footer {
  margin-top: 32px;
  padding: 12px 0;
  border-top: 1px solid var(--footer-border);
  color: var(--text-muted);
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
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
@media (max-width: 600px) {
  .filter-bar { flex-direction: column; align-items: stretch; }
  .filter-bar input[type="text"] { min-width: 0; }
  .driver-meta { margin-left: 0; }
  .driver-url-row { margin-left: 0; }
  .driver-detail { margin-left: 0; }
}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>LORE — Lenovo Online Research & Equipment</h1>
    <div class="subtitle">
      Serial: <span class="serial" id="serial-display"></span>
      &nbsp;·&nbsp; <span id="product-name"></span>
    </div>
  </header>

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
    card.className = "driver-card";

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

    headerRow.appendChild(dot);
    headerRow.appendChild(title);
    card.appendChild(headerRow);

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
    card.appendChild(meta);

    // URL row
    var urlRow = document.createElement("div");
    urlRow.className = "driver-url-row";

    var a = document.createElement("a");
    a.className = "driver-url";
    a.href = d.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = stripUrl(d.url);

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
    card.appendChild(urlRow);

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
    if (d.summary) {
      rows.push(["Summary", escHtml(d.summary)]);
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

    card.appendChild(detail);

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