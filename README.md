# LORE — Lenovo Online Research & Equipment

A cross-platform desktop application for querying Lenovo Support APIs — device identity, driver listings, and warranty status — by serial number or MTM prefix.

Works on **Windows** and **Linux** as a native desktop app. No terminal, no browser required.

## Features

- **Serial/MTM Lookup** — identify any Lenovo device by serial number or machine type model prefix
- **Guided Browse by Product** — drill down through Lenovo's product categories (Laptops, Desktops, Workstations, Tablets, Monitors, Accessories, Chromebooks) to find your device
- **Browse navigation** — Category → Series → SubSeries → Machine Type, with breadcrumb links and mouse back-button support
- **Driver Listing** — browse drivers, BIOS updates, and software with grid layout and sorting
- **Driver sorting** — by Priority, Newest first, or Oldest first
- **OS filtering** — quick-filter by Windows 10 / Windows 11 with color-coded badges
- **Priority badges** — Critical (red), Recommended (yellow), Optional (grey)
- **Category filtering** — pill-style category buttons
- **On-demand Release Notes** — fetch and display driver release notes from allowlisted Lenovo readme URLs
- **One-click URL copy** — clipboard icon for download and readme links
- **Warranty Info** — check warranty status, coverage dates, and remaining duration
- **Dark mode** — Lenovo red accent, card-based layout, responsive design
- **Visible app version** — current release shown in the app footer
- **Disk caching** — 1h product, 6h drivers, 24h warranty TTL for fast repeat lookups
- **NVIDIA/WebKitGTK compatibility** — automatic workarounds for Linux GPU issues

## Installation

### Linux

**AppImage** (recommended — no install needed):
```bash
chmod +x LORE_1.1.1_amd64.AppImage
./LORE_1.1.1_amd64.AppImage
```

**Debian/Ubuntu:**
```bash
sudo dpkg -i LORE_1.1.1_amd64.deb
```

**Fedora/RHEL:**
```bash
sudo rpm -i LORE-1.1.1-1.x86_64.rpm
```

**Binary** (Arch or custom setups):
```bash
sudo cp lore /usr/local/bin/
lore
```

### Linux System Requirements

- `webkit2gtk-4.1` — required for the webview renderer
- `gtk3` — required for the window framework

On Arch Linux: `sudo pacman -S webkit2gtk-4.1 gtk3`

> On systems with NVIDIA GPUs, LORE automatically sets `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`, and `GDK_BACKEND=x11` to avoid known WebKitGTK rendering issues.

### Windows

1. Download the installer from [Releases](https://github.com/tbox99/lore/releases)
2. Run the `.msi` or `.exe` installer — WebView2 is bundled or auto-installed
3. Launch LORE from the Start Menu or desktop shortcut

A portable `.exe` is also available in Releases for running without installation.

## Architecture

LORE is a **Tauri 2.0 desktop app**:

- **Frontend**: HTML/CSS/JS (single-file UI, dark theme, Lenovo red accent)
- **Backend**: Rust (Lenovo API calls, caching, release note parsing, Lenovo URL validation)
- **Packaging**: Native installers for Windows (`.msi`/`.exe`) and Linux (`.deb`/`.rpm`/AppImage)

### Project Structure

```
lore/
├── src/
│   └── index.html          # Main UI (single-file, all HTML/CSS/JS)
├── src-tauri/
│   ├── Cargo.toml          # Rust dependencies
│   ├── tauri.conf.json     # Tauri config (window, security, bundling)
│   ├── capabilities/       # Tauri v2 permission capabilities
│   ├── icons/              # App icons (PNG, ICO)
│   └── src/
│       ├── main.rs         # Entry point
│       ├── lib.rs          # Tauri commands + WebKitGTK workarounds
│       ├── client.rs       # Lenovo API client (reqwest, session cookies, retry)
│       └── cache.rs        # Disk-based cache with TTL
├── scripts/
│   └── tauri-wrapper.mjs   # Build wrapper (Arch/AppImage workarounds)
├── package.json            # Node frontend tooling (Vite)
├── vite.config.js           # Vite config for Tauri
└── README.md
```

## Development

### Prerequisites

- **Rust** 1.70+ (`rustup`)
- **Node.js** 18+ and npm
- **Linux**: `webkit2gtk-4.1`, `gtk3`, `libappindicator3`, `librsvg2-dev`, `libssl-dev`
- **Windows**: WebView2 (pre-installed on Windows 10+)

### Setup

```bash
npm install
npm run tauri dev       # Development mode with hot reload
npm run build:all       # Production build (all bundles)
npm run build:appimage  # AppImage-only build
```

> On Arch Linux, `npm run build:all` and `npm run build:appimage` automatically apply workarounds for `linuxdeploy` incompatibilities (old bundled `strip` and missing `gdk-pixbuf` directory).

### Testing & CI

```bash
cd src-tauri
cargo fmt --check     # format check
cargo clippy -- -D warnings  # lint
cargo test            # unit tests
```

The CI workflow (`.github/workflows/ci.yml`) runs `cargo fmt`, `cargo clippy`, and `cargo test` on every push and PR to `main`. The unit test suite covers URL allowlisting, priority normalization, date conversion, title shortening, OS key extraction, string array field collection, and Serde roundtrips.

### Security and Robustness

- Release note fetching is restricted to Lenovo readme hosts: `download.lenovo.com` and `pcsupport.lenovo.com`.
- Lenovo API query parameters are URL-encoded by the HTTP client.
- Backend Lenovo requests can run concurrently without a global application-level client lock.

## Disclaimer

LORE is not affiliated with, endorsed by, or connected to Lenovo Group Limited or any of its subsidiaries.
Lenovo, ThinkPad, IdeaPad, Yoga, and other product names are trademarks of their respective owners.
LORE uses publicly available Lenovo Support APIs that require no authentication or special access.

## License

This project is licensed under the [MIT License](LICENSE).
