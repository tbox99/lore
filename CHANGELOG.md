# Changelog

All notable changes to LORE will be documented in this file.

## [1.1.1] — 2026-05-17

### Changed

- Release note fetching now only accepts Lenovo readme URLs from download.lenovo.com and pcsupport.lenovo.com.
- Lenovo API query parameters are URL-encoded through the HTTP client instead of being concatenated manually.
- Backend Lenovo requests no longer hold a global application mutex for the full network request duration.
- The app footer now shows the current LORE version dynamically from Tauri, integrated into the driver footer on result pages.
- Workstations browse now covers ThinkStation C, D, E, P, and S series; Tablets and Accessories use real Lenovo subcategory keys instead of empty root stubs.
- Driver OS badges now also use OS metadata from Lenovo file entries, which fixes missing badge coloring for monitor drivers.
- Product browse now supports the mouse back button for stepping back one category level.

### Fixed

- Rust formatting and Clippy warnings are clean for the current backend checks.

## [1.1.0] — 2026-05-17

### Added

- **Guided Browse by Product** — drill-down navigation matching Lenovo's product hierarchy (Category → Series → SubSeries → Machine Type)
- **Browse categories** matching Lenovo: Laptops, Desktops & All-in-Ones, Workstations, Tablets, Monitors, Accessories, Chromebook Laptops
- **Series dropdown navigation** — per-level dropdown selector alongside browse cards
- **Breadcrumb navigation** for browse path (Home > Laptops > T Series Laptops (ThinkPad) > …)
- **Driver list CSS Grid layout** — structured columns for name, version, date, priority, OS instead of flex with uneven spacing
- **Driver sorting** — by Priority, Newest first, Oldest first
- **OS filter pills** — Win 11 and Win 10 quick-filter buttons
- **Color-coded OS badges** — Win 11 (blue), Win 10 (green), mixed (purple)
- **Copy icon button** — SVG clipboard icon replaces `[copy]` text for download/readme URLs; briefly shows checkmark on success
- **Machine Type display** — extracts MT codes from product name (e.g. `20R3 / 20R4`) instead of raw `Product.SubSeries`
- **`npm run build:all`** — single command for full Tauri build including AppImage workarounds
- **`npm run build:appimage`** — AppImage-only build with Arch Linux fixes

### Changed

- **Browse by Product** completely reworked from flat card dump to guided hierarchical drill-down
- **Priority detection** now reads `item.Priority`, `Files[0].Priority`, `item.PriorityWeight`, and `Files[0].PriorityWeight` — more reliable on varied Lenovo API responses
- **AppImage build on Arch Linux** — `scripts/tauri-wrapper.mjs` sets `NO_STRIP=1` and creates a temporary local `gdk-pixbuf-2.0.pc` to work around `linuxdeploy` failures (old bundled `strip` can't read `.relr.dyn` sections; Arch's `gdk-pixbuf_binarydir` points to missing directory)

### Fixed

- Browse loop: series containers (e.g. `T-Series`) no longer reappear after already selecting that series
- Browse race condition: stale API responses are now discarded when navigating back before the response arrives
- Vite build warning: `emptyOutDir: true` added to clear stale artifacts from `dist/` before each build
- Missing priority dots: Critical/Recommended values from alternative API fields are now detected
- AppImage bundling failure on Arch Linux due to `linuxdeploy` incompatibilities

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
