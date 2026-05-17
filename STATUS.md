# LORE — Project Status

## Current Phase: v1.0.0+patches — Tauri Desktop App

### Architecture

- **Frontend**: Single-file `index.html` (original webui.html preserved), Tauri `invoke()` with HTTP fallback
- **Backend**: Rust (reqwest, session cookies, retry/backoff, disk caching)
- **Packaging**: Tauri 2.0 — binary, .deb, .rpm, AppImage (Linux), .msi/.exe (Windows)
- **CI**: GitHub Actions (Linux + Windows), private repo, `permissions: contents: write`

### What Works

| Feature | Status | Notes |
|---------|--------|-------|
| Product Lookup (serial/MTM) | ✅ | Tauri command `search` |
| Driver Listing | ✅ | Cards with expand/collapse, category/priority filters |
| Release Notes (lazy load) | ✅ | `fetch_readme` command, max 3 concurrent |
| Disk Caching | ✅ | 1h product, 6h drivers, 24h warranty |
| NVIDIA/WebKitGTK workaround | ✅ | Set in Rust `run()` before GTK init |
| AppImage | ✅ | Works on IPL-PC-NEXUS (Arch, NVIDIA) |
| Linux binary | ✅ | 18MB, needs webkit2gtk-4.1 + gtk3 |
| Warranty tab | ⚠️ | Code correct, but Lenovo API under maintenance May 16-17 |
| Machine Type extraction | ✅ | Prefers `Mtm` field, then "- Type XXXX" suffix, then ID path |
| Browse by Product | 🔧 | UI and API in place, click-to-search flow has bug (see TODO) |
| Priority Dots | ✅ | 14px, color-coded (red/yellow/grey) |
| Back Button | ✅ | Lenovo-red, resets browse state |
| Capability Icons | ✅ | Static info cards, no hover/click |
| External links | ✅ | `window.__TAURI__.opener.openUrl()` |

### Build Artifacts (Linux)

- Binary: `src-tauri/target/release/lore` (18MB)
- AppImage: `src-tauri/target/release/bundle/appimage/LORE-x86_64.AppImage`
- .deb: `src-tauri/target/release/bundle/deb/LORE_1.0.0_amd64.deb`
- .rpm: `src-tauri/target/release/bundle/rpm/LORE-1.0.0-1.x86_64.rpm`

### Git Tags

- `v0.1.0-python` — Legacy Python version (preserved)
- `v1.0.0` — Current Tauri release

### Key Files

- `src/index.html` — Full UI (single-file, dark theme)
- `src/app.js` — Vite entry (just imports styles.css)
- `src/styles.css` — Minimal (styles inline in index.html)
- `src-tauri/src/lib.rs` — Tauri commands + WebKitGTK workarounds
- `src-tauri/src/client.rs` — Lenovo API client, `extract_machine_type()`
- `src-tauri/src/cache.rs` — Disk cache with TTL
- `src-tauri/tauri.conf.json` — Window 1200×1400, CSP, img-src for Lenovo CDN

### Test Machine

- IPL-PC-NEXUS (192.168.178.56), Arch Linux, NVIDIA GPU
- SCP: `scp lore thomasb@192.168.178.56:/home/thomasb/Downloads/`
- **Always clear cache on NEXUS before testing**: `rm -rf ~/.cache/lore/`

### Open Items

- [ ] Retest warranty tab after Lenovo maintenance ends (May 17 ~13:00 MEZ)
- [ ] Verify all functionality on NEXUS
- [ ] Verify Browse UX/click flow on NEXUS (device pings, but no OpenClaw node and SSH auth is unavailable)

### Completed (2026-05-16)

- ✅ Fixed "Type: Product.Serial" → extract machine type from product name
- ✅ External links open in system browser (tauri-plugin-opener)
- ✅ Added model/MTM search with autocomplete dropdown
- ✅ Added "← New Search" back button (Lenovo-red style)
- ✅ Capability icons on welcome screen (static info cards)
- ✅ Serial line only shown for real serials (8+ chars, not equal to MTM)
- ✅ Search placeholder: "Enter serial number, MTM, or model name"
- ✅ Machine Type extraction: prefers `Mtm` field, then "- Type XXXX" suffix, then last ID segment
- ✅ Priority dots: 14px, color-coded (critical=red, recommended=yellow, optional=grey)
- ✅ Browse by Product: UI + `browse_products` Tauri command, 6 category cards
- ✅ CSP updated for Lenovo image CDN (`download.lenovo.com`, `p2-*.images.hereapi.com`)

### Completed (2026-05-17)

- ✅ Portable Windows exe tested successfully
- ✅ Browse loading skeleton, error/retry state, empty state, and narrow-window responsiveness implemented
- ✅ Browse click-to-search flow fixed in code: SubSeries drills down, MachineType/product paths normalize to short MTM before search
- ✅ Browse flow improved with Lenovo-style guided dropdown/grouping: product category → series → subseries/model → machine type
- ✅ Browse top-level changed from broad brand searches to Lenovo product categories to avoid mixing ThinkPad with ThinkBook/accessories
- ✅ Browse loop fixed: selected series containers are filtered out on the next level
- ✅ Result header now hides internal Lenovo product types and shows readable machine type values instead
- ✅ Driver collapsed rows use grid columns for title/version/date/priority/OS instead of right-pushed flex spacing
- ✅ Added Win 10 / Win 11 OS filter pills, colored OS badges, and newest/oldest date sorting
- ✅ Driver priority dots fixed to use item/file priority plus priority weight fallback, normalized to Critical/Recommended/Optional
- ✅ Download/readme copy buttons now use icon-only copy/check buttons instead of `[copy]` text
- ✅ Local verification passed: `npm run build`, `cargo check`, and product path normalization sample (`.../21YK` → `21YK`)
