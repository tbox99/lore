# LORE — TODO

## Phase 1 (Core CLI)

### Must Have
- [x] pyproject.toml + package structure (`lore/`)
- [x] SupportClient class (product lookup, driver list, warranty)
- [x] Session cookie management for warranty API
- [x] MachineType extraction from product response
- [x] CLI: `lore lookup <serial>` — product identification
- [x] CLI: `lore drivers <serial>` — driver listing with filtering
- [x] CLI: `lore warranty <serial>` — warranty status
- [x] CLI: `lore report <serial>` — combined output
- [x] Rich table output, JSON output, plain/no-color output
- [x] Persistent caching with TTL, retry/backoff for 429/5xx
- [x] Tests with fixtures

### Nice to Have
- [x] Driver filtering by OS and category
- [ ] Driver filtering by exact OS key
- [ ] Warranty renewal/upgrade info extraction
- [ ] MTM prefix lookup (without serial)
- [ ] Cache inspection/clear commands
- [ ] Shell completions (bash, zsh, fish)

## Phase 2 (PSREF Merge)

- [ ] Import psref_client module
- [ ] Unified product view (PSREF specs + Support data)
- [ ] Shared output formatting
- [ ] Deprecation path for standalone lenovo-psref-analyzer

## Phase 3 (Distribution)

- [ ] Publish to PyPI as `lenovo-lore`
- [ ] pipx install support
- [ ] CI with GitHub Actions (lint + test)
- [ ] Automated release workflow

---

## Tauri Desktop App — Active TODO

### ✅ Fixed: Browse click-to-search flow

**Problem**: Clicking a SubSeries or MachineType entry in Browse mode puts the full product ID path (e.g. `LAPTOPS-AND-NETBOOKS/THINKPAD-X-SERIES-LAPTOPS/THINKPAD-X13-GEN-7-TYPE-21YK-21YL/21YK`) into the search box, which the `search` command passes to `lookup_product()` as-is. The Lenovo API returns an empty result for these path-style IDs, showing "No products found for serial: LAPTOPS-AND-NETBOOKS/..." in red.

**Root cause**: `renderBrowseItems()` sets `serialInput.value = item.id` for SubSeries and MachineType items, then calls `doSearch()`. But `doSearch()` calls the Rust `search` command which expects a serial number or short search term.

**Fix applied**:
1. **Product.SubSeries** → `browseInto(item.name, item.id)` (drills down to MachineTypes)
2. **Product.MachineType** → normalizes product ID paths to the short MTM code before search
3. **Search input/autocomplete safety** → full Lenovo product ID paths are normalized before invoking search
4. **Guided Browse** → Lenovo-style flow: product category → series → subseries/model → machine type instead of free-text ThinkPad dumps

**Code location**: `src/index.html`, `renderBrowseItems()` function, `card.addEventListener("click", ...)` block (~line 1590)

**Verification**: Local build/check passed. Real NEXUS GUI verification still pending because OpenClaw has no paired NEXUS node and SSH requires credentials.

### 🟡 Browse mode — UX polish

- [x] Loading state while browsing (skeleton cards)
- [x] Error handling for browse API failures with retry
- [x] Empty state message when browse returns no results
- [x] Guided dropdown per browse level (series/model/machine type)
- [x] Lenovo-style top categories (Laptops, Desktops & All-in-Ones, Workstations, Tablets, Monitors, Accessories, Chromebook Laptops)
- [x] Hide repeated series container after selecting a series (prevents T-Series/L-Series dead-end loop)
- [x] Hide internal Lenovo product types like `Product.SubSeries` in result header
- [x] Driver row grid layout with aligned invisible columns
- [x] Win 10 / Win 11 driver filter pills and colored OS badges
- [x] Driver date sorting (newest/oldest)
- [x] Robust driver priority extraction from download item, file entry, or priority weight
- [x] Replace visible `[copy]` labels with copy/check icons for download and readme URLs
- [ ] Product images may not load (Lenovo CDN) — currently SVG fallback only, acceptable for now, keep on radar
- [x] Browse card layout responsiveness (narrow windows)
- [x] Add "or browse products below" hint text under search bar on welcome screen

### 🟡 General polish

- [ ] Retest warranty tab after Lenovo API maintenance ends (May 17 ~13:00 MEZ)
- [ ] Show LORE version number in the app UI (e.g. in header or footer)
- [x] Test Windows portable exe
- [ ] Consider CSP hardening for production
- [x] Search placeholder says "serial number, MTM, or model name" — MTM search verified on NEXUS
