# Running the LORE 2.0 M0 prototype

This is a functional prototype. It can read Windows CDAT ZIPs locally, display
device/BIOS/driver evidence, compare two captures and check BIOS/WLAN/Bluetooth
versions against Lenovo catalog/package/readme evidence. Presentation remains provisional.
The Windows and real-browser acceptance status is documented in
[PLATFORM-SPIKE.md](PLATFORM-SPIKE.md). The bounded Lenovo check separates version
differences from unresolved applicability and installation prerequisites.

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

1. Open the UI and choose **Load example**. The sample is synthetic:
   three driver rows and seven files, including one deliberate collection error.
2. Try the **Drivers** filter and a **Source** link; verify the dialog closes
   normally. Inspect **Files**.
3. Select a real CDAT ZIP. Check model, BIOS and expected driver rows against
   their source. Missing/failed sources must remain explicit.
4. In **Lenovo updates**, expand **Browse Lenovo catalog**, verify the machine
   type and Windows version and fetch the catalog. Open a package and its readme.
5. Record any failed launch, import, browser behavior or network/proxy result.
   Catalog data alone is not an applicability/currentness verdict.

CDAT data stays in the browser. Only the selected machine type/OS and subsequent
Lenovo document paths are requested from Lenovo. No serial number or diagnostic
archive is sent by this prototype. File input is read-only.

## Compare two captures

1. Open the first ZIP using **Open CDAT ZIP**. This is capture A and remains the
   source for Overview, Drivers, Files and the Lenovo lookup.
2. Select **Compare captures** in the capture header (or open
   **Comparison**) and select a second ZIP as capture B.
3. Review BIOS, EC, ME firmware, Windows and driver records side by side.
   Use the result filter to inspect differences or unresolved rows, and search
   for a component. Source links open the corresponding A or B original text.
4. Select the same ZIP on both sides as a quick check: it must show no observed
   differences. Existing collection/matching uncertainty can still be unresolved.

Replacing A clears B. Replacing or removing B keeps A. Reloading the page clears
both captures; language/text-size preferences remain. All comparison data stays
in the browser. See [comparison scope and limitations](COMPARISON-PROTOTYPE.md).

## Check BIOS, WLAN and Bluetooth

After opening capture A, select **Check Lenovo updates** in the capture header
to start the check. Compare **Installed version** with **Available Lenovo
version** and review the compatibility note. **Details** contains explanations,
sources and readme highlights. **Readme** opens the original text.
The check uses capture A's machine type and Windows version.
See [scope and limitations](UPDATE-PROTOTYPE.md).

## Language and text size

The interface starts in English, independent of the browser language. Use the
header controls to switch between English and German and select Standard, Large
or Extra large text. The default is equivalent to 18 px with standard browser
settings; larger choices are 20 px and 22 px. Tables and source dialogs scale too,
and browser zoom remains available.

Both preferences are saved in this browser for the local address. Changing the
port or browser creates a separate preference scope. If browser storage is
blocked, the controls still work for the current session. Language changes keep
the loaded capture, selected tab and filters. Reloading the page keeps preferences,
but requires opening the CDAT archive again.

CDAT values, filenames and original source/readme text retain their source
language. Launcher and transport diagnostic messages use English. Additional UI
languages can be added through the message dictionaries.

## Current limits

- Up to two ZIP captures; no extracted-directory or supplementary-collector
  import yet.
- ZIP limit: 512 MiB compressed, 2 GiB declared expanded, 5,000 entries.
  Selected inventory files are limited to 4 MiB each; large logs remain unopened.
- ZIP64, encrypted archives and ambiguous legacy filename encodings are
  explicitly unsupported. Recent browser support for raw DEFLATE is required.
- Driver-store packages are not mixed into the displayed driver table. The
  Lenovo check uses a separate device/INF/radio reconciliation for WLAN and
  Bluetooth; broader identity and prerequisite coverage remain future work.
- Current readme sections are extracted with source lines. Free-form dependency
  evaluation and changes specifically since the installed release remain future work.
- The Windows transport is intentionally small and sequential. Confirm startup
  and responsiveness in the intended environment before broadening its scope.

## Developer checks

Development tests use Node.js 24+ (not required on end-user Windows) and Python:

```sh
node --test prototype/tests/*.test.mjs
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
Windows Chromium passed in [this run](https://github.com/tbox99/lore/actions/runs/43028082734).
The owner has demonstrated Windows startup/import; corporate proxy access and full
manual acceptance remain separate checks. Existing root npm/Tauri commands
still belong to LORE 1.x and do not test the new prototype.
