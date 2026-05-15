# LORE — TODO

## Phase 1 (Core CLI)

### Must Have
- [x] pyproject.toml + package structure (`lore/`)
- [x] SupportClient class (product lookup, driver list, warranty)
- [x] Session cookie management for warranty API
- [x] MachineType extraction from product response
- [x] CLI: `lore lookup <serial>` — product identification
- [x] CLI: `lore drivers <serial>` — driver listing with filtering (OS, category, priority)
- [x] CLI: `lore warranty <serial>` — warranty status
- [x] CLI: `lore report <serial>` — combined output
- [x] Rich table output (default, per-category grouped)
- [x] JSON output (`--json`)
- [x] Plain/no-color output
- [x] Persistent caching with TTL
- [x] Retry/backoff for 429/5xx
- [x] Tests with fixtures

### Nice to Have
- [x] Driver filtering by OS (e.g., `--os win11`)
- [x] Driver filtering by category
- [ ] Driver filtering by exact OS key (e.g., `--os "Windows 11 (64-bit)"`)
- [x] `--full-urls` flag for untruncated output
- [x] `--active-only` to exclude login-required items
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

## Design Decisions (Resolved)

- Package name on PyPI: `lenovo-lore` (avoids conflict with generic `lore`)
- Minimum Python version: 3.10
- HTTP client: httpx (modern, async-ready, consistent with psref-analyzer)
- Output format: per-category grouped tables (not flat list)