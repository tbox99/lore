# LORE Testing Roadmap

**Version:** 1.1.1 · **Date:** 2026-05-17

---

## Current State

| Area | Status |
|------|--------|
| Rust tests | 1 test (`extract_os_keys_from_driver_files` in `lib.rs`) |
| Frontend tests | 0 |
| CI gates | None on PRs — `build.yml` only runs on tag pushes (`v*`) |
| Test dependencies | None beyond `serde_json` (already in `dev-dependencies` implicitly via `serde_json` dep) |

---

## 1. Rust Backend

### 1.1 kurzfristig sinnvoll (nächste Version)

| # | Test | Aufwand | Nutzen | Risiko wenn fehlend |
|---|------|---------|--------|---------------------|
| R1 | `is_allowed_readme_url` — positive + negative cases | S | hoch | SSRF via manipulated readme URL |
| R2 | `normalize_priority` — alle Branches | S | hoch | Falsche Prioritätsanzeige, Security-Gate fehlt |
| R3 | `extract_priority` — mit/ohne Priority-Feld, PriorityWeight-Fallback | S | mittel | Falsche Kategorisierung |
| R4 | `epoch_ms_to_date` — Some/None/Edge | S | mittel | Falsches/fehlerhaftes Datum |
| R5 | `short_title` — "for Windows", " - " Separator, kein Match | S | mittel | Anzeigefehler im Frontend |
| R6 | `extract_os_keys` — leere Files, doppelte Keys, gemischte Quellen | S | hoch | Bereits 1 Test vorhanden → erweitern |
| R7 | `collect_string_array_field` — leeres Array, nicht-String-Werte, fehlendes Feld | S | mittel | Silent data loss |
| R8 | Serde Roundtrip `SearchResponse` / `DriverEntry` / `DriversData` | S | mittel | Breaking-Change im Frontend-Contract |

**Aufwand gesamt: S (≈2–3 Stunden)**

Keine neuen Dependencies nötig — alles mit `#[test]` + `serde_json::json!`.

### 1.2 mittelfristig sinnvoll (1–2 Versionen später)

| # | Test | Aufwand | Nutzen | Risiko wenn fehlend |
|---|------|---------|--------|---------------------|
| R9 | `extract_machine_type` — alle Strategien (Name-Suffix, Name-AllTypes, Id-Path) | S | hoch | Falsche/Warranty-Lookup fehlschlägt |
| R10 | Cache Roundtrip: `set` → `get` mit gültigem TTL, TTL-Verfall | M | hoch | Veraltete Daten werden geliefert |
| R11 | Cache Pfadsicherheit: `path_for_key` sanitisiert `../` und Sonderzeichen | S | hoch | Path-Traversal im Cache-Dir |
| R12 | `build_readme_url` — Edge Cases (leer, kein ".", "?params") | S | mittel | Falsche Readme-URLs |
| R13 | `prepare_drivers_data` — Integrationstest mit fixture JSON | M | hoch | Regression bei API-Änderung |
| R14 | `extract_changes_section` / `html_to_lines` — Fixtures mit echtem Lenovo-HTML | M | mittel | Readme-Parsing kaputt bei Layout-Änderung |
| R15 | Serde Roundtrip `ProductInfo`, `BrowseItem`, `ProductMatch` | S | mittel | Frontend-Contract-Break |

**Aufwand gesamt: M (≈4–6 Stunden)**

Für R10/R11: `DiskCache::new(Some(temp_dir))` mit `tempfile` (neue Dev-Dependency) oder `std::env::temp_dir()`.

### 1.3 später sinnvoll

| # | Test | Aufwand | Nutzen | Anmerkung |
|---|------|---------|--------|-----------|
| R16 | `SupportClient` Integrationstests mit `mockito` | L | mittel | HTTP-Mocking nötig, aufwendig |
| R17 | `cached_get` Query-Encoding-Tests | S | niedrig | `reqwest::Url::query_pairs_mut` ist gut getestet in reqwest selbst |
| R18 | Concurrent Cache-Zugriffe | M | niedrig | `Mutex` macht es safe, Race-Bedinging unwahrscheinlich |

---

## 2. Frontend (index.html — 3340 Zeilen inline JS)

### 2.1 Architektur-Problematik

**`index.html` ist zu groß.** 3340 Zeilen, davon schätzungsweise:
- ~600 Zeilen CSS
- ~1700 Zeilen inline JavaScript
- ~1000 Zeilen HTML-Struktur

Alle ~65 JS-Funktionen leben in einem IIFE in `<script>`. Keine Module, kein Import, keine Separation.

### 2.2 Kurzfristig: Keine Frontend-Tests

