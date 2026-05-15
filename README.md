# LORE — Lenovo Online Research & Equipment

<!-- Badges (uncomment when ready)
![Python Version](https://img.shields.io/python/required-version-toml?tomlFilePath=https://raw.githubusercontent.com/user/lore/main/pyproject.toml)
![License](https://img.shields.io/github/license/user/lore)
![PyPI](https://img.shields.io/pypi/v/lenovo-lore)
-->

A cross-platform command-line tool for querying Lenovo Support APIs — device identity, driver listings, and warranty status — by serial number or MTM prefix.

Works on **Windows**, **Linux**, and **macOS**. Python only, no browser required.

## What LORE Does

- **Serial/MTM Lookup** — Identify any Lenovo device by serial number or machine type model prefix
- **Driver Listing** — Browse available drivers, BIOS updates, and software, filtered by OS, category, or priority
- **Warranty Info** — Check warranty status, coverage dates, and remaining duration
- **Full Report** — Combined product + drivers + warranty in one command

## Installation

### From Source

```bash
git clone https://github.com/user/lore.git
cd lore
pip install .
```

### pipx (planned)

```bash
pipx install lenovo-lore
```

## Usage

### Global Options

```
lore [OPTIONS] COMMAND

Options:
  --version     Show version
  --json        Output as JSON
  --plain       Plain text output (no color, no emoji)
  --no-color   Disable colors
  --no-emoji   Disable emoji
  --no-cache   Bypass disk cache
  --refresh    Force fresh API calls (implies --no-cache)
```

### `lore lookup <serial>`

Identify a device by serial number or MTM prefix.

```bash
lore lookup PF4SQLH9
```

```
Product Information                                                   
┏━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Field      ┃ Value                                                           ┃
┡━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ Name       │ 🖥️ T14s Gen 4 (Type 21F8, 21F9) Laptop (ThinkPad) - Type 21F9 │
│ Type       │ Product.Serial                                                  │
│ Serial     │ PF4SQLH9                                                        │
│ Brand      │ TPG                                                             │
│ Image      │ https://download.lenovo.com/images/ProdImageLaptops/tp_t14s.jpg│
│ Supported  │ ✅ True                                                          │
│ Product ID │ LAPTOPS-AND-NETBOOKS/.../PF4SQLH9                               │
└────────────┴────────────────────────────────────────────────────────────────┘
```

### `lore drivers <serial>`

List available drivers for a device. Output is grouped by category, sorted alphabetically, with Critical items first within each category.

```bash
lore drivers PF4SQLH9
```

Each category gets its own table with columns: **Title**, **Version**, **Priority**, **Released**, **URL**.

```
BIOS/UEFI (2 items)                                                   
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Title                             ┃ Version  ┃ Priority         ┃ Released   ┃ URL                                    ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ ThinkPad Setup Settings Capture…  │ 5.12     │ 🟡 Recommended   │ 2025-12-19 │ https://download.lenovo.com/pccbbs/mo… │
│ BIOS Update (Utility & Bootable…  │ 1.71     │ 🟡 Recommended   │ 2026-05-12 │ https://download.lenovo.com/pccbbs/mo… │
└───────────────────────────────────┴──────────┴──────────────────┴────────────┴──────────────────────────────────────────┘

Software and Utilities (1 items)
┏━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Title               ┃ Version    ┃ Priority        ┃ Released   ┃ URL                                        ┃
┡━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ Lenovo MFGSTAT Lo…  │ 1.0.0.0    │ 🔴 Critical     │ 2025-12-24 │ https://download.lenovo.com/pccbbs/mobiles/…│
└─────────────────────┴────────────┴─────────────────┴────────────┴──────────────────────────────────────────────┘
```

**Driver Options:**

| Option | Description |
|--------|-------------|
| `--os TEXT` | Filter by operating system (e.g., `Windows 11`) |
| `--category TEXT` | Filter by category (e.g., `BIOS/UEFI`, `Audio`) |
| `--priority TEXT` | Filter by priority: `Critical` or `Recommended` |
| `--active-only` | Exclude items that require login |
| `--full-urls` | Show full URLs and titles (no truncation) |

**Filter examples:**

```bash
# Only BIOS/UEFI drivers
lore drivers PF4SQLH9 --category "BIOS/UEFI"

# Only Critical-priority drivers across all categories
lore drivers PF4SQLH9 --priority Critical

# JSON output for scripting
lore drivers PF4SQLH9 --json
```

### `lore warranty <serial>`

Check warranty status for a device.

```bash
lore warranty PF4SQLH9
```

```
Machine Information                               
┏━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Field           ┃ Value                                        ┃
┡━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ Serial          │ PF4SQLH9                                     │
│ Product         │ 21F9S05T00                                   │
│ Name            │ T14s Gen 4 (Type 21F8, 21F9) Laptop (Think… │
│ Type            │ 21F9                                         │
│ Ship Date       │ 2024-01-10                                   │
│ Ship To Country │ DE                                           │
│ End of Service  │ 2030-02-25                                   │
└─────────────────┴──────────────────────────────────────────────┘

Warranty Status                  
┏━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Field           ┃ Value                 ┃
┡━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━┩
│ Status          │ ✅ In warranty        │
│ Out of Warranty │ False                 │
│ Current Start   │ 2024-04-05            │
│ Current End     │ 2027-04-04            │
│ Remaining       │ 10 months, 23 days    │
└─────────────────┴───────────────────────┘
```

**Warranty Options:**

| Option | Description |
|--------|-------------|
| `--country TEXT` | Country code (default: `us`) |
| `--language TEXT` | Language code (default: `en`) |

### `lore report <serial>`

Full device report combining product info, drivers, and warranty.

```bash
lore report PF4SQLH9
```

Options from both `drivers` and `warranty` subcommands apply.

### Output Formats

| Format | Flag | Use Case |
|--------|------|----------|
| Rich tables | *(default)* | Interactive terminal use |
| Plain text | `--plain` | Piping, scripts, no-color terminals |
| JSON | `--json` | Programmatic consumption, piping to `jq` |

## API

LORE queries three Lenovo Support API endpoints. See [API_REFERENCE.md](API_REFERENCE.md) for full endpoint documentation.

| Function | Method | Endpoint | Auth |
|----------|--------|----------|------|
| Product Lookup | GET | `/us/en/api/v4/mse/getproducts` | None |
| Driver List | GET | `/us/en/api/v4/downloads/drivers` | None |
| Warranty Info | POST | `/us/en/api/v4/upsell/redport/getIbaseInfo` | Session cookie* |

\* Session cookie obtained via a single GET to `pcsupport.lenovo.com` — no login required.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contribution guidelines.

## License

MIT — see [LICENSE](LICENSE).