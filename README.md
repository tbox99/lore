# LORE — Lenovo Online Research & Equipment

A cross-platform desktop application for querying Lenovo Support APIs — device identity, driver listings, and warranty status — by serial number or MTM prefix.

Works on **Windows** and **Linux** as a native desktop app. No Python, no terminal, no browser required.

## What LORE Does

- **Serial/MTM Lookup** — Identify any Lenovo device by serial number or machine type model prefix
- **Driver Listing** — Browse available drivers, BIOS updates, and software, filtered by category or priority
- **Warranty Info** — Check warranty status, coverage dates, and remaining duration
- **On-demand Release Notes** — Fetch and display driver release notes from Lenovo readme pages

## Architecture

LORE is built as a **Tauri 2.0 desktop app**:

- **Frontend**: HTML/CSS/JS (dark theme, Lenovo red accent, card-based driver listing)
- **Backend**: Rust (Tauri commands for Lenovo API calls, caching, release note parsing)
- **Packaging**: Native installers for Windows (`.msi`/`.exe`) and Linux (`.deb`/`.AppImage`)

### Project Structure

```
lore/
├── src/                    # Frontend (HTML/CSS/JS)
│   ├── index.html          # Main UI
│   ├── styles.css          # Dark theme styles
│   └── app.js              # Frontend logic (Tauri invoke)
├── src-tauri/              # Rust backend (Tauri)
│   ├── Cargo.toml          # Rust dependencies
│   ├── build.rs            # Tauri build script
│   ├── tauri.conf.json     # Tauri config (window, security, bundling)
│   ├── icons/              # App icons (PNG, ICO)
│   └── src/
│       ├── main.rs         # Tauri entry + commands
│       ├── client.rs       # Lenovo API client (reqwest, caching)
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

### API Endpoints (preserved from Python)

- **Product Lookup**: `GET https://pcsupport.lenovo.com/api/v4.0/mse/getproducts?productId={serial}`
- **Driver Listing**: `GET https://pcsupport.lenovo.com/api/v4.0/downloads/drivers?productId={path}`
- **Warranty**: `POST https://pcsupport.lenovo.com/api/v4.0/upsell/redport/getIbaseInfo`

## Development

### Prerequisites

- **Rust** 1.70+ (`rustup`)
- **Node.js** 18+ and npm
- System dependencies:
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `libssl-dev`
  - **Windows**: WebView2 (usually pre-installed on Windows 10+)

### Setup

```bash
# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

### Build Targets

- **Windows**: `.msi` and `.exe` (NSIS) installers
- **Linux**: `.deb` and `.AppImage`

## Features

- **Dark mode** with automatic system preference detection
- **Card-based driver listing** with expand/collapse details
- **Priority badges** (Critical, Recommended, Optional) with color coding
- **Category filtering** with pill-style buttons
- **Text search** across driver titles
- **One-click URL copy** for driver downloads
- **Release notes** fetched on demand with concurrent loading
- **Warranty tab** with machine info, base/upgrade warranties, and status badges
- **Disk caching** (1h product, 6h drivers, 24h warranty) for fast repeat lookups

## Legacy Python Version

The original Python CLI/TUI/WebUI version is preserved as tag `v0.1.0-python`.

```bash
git checkout v0.1.0-python  # View legacy Python code
```

## License

See [LICENSE](LICENSE).

## Credits

LORE is not affiliated with Lenovo. It uses publicly available Lenovo Support APIs.