**Begründung:** Inline JS in einem `<script>`-Block lässt sich nicht sinnvoll mit Vitest/Jest testen, ohne vorher mindestens eine Extraktion durchzuführen. Tests auf dem aktuellen Stand wären:
- Entweder: Copy-Paste der Funktionen in Test-Dateien (bricht bei Änderungen sofort)
- Oder: DOM-basierte Tests gegen das gesamte HTML (sehr fragil)

**Empfehlung:** Erst modularisieren, dann testen. Siehe §4.

### 2.3 Mittelfristig: Extraktion + Unit-Tests

| # | Maßnahme | Aufwand | Nutzen |
|---|----------|---------|--------|
| F1 | Pure Logic-Funktionen extrahieren: `naturalCompare`, `parseDriverDate`, `priorityClass`, `priorityCardClass`, `priorityDot`, `escHtml`, `short_title` (JS-Äquivalent), `formatSeriesName`, `cleanBrowseModelName`, `getProductPathSegments`, `getBaseProductId` | M | hoch |
| F2 | Diese mit Vitest testen | S | hoch |
| F3 | State-Management extrahieren (search state, filter state, browse history) | M | mittel |
| F4 | Render-Funktionen als Komponenten-Module | L | mittel |

**Vitest vs. leichtgewichtigerer Ansatz:**

| Ansatz | Pros | Cons |
|--------|------|------|
| Vitest | ESM-native, Vite-Integration, Watch-Mode, Coverage | Baut auf Vite auf — LORE hat aktuell keinen Vite-Build (Tauri serviert `index.html` direkt) |
| Node.js + assert | Keine zusätzlichen Dependencies, einfach | Kein ESM-Support für `import` ohne Setup |
| QUnit | Minimal, bewährt, browser-basiert | Veraltet, kein Watch-Mode |

**Empfehlung:** Vitest. Es ist der De-facto-Standard für JS-Testing im 2026-Umfeld. Der Overhead ist minimal (`npm i -D vitest`), und sobald Funktionen in `.js`-Dateien extrahiert sind, ist das Setup trivial. Alternative: Direkt `node --test` nutzen, wenn keine ESM-Imports nötig sind.

### 2.4 Aufwandsschätzung für Extraktion

**Erster Schritt (kleinster möglicher Schritt):**
1. Neue Datei `src/js/utils.js` erstellen
2. 5–8 pure Funktionen (kein DOM-Zugriff) dorthin verschieben
3. Im HTML: `<script type="module" src="js/utils.js">` (oder `<script>` mit globalem Import)
4. Tests in `src/js/__tests__/utils.test.js`

**Aufwand: M (≈4–6 Stunden)**

---

## 3. CI

### 3.1 Kurzfristig: Minimal-CI für PRs

Neuer Workflow `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - run: cargo fmt --all -- --check
        working-directory: src-tauri
      - run: cargo clippy --all-targets -- -D warnings
        working-directory: src-tauri
      - run: cargo test
        working-directory: src-tauri
```

| Gate | Sinnvoll? | Begründung |
|------|-----------|------------|
| `cargo fmt` | **Ja** | Verhindert Style-Drift, Zero-Cost |
| `cargo clippy` | **Ja** | Fängt Bugs, Zero-Cost |
| `cargo test` | **Ja** | Kern-Gate |
| `cargo build` | **Nein** | Wird durch `cargo test` implizit abgedeckt |
| Frontend-Lint | Nein | Kein Bundler/Linter vorhanden, erst nach Modularisierung |
| Frontend-Test | Nein | Keine Tests vorhanden |
| E2E/Playwright | **Nein** | Overkill für aktuelle Phase |

**Kein `cargo build` als separater Gate** — `cargo test` kompiliert bereits. Doppelter Build kostet Zeit ohne Mehrwert.

### 3.2 Mittelfristig

| Maßnahme | Aufwand | Nutzen |
|----------|---------|--------|
| JS-Lint (ESLint) nach Modularisierung | S | mittel |
| JS-Test-Gate (Vitest) nach Extraktion | S | hoch |
| Build-Gate (Tauri build) | L | niedrig — langsam, tag-basierter Build-Workflow reicht |

---

## 4. Architektur-Empfehlungen

### 4.1 Tauri Command-Handler ↔ Business-Logic

**Aktuell:** `search()` in `lib.rs` mischt HTTP-Aufruf, Daten-Transformation und Response-Konstruktion in einer Funktion. `prepare_drivers_data()` ist bereits ausgelagert — gut.

**Problem:** `search()` ist schwer isoliert testbar, da `State<AppState>` (enthält `SupportClient`) injiziert wird und echte HTTP-Calls macht.

**Empfehlung (mittelfristig):**
- Business-Logic-Funktionen (Transformation, Validierung, Normalisierung) sind bereits als freie Funktionen implementiert → **gut testbar**
- Command-Handler sollten dünn sein: Parameter validieren → Business-Funktion aufrufen → Response bauen
- Für Integrationstests: Trait-basiertes `SupportClient`-Interface → Mock-Implementierung in Tests

**Aufwand: M** — Refactoring von `search()` und `browse_products()` ca. 2–3 Stunden

### 4.2 `index.html` Modularisierung

**Dringlichkeit: Mittel.** 3340 Zeilen sind handhabbar, aber an der Grenze. Die Inline-Struktur blockiert:
- Frontend-Tests
- Code-Review (Diff wird schwer lesbar)
- Wiederverwendung von Logik

**Kleinster erster Schritt:**
1. `src/js/utils.js` mit 5–8 puren Funktionen
2. `src/js/browse.js` mit Browse-Logik (~15 Funktionen)
3. `src/js/drivers.js` mit Driver-Rendering (~10 Funktionen)
4. `src/js/warranty.js` mit Warranty-Rendering

Jeweils `<script type="module">` oder globales Anhängen an `window` (einfacher für bestehende Struktur).

**Wichtig:** Kein Bundler nötig. Tauri serviert statische Dateien. Relative Pfade funktionieren.

### 4.3 Cache-Architektur

**Aktuell:** `DiskCache` ist adäquat. `path_for_key` sanitisiert mit Regex — aber **nicht Path-Traversal-safe** gegen `../`-Konstrukte im Key, da die Regex nur Nicht-Alphanumerics ersetzt. Ein Key wie `foo/../../etc/passwd` wird zu `foo______etc_passwd` — sicher. Aber das sollte durch einen Test bestätigt werden (R11).

---

## 5. E2E (Playwright)

### Bewertung

| Aspekt | Einschätzung |
|--------|-------------|
| Relevanz | Mittel — UI ist kritisch, aber manuell testbar |
| Aufwand | Hoch — Tauri-Setup in CI erfordert Display-Server |
| Risiko | Hoch — WebKitGTK in CI ist fragil, Flaky-Tests vorprogrammiert |
| Wartung | Hoch — Browser-Updates brechen oft Selectors |

**Empfehlung: Später, wenn UI stabil ist.** Aktuell ist die UI in aktiver Entwicklung. E2E-Tests wären ein Wartungs-Albatross.

**Alternative:** Manuelle Smoke-Tests vor Release + Screenshots in CI (später).

---

## 6. Empfohlene Reihenfolge

| Phase | Was | Aufwand gesamt | Ergebnis |
|-------|-----|----------------|----------|
| **1 — Jetzt** | R1–R8 (Rust Unit Tests) + CI-Workflow | S (3–4h) | 15+ Rust-Tests, PR-Gate aktiv |
| **2 — Nächste Version** | R9–R15 (erweiterte Rust Tests) + F1/F2 (Frontend Extraktion + Tests) | M (8–12h) | ~25 Rust-Tests, 10+ JS-Tests, modularisiertes Frontend |
| **3 — Stabilisierung** | R16/R17 + F3/F4 + Architektur-Refactoring | L (15–20h) | Trait-basiertes Client-Interface, vollständig modularisiertes Frontend |
| **4 — Später** | E2E, Coverage-Reports, Performance-Tests | L | Playwright-Suite |

---

## 7. Konkrete nächste Schritte

1. **R1:** `is_allowed_readme_url` Tests schreiben — 5 Minuten, höchster Security-Nutzen
2. **R2–R5:** `normalize_priority`, `extract_priority`, `epoch_ms_to_date`, `short_title` Tests — je 5–10 Minuten
3. **R6–R8:** `extract_os_keys` erweitern, `collect_string_array_field`, Serde-Roundtrip — je 10–15 Minuten
4. **CI:** `.github/workflows/ci.yml` erstellen (Vorlage oben) — 15 Minuten
5. **Commit & Push** — Alle Tests + CI in einem PR

**Gesamt: ~2–3 Stunden für Phase 1.**

---

## 8. Risiken

| Risiko | Wahrscheinlichkeit | Mitigation |
|--------|-------------------|------------|
| Frontend-Extraktion bricht bestehendes Verhalten | Mittel | Schrittweise, je 2–3 Funktionen, manuell testen |
| Tauri-spezifische APIs (`__tauri`) in extrahiertem JS | Mittel | Nur pure Logic extrahieren, Tauri-Aufrufe im HTML lassen |
| CI-Laufzeit zu lang | Niedrig | Ohne Tauri-Build <2 Minuten |
| Regex-Änderungen brechen Parser-Tests | Mittel | Fixtures aus echten API-Responses ableiten |