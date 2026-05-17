Findings

1. [x] Kritisch: SSH-Deploy-Key liegt ungetrackt im Repo
    - Erledigt: deploy_key und deploy_key.pub sind in .gitignore eingetragen.
    - Nachweis: git status --short zeigt die Keys nicht mehr als untracked.
2. [x] Mittel: Build-/Dependency-Artefakte sind ebenfalls nicht ignoriert
    - Erledigt: node_modules/, dist/, src-tauri/target/ und src-tauri/gen/ sind in .gitignore eingetragen.
    - Nachweis: git status --short zeigt diese Artefakte nicht mehr.
3. [x] Mittel/niedrig: Browse-Loading hat Race-Risiko
    - Erledigt: browseRequestId verwirft stale Browse-Antworten vor renderBrowseItems().
    - Nachweis: src/index.html nutzt currentRequestId und prüft browseRequestId !== currentRequestId.
4. [x] Niedrig: Vite-Build warnt wegen outDir außerhalb des Vite-Roots
    - Erledigt: emptyOutDir: true ist in vite.config.js gesetzt.
    - Nachweis: npm run build läuft ohne diese Warnung.

Code-Review-Findings für 1.1.1

1. [x] fetch_readme akzeptiert beliebige URLs über die Tauri-Command-Grenze
    - Erledigt: HTTPS-Host-Allowlist für download.lenovo.com und pcsupport.lenovo.com eingebaut.
    - Nachweis: src-tauri/src/lib.rs prüft is_allowed_readme_url() vor fetch_readme.
2. [x] Query-Strings werden manuell gebaut
    - Erledigt: Query-Parameter werden über reqwest::Url::query_pairs_mut() kodiert.
    - Nachweis: src-tauri/src/client.rs baut cached_get()-URLs nicht mehr per format!("{}={}").
3. [x] Globaler AppState.client-Mutex blockiert Netzwerk-Requests
    - Erledigt: AppState hält SupportClient direkt; nur DiskCache-Dateizugriffe sind lokal serialisiert.
    - Nachweis: src-tauri/src/lib.rs nutzt state.client direkt, src-tauri/src/cache.rs schützt nur Cache-Operationen.
4. [x] cargo fmt und clippy waren nicht grün
    - Erledigt: Formatierung und Clippy-Warnungen bereinigt.
    - Nachweis: cargo fmt --check und cargo clippy --all-targets -- -D warnings laufen grün.
5. [x] Produktkategorien unvollständig oder leer
    - Erledigt: Workstations C/D/E/P/S sowie Lenovo-Tablet- und Zubehör-Unterkategorien ergänzt.
    - Nachweis: src/index.html enthält lokale Browse-Einstiege für diese Kategorien.
6. [x] Version im UI fehlt
    - Erledigt: App-Version wird dynamisch über Tauri gelesen und im Footer angezeigt.
    - Nachweis: src/index.html nutzt window.__TAURI__.app.getVersion().
7. [x] Monitor-OS-Badge bleibt grau
    - Erledigt: OS-Metadaten werden zusätzlich aus Lenovo-Datei-Einträgen gelesen.
    - Nachweis: src-tauri/src/lib.rs enthält extract_os_keys() und einen Unit-Test dafür.
8. [x] Maus-Zurück-Taste fehlt in Produktkategorien
    - Erledigt: Mouse Button 3 springt in der Browse-Ansicht eine Kategorieebene zurück.
    - Nachweis: src/index.html enthält handleBrowseMouseBack().
