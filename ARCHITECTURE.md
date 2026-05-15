# LORE — Architecture

## Overview

LORE is a Python CLI tool that queries Lenovo Support APIs to retrieve device information, driver listings, and warranty status by serial number (or MTM prefix).

## Components

### 1. Support Client (`lore/support_client.py`)
HTTP client for the Lenovo Support API at `pcsupport.lenovo.com`.

**Endpoints:**
- `GET /us/en/api/v4/mse/getproducts?productId={serial}` — Product identification
- `GET /us/en/api/v4/downloads/drivers?productId={productPath}` — Driver/update listing
- `POST /us/en/api/v4/upsell/redport/getIbaseInfo` — Warranty info (requires session cookie)

**Session handling:**
- Session cookie (`Lenovo_SessionID`) obtained via single GET to `pcsupport.lenovo.com`
- No login/authentication needed
- Cookie cached for session duration (short TTL, re-fetch on expiry)

**Product path derivation:**
- Serial lookup returns `Id` field like `LAPTOPS-AND-NETBOOKS/THINKPAD-T-SERIES-LAPTOPS/.../PF4SQLH9`
- This `Id` is used directly as `productId` in the driver listing endpoint
- The warranty POST needs `serialNumber` + `machineType` (extracted from product Name or Id)

### 2. Output Formatting (`lore/output.py`)
- **Rich tables** (default) — per-category grouped tables with columns: Title, Version, Priority, Released, URL
  - Categories sorted alphabetically; items within each category sorted by priority (Critical first)
  - Title and URL columns truncated by default (max 35/45 chars); `--full-urls` disables truncation
- **JSON output** (`--json`) — enriched flat list with all metadata fields
- **Plain text** (`--plain` / `--no-color` / `--no-emoji`) — grouped by category sections

Key internal functions:
- `_short_title()` — truncates driver titles at "for Windows" or " - " patterns
- `_group_by_category()` — groups items by `Category.Name`, sorts categories alphabetically and items by priority
- `_enrich_driver_item()` — extracts normalized fields for JSON output

### 3. CLI (`lore/cli.py`)
Commands: `lookup`, `drivers`, `warranty`, `report`

- `lookup` — product identification by serial/MTM
- `drivers` — driver listing with filtering (OS, category, priority, active-only, full-urls)
- `warranty` — warranty status with country/language options
- `report` — combined product + drivers + warranty

## Data Flow

```
Serial Number
    │
    ├─→ getproducts → Product Info (name, type, path, image)
    │                      │
    │                      ├─→ downloads/drivers → Driver List (grouped by category)
    │                      │
    │                      └─→ machineType → getIbaseInfo → Warranty Info
    │
    └─→ report (all of the above combined)
```

## Future: PSREF Merge

When PSREF integration is added:
- `lore/psref_client.py` — Existing PSREF JSON API client (from lenovo-psref-analyzer)
- Unified `lore lookup` would show PSREF specs + Support data side by side
- Shared output formatting, shared CLI entry point
- PSREF client may need adapter layer to map MTM prefixes between the two APIs

## Caching Strategy

- Product lookup: 1 hour TTL (product identity rarely changes)
- Driver listings: 6 hours TTL (updates happen periodically)
- Warranty info: 24 hours TTL (warranty status changes slowly)
- Session cookie: refresh when expired (detect via 401/100 response code)

## Error Handling

- HTTP 429: Respect Retry-After header, exponential backoff
- HTTP 5xx: Retry with backoff (max 3 retries)
- Warranty auth failure (code 100): Re-fetch session cookie and retry once
- Network timeouts: 30s default, configurable