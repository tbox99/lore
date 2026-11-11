# Running the LORE 2.0 M0 prototype

This is a technical prototype. It can read one Windows CDAT ZIP locally, display
device/BIOS/driver evidence and retrieve Lenovo catalog/package/readme data.
The Windows and real-browser acceptance status is documented in
[PLATFORM-SPIKE.md](PLATFORM-SPIKE.md). It does not yet compare captures or decide
which installed components need updating.

## Windows: no additional application runtime

Download and extract the `lore-v2` branch, then open a terminal in its root:

```powershell
powershell.exe -NoProfile -File .\prototype\Start-Lore.ps1
```

The script targets existing Windows PowerShell 5.1 and opens the normal browser.
It listens only at http://127.0.0.1:8765/. Keep the terminal open; Ctrl+C stops it.
For a different free port use `-Port 8766`; `-NoBrowser` suppresses browser launch.

No execution-policy, certificate or security setting is changed. If corporate
policy blocks the script, record the exact message as a platform-test result;
the documented command intentionally contains no bypass option.

## Linux

Python 3.10+ is required; no pip dependencies:

```sh
python3 prototype/serve.py
```

Alternatively use `sh prototype/start-linux.sh`. For a different port use
`--port 8766`; for terminal-only startup use `--no-browser`.
The UI is reachable only on the same machine via 127.0.0.1.

## Two-minute first check

1. Open the UI and choose **Beispiel laden**. The sample is synthetic:
   three driver rows and seven files, including one deliberate collection error.
2. Try the **Treiber** filter and a **Quelle** link; verify the dialog closes
   normally. Inspect **Dateien**.
3. Select a real CDAT ZIP. Check model, BIOS and expected driver rows against
   their source. Missing/failed sources must remain explicit.
4. In **Lenovo-Katalog**, verify machine type and Windows version, then request
   the catalog. Load one package's details and its readme.
5. Record any failed launch, import, browser behavior or network/proxy result.
   Catalog data alone is not an applicability/currentness verdict.

CDAT data stays in the browser. Only the selected machine type/OS and subsequent
Lenovo document paths are requested from Lenovo. No serial number or diagnostic
archive is sent by this prototype. File input is read-only.

## Current limits

- One ZIP only; no extracted-directory or supplementary-collector import yet.
- ZIP limit: 512 MiB compressed, 2 GiB declared expanded, 5,000 entries.
  Selected inventory files are limited to 4 MiB each; large logs remain unopened.
- ZIP64, encrypted archives and ambiguous legacy filename encodings are
  explicitly unsupported. Recent browser support for raw DEFLATE is required.
- Driver-store packages are not mixed into the displayed driver table.
  Full device identity and active-driver reconciliation come later.
- Readmes are shown as plain text; automatic change/prerequisite extraction is
  future work.
- The Windows transport is intentionally small and sequential. Confirm startup
  and responsiveness in the intended environment before broadening its scope.

## Developer checks

Development tests use Node.js 24+ (not required on end-user Windows) and Python:

```sh
node --test prototype/tests/import.test.mjs prototype/tests/lenovo.test.mjs
python3 -m unittest discover -s prototype/tests -p test_server.py -v
```

A Windows-only smoke test starts the actual PowerShell host and checks its HTTP
contract; it is skipped outside Windows:

```sh
python -m unittest discover -s prototype/tests -p test_windows_host.py -v
```

Regenerate the committed synthetic demo ZIP when its source fixture changes:

```sh
node prototype/tests/build-demo.mjs
```

Native browser checks use pinned, developer-only Playwright dependencies:

```sh
cd prototype
npm ci
npx playwright install chromium
npm run test:browser
```

The test starts its own loopback host and Chromium with its sandbox enabled,
uses only synthetic inputs and stops its host afterwards. Screenshots and
results are written to ignored `prototype/test-results/`. No browser protection
should be disabled to make a failed local launch pass.

The separate prototype CI uses these checks. Windows PowerShell 5.1 and native
Windows Chromium passed in [this run](https://github.com/tbox99/lore/actions/runs/43006480566).
Corporate Windows remains a separate manual check. Existing root npm/Tauri commands
still belong to LORE 1.x and do not test the new prototype.
