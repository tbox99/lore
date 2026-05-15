# LORE — Project Status

## Current Phase: Phase 1 — Core CLI (Nearly Complete)

### What Works (Verified 2026-05-15)

| API | Status | Auth | Notes |
|-----|--------|------|-------|
| Product Lookup (serial) | ✅ Working | None | Returns product name, type, path, image |
| Product Lookup (MTM prefix) | ✅ Working | None | Returns machine type list |
| Driver Listing | ✅ Working | None | Grouped by category, sorted by priority |
| Warranty Info | ✅ Working | Session cookie | Cookie from simple GET, no login |

### Test Serial
- `PF4SQLH9` — ThinkPad T14s Gen 4 (Type 21F8, 21F9) - Type 21F9 (21F9S05T00)

### Key Findings

1. **Product path derivation**: Serial lookup returns `Id` field which is the full product path used for driver queries
2. **MachineType extraction**: Warranty API needs `machineType` (e.g., "21F9") — extract from product `Name` or `Id` path segment
3. **Session cookie flow**: GET `pcsupport.lenovo.com` → extract `Lenovo_SessionID` cookie → use in warranty POST
4. **Driver data is rich**: Each item has title, version, download URL, SHA1/SHA256/MD5, size, OS keys, category, priority, country list
5. **Warranty data includes specs**: HTML table with CPU, RAM, storage, display, etc.
6. **No rate limiting detected** on any endpoint (but should handle gracefully)

### Phase 1 Checklist

| Item | Status |
|------|--------|
| pyproject.toml + package structure | ✅ Done |
| SupportClient (product, drivers, warranty) | ✅ Done |
| Session cookie management | ✅ Done |
| MachineType extraction | ✅ Done |
| CLI: `lore lookup` | ✅ Done |
| CLI: `lore drivers` (with filtering) | ✅ Done |
| CLI: `lore warranty` | ✅ Done |
| CLI: `lore report` | ✅ Done |
| Rich table output (per-category grouped) | ✅ Done |
| JSON output | ✅ Done |
| Plain/no-color output | ✅ Done |
| Persistent caching with TTL | ✅ Done |
| Retry/backoff for 429/5xx | ✅ Done |
| Tests with fixtures | ✅ Done (54 passing) |
| GitHub-ready files (README, LICENSE, etc.) | ✅ Done |

### Open Questions

- Driver listing for MTM-only (no serial) — does it work? Need to test
- Session cookie TTL — how long before expiry? Need to observe
- Rate limits — none hit, but should implement defensive backoff
- Country/locale impact on driver availability

## Roadmap

### Phase 2: PSREF Integration
- [ ] Import/adapt psref_client from lenovo-psref-analyzer
- [ ] Unified lookup showing PSREF specs + Support data
- [ ] Shared CLI entry point
- [ ] Migrate lenovo-psref-analyzer users

### Phase 3: Polish
- [ ] pipx/pip installable package (publish to PyPI)
- [ ] CI/testing setup (GitHub Actions)
- [ ] Shell completions