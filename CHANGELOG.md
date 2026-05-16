# Changelog

All notable changes to LORE will be documented in this file.

## [1.0.0] — 2026-05-16

### Added

- **Tauri 2.0 desktop app** — full rewrite from Python CLI/TUI/WebUI to native Rust+Tauri
- **Serial/MTM/Model lookup** — identify any Lenovo device by serial number, MTM prefix, or model name
- **Driver listing** — card-based UI with expand/collapse details, category and priority filters, text search
- **Warranty tab** — machine info, base/upgrade warranties, status badges (Lenovo API had maintenance outage May 16–17)
- **On-demand release notes** — fetch and parse Lenovo readme pages with concurrent loading (max 3)
- **Disk caching** — 1h product, 6h drivers, 24h warranty TTL
- **NVIDIA/WebKitGTK workarounds** — automatic `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`, `GDK_BACKEND=x11`
- **Emoji rendering** — colored HTML spans instead of Unicode (WebKitGTK can't render emojis)
- **External links** — open in system browser via `tauri-plugin-opener`
- **Model/MTM search** — autocomplete dropdown with "← New Search" back button
- **Browse by Product** — 6 category cards, `browse_products` Tauri command
- **Priority dots** — 14px color-coded (critical=red, recommended=yellow, optional=grey)
- **Serial line display** — shown only for real serials (8+ chars, not equal to MTM)
- **CSP** — `default-src 'self'; connect-src 'self' https://pcsupport.lenovo.com`
- **Dark mode** — Lenovo red accent, card-based layout, responsive design
- **CI/CD** — GitHub Actions workflow for Linux + Windows builds (private repo)
  - Linux: `.deb`, `.rpm`, AppImage (via `tauri-action`)
  - Windows: `.msi`, `.exe` installer, portable exe (`LORE-{version}-portable-x64.exe`)
  - Tag push → Draft Release with all assets
  - Branch push → Artifacts only
- **NSIS installer** — DE/EN language selector
- **Versioned portable exe** — `LORE-1.0.0-portable-x64.exe`

### Changed

- **Rebranded** from Lenovo-branded to "LORE — Lenovo Online Research & Equipment"
- **Responsive design** — 4 breakpoints (480px, 768px, 769px, 1200px+)
- **Two-column card layout** — left: driver info + URL, right: description; mobile stacks vertically
- **Full URL display** — links show `https://` prefix
- **Window size** — 1200×1400 (was 600×500 → 800×550 → 1200×800)

### Fixed

- Machine Type extraction: prefers `Mtm` field, then "- Type XXXX" suffix, then last ID segment
- Warranty data parsing: handles `result.data` and full result shapes
- Improved warranty error message for API outages

### Removed

- Python CLI/TUI/WebUI (preserved as tag `v0.1.0-python`)
- Debug `test.html` artifact
- Unused `Manager` import from `lib.rs`
- Old tags (`v0.1.0-python`, `v0.2.0-tauri`) — clean `v1.0.0` only

### Legacy

- **v0.1.0-python** — Original Python CLI/TUI/WebUI version (preserved as git tag)
- **v0.2.0-tauri** — Deleted (was intermediate Tauri attempt)

---

## [0.1.0-python] — 2026-05-15

### Added

- CLI interface for Lenovo Support API
- Interactive TUI with Textual
- Browser-based WebUI (PyWebView + HTTP server)
- Driver listing with search and filter
- Warranty status display
- Release notes fetching from Lenovo readme pages
- Lenovo corporate design (dark theme, red accents)
- Responsive web UI with collapsible cards
- Two-column card layout
- Clipboard and focus fixes

---

*LORE is not affiliated with Lenovo. It uses publicly available Lenovo Support APIs.*