# LORE — Project Status

## Current Phase: v1.0.0 — Tauri Desktop App

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
| Linux binary | ✅ | 15MB, needs webkit2gtk-4.1 + gtk3 |
| Windows CI build | 🔄 | GitHub Actions running |
| Warranty tab | ⚠️ | Code correct, but Lenovo API under maintenance May 16-17 |

### Build Artifacts (Linux)

- Binary: `src-tauri/target/release/lore` (15MB)
- AppImage: `src-tauri/target/release/bundle/appimage/LORE-x86_64.AppImage` (92MB)
- .deb: `src-tauri/target/release/bundle/deb/LORE_1.0.0_amd64.deb` (5.5MB)
- .rpm: `src-tauri/target/release/bundle/rpm/LORE-1.0.0-1.x86_64.rpm` (5.5MB)

### Git Tags

- `v0.1.0-python` — Legacy Python version (preserved)
- `v1.0.0` — Current Tauri release

### Key Files

- `src/index.html` — Full UI (single-file, dark theme)
- `src/app.js` — Vite entry (just imports styles.css)
- `src/styles.css` — Minimal (styles inline in index.html)
- `src-tauri/src/lib.rs` — Tauri commands + WebKitGTK workarounds
- `src-tauri/src/client.rs` — Lenovo API client
- `src-tauri/src/cache.rs` — Disk cache with TTL
- `src-tauri/tauri.conf.json` — Window 1200×1400, CSP enabled, NSIS DE/EN

### Test Machine

- IPL-PC-NEXUS (192.168.178.56), Arch Linux, NVIDIA GPU
- SCP: `scp lore thomasb@192.168.178.56:/home/thomasb/Downloads/`

### Open Items

- [ ] Retest warranty tab after Lenovo maintenance ends (May 17 ~13:00 MEZ)
- [ ] Test Windows build from CI
- [ ] Verify all functionality on NEXUS (search, readme fetch, filters, expand/collapse)
- [ ] Consider proper CSP hardening for production

### Completed (2026-05-16)

- ✅ Rebuilt all packages with all fixes applied
- ✅ Cleaned up debug artifacts (test.html, unused imports)
- ✅ Enabled CSP (was null)
- ✅ Rewrote README (installation, architecture, Linux requirements)
- ✅ Created GitHub Actions CI (Linux + Windows)
- ✅ Fixed CI permission error (private repo needs `contents: write`)
- ✅ Added versioned Windows portable exe to CI
- ✅ Tagged v1.0.0, deleted v0.2.0-tauri