# LORE — Lenovo Online Research & Equipment

A cross-platform desktop application for querying Lenovo Support APIs — device identity, driver listings, and warranty status — by serial number or MTM prefix.

Works on **Windows** and **Linux** as a native desktop app. No Python, no terminal, no browser required.

## What LORE Does

- **Serial/MTM Lookup** — Identify any Lenovo device by serial number or machine type model prefix
- **Driver Listing** — Browse available drivers, BIOS updates, and software, filtered by category or priority
- **Warranty Info** — Check warranty status, coverage dates, and remaining duration
- **On-demand Release Notes** — Fetch and display driver release notes from Lenovo readme pages

## Installation

### Linux (Arch, Debian, Fedora)

**AppImage** (recommended — no install needed):
```bash
chmod +x LORE-x86_64.AppImage
./LORE-x86_64.AppImage
```

**Binary** (for Arch or custom setups):
```bash
sudo cp lore /usr/local/bin/
lore
```

> The binary and AppImage automatically apply WebKitGTK workarounds for NVIDIA GPUs.
> Requires: `webkit2gtk-4.1` and `gtk3` (`sudo pacman -S webkit2gtk-4.1 gtk3` on Arch)

**Debian/Ubuntu:**
```bash
sudo dpkg -i LORE_1.1.0_amd64.deb
```

**Fedora/RHEL:**
```bash
sudo rpm -i LORE-1.1.0-1.x86_64.rpm
```

### Linux System Requirements

- `webkit2gtk-4.1` — required for the webview renderer
- `gtk3` — required for the window framework

On Arch Linux: `sudo pacman -S webkit2gtk-4.1 gtk3`

> **Note:** On systems with NVIDIA GPUs, LORE automatically sets
> `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`,
> and `GDK_BACKEND=x11` to avoid known WebKitGTK rendering issues.

### Windows

1. Download the `.msi` or `.exe` installer from releases
2. Run the installer — WebView2 is bundled or auto-installed
3. Launch LORE from the Start Menu or desktop shortcut

## Architecture

LORE is built as a **Tauri 2.0 desktop app**:

- **Frontend**: HTML/CSS/JS (dark theme, Lenovo red accent, card-based driver listing)
- **Backend**: Rust (Tauri commands for Lenovo API calls, caching, release note parsing)
- **Packaging**: Native installers for Windows (`.msi`/`.exe`) and Linux (`.deb`/`.AppImage`)

### Project Structure

```
lore/
├── src/                    # Frontend (HTML/CSS/JS)
│   ├── index.html          # Main UI (single-file, original webui.html)
│   ├── styles.css          # Vite entry point (styles are inline in index.html)
│   └── app.js              # Vite entry point (logic is inline in index.html)
├── src-tauri/              # Rust backend (Tauri)
│   ├── Cargo.toml          # Rust dependencies
│   ├── build.rs            # Tauri build script
│   ├── tauri.conf.json     # Tauri config (window, security, bundling)
│   ├── capabilities/       # Tauri v2 permission capabilities
│   ├── icons/              # App icons (PNG, ICO)
│   └── src/
│       ├── main.rs         # Entry point
│       ├── lib.rs          # Tauri commands + WebKitGTK workarounds
│       ├── client.rs       # Lenovo API client (reqwest, session cookies, retry)
│       └── cache.rs        # Disk-based cache with TTL
├── package.json            # Node frontend tooling (Vite)
├── vite.config.js          # Vite config for Tauri
└── README.md
```

### Key Tauri Commands

| Command | Description |
|---------|-------------|
| `search(serial)` | Look up a device by serial/MTM, fetch drivers + warranty |
| `fetch_readme(url)` | Fetch and parse a driver readme page |
| `clear_cache()` | Clear the disk cache |

### API Endpoints

- **Product Lookup**: `GET https://pcsupport.lenovo.com/api/v4.0/mse/getproducts?productId={serial}`
- **Driver Listing**: `GET https://pcsupport.lenovo.com/api/v4.0/downloads/drivers?productId={path}`
- **Warranty**: `POST https://pcsupport.lenovo.com/api/v4.0/upsell/redport/getIbaseInfo`

## Development

### Prerequisites

- **Rust** 1.70+ (`rustup`)
- **Node.js** 18+ and npm
- System dependencies:
  - **Linux**: `webkit2gtk-4.1`, `gtk3`, `libappindicator3`, `librsvg2-dev`, `libssl-dev`
  - **Windows**: WebView2 (pre-installed on Windows 10+)

### Setup

```bash
npm install
npm run tauri dev      # Development mode with hot reload
npm run build:all     # Production build (all bundles, includes Arch/AppImage fixes)
npm run build:appimage # AppImage-only build
```

### Build Artifacts

| Target | Path |
|--------|------|
| Binary | `src-tauri/target/release/lore` |
| AppImage | `src-tauri/target/release/bundle/appimage/LORE-x86_64.AppImage` |
| Debian | `src-tauri/target/release/bundle/deb/LORE_1.1.0_amd64.deb` |
| RPM | `src-tauri/target/release/bundle/rpm/LORE-1.1.0-1.x86_64.rpm` |
| Windows MSI | `src-tauri/target/release/bundle/msi/LORE_1.0.0_x64_en-US.msi` |

## Features

- **Dark mode** with automatic system preference detection
- **Guided Browse by Product** — hierarchical drill-down matching Lenovo's product categories (Laptops, Desktops, Workstations, Tablets, Monitors, Accessories)
- **Breadcrumb navigation** through browse path (Category → Series → SubSeries → Machine Type)
- **Driver list grid layout** — structured columns for name, version, date, priority, OS
- **Driver sorting** — by Priority, Newest first, Oldest first
- **OS filter pills** — Win 11 / Win 10 quick-filter with color-coded badges
- **Priority badges** (Critical, Recommended, Optional) with color coding
- **Category filtering** with pill-style buttons
- **Priority filtering** (Critical, Recommended, Optional)
- **Text search** across driver titles
- **Expand/Collapse All** toggle for driver cards
- **One-click URL copy** — clipboard icon for download and readme links
- **Release notes** fetched on demand with concurrent loading (max 3)
- **Warranty tab** with machine info, base/upgrade warranties, and status badges
- **Disk caching** (1h product, 6h drivers, 24h warranty) for fast repeat lookups
- **NVIDIA/WebKitGTK compatibility** — automatic workarounds for Linux GPU issues
- **AppImage build on Arch Linux** — automatic workarounds for `linuxdeploy` incompatibilities

## Legacy Python Version

The original Python CLI/TUI/WebUI version is preserved as tag `v0.1.0-python`.

```bash
git checkout v0.1.0-python  # View legacy Python code
```

To uninstall the Python version:
```bash
rm -rf ~/.local/share/lore/
rm -f ~/.local/bin/lore
```

## Disclaimer

LORE is not affiliated with, endorsed by, or connected to Lenovo Group Limited or any of its subsidiaries.
Lenovo, ThinkPad, IdeaPad, Yoga, and other product names are trademarks of their respective owners.
LORE uses publicly available Lenovo Support APIs that require no authentication or special access.

## License

This project is licensed under the [MIT License](LICENSE).