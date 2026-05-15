# LORE Project Checkpoint — 2026-05-15

## Status: Funktionale Basis steht, UX braucht Überarbeitung

### Was geht
- **LORE CLI** funktioniert: `lookup`, `drivers`, `warranty`, `report`
- **Alle 4 API-Endpunkte** getestet und working (Product, Drivers, Warranty, Session Cookie)
- **103 Tests** alle grün
- **GitHub Repo**: https://github.com/tbox99/lore (main branch, deploy key aktiv)
- **Install-Script** (`install.sh`): `--dev`, `--uninstall`, `--update`
- **Remote-Sync** (`sync-remote.sh`): rsync + remote reinstall
- **WebView** generiert und öffnet sich im Browser (HTML mit Filter, Copy, Expand, Dark/Light)

### Offene Probleme / Entscheidungsbedarf

1. **WebView noch nicht visuell verifiziert** — Cipher hat es gebaut, aber du hast es auf dem anderen Rechner noch nicht gesehen. Ob Design, Copy, Filter etc. wirklich gut funktionieren ist offen.

2. **Textual TUI existiert aber ist aktuell deaktiviert** — `tui.py` liegt noch im Repo, wird aber nicht mehr aufgerufen. Fokus-Balken war grau, Clipboard funktionierte nicht, Styling war "2000er Software". Entscheidung nötig: komplett löschen oder als `--tui` Alternative behalten?

3. **URL-Anzeige** — `https://` wird jetzt abgeschnitten im WebView. Ob das im Browser gut aussieht muss man sehen.

4. **`--no-web` Fallback** — Aktuell Rich-Tabellen (5 Spalten, abgeschnitten). Das war das ursprüngliche Problem. Braucht die Tabellen-Ausgabe auch ein Redesign (z.B. Karten-Layout im Terminal)?

### Architektur
```
src/lore/
├── __init__.py
├── cli.py          # Click CLI, steuert webview vs. --no-web vs. --json/--plain
├── support_client.py  # API-Client (httpx, Cache, Retry, Session Cookie)
├── output.py       # Rich-Tabellen, JSON, Plain-Text-Formatierung
├── webview.py      # HTML-Generierung + Browser-Öffnen (NEU, default)
└── tui.py          # Textual TUI (existiert, deaktiviert)

tests/
├── test_support_client.py
├── test_output.py
├── test_tui.py
└── test_webview.py
```

### Nächste Schritte (vom Benutzer zu entscheiden)
- WebView auf dem anderen Rechner testen und Feedback geben
- TUI löschen oder behalten?
- Tabellen-Fallback (`--no-web`) auch umgestalten?
- README/docs für WebView aktualisieren?
- Phase 2 (PSREF Integration) angehen?