# M0: platform experiment

Status: IMPLEMENTED, platform acceptance PARTIAL. Evidence recorded 2026-11-11.

## Implemented candidate

- One dependency-free browser JavaScript core for bounded ZIP reading, CDAT
  parsing and Lenovo XML/readme interpretation.
- Windows: existing Windows PowerShell 5.1 starts a loopback TCP HTTP transport.
  No execution-policy override, firewall change or additional runtime install.
- Linux: Python 3.10+ standard-library loopback HTTP transport.
- Both hosts serve the same web assets and constrained Lenovo metadata endpoint.
  They contain no CDAT analysis. Archives are selected/read inside the browser.
- No hosted service, archive upload, automatic installation or full update verdict.
- Modern browser support for DecompressionStream('deflate-raw') is feature-tested;
  unsupported clients receive an explicit notice.

This choice tests the working assumption that corporate Windows should need no
additional runtime installation. The owner's screenshot on 2026-11-11 confirms
that the UI opened and imported the supplied archive in the intended environment.
The screenshot does not establish elevation level, proxy access or complete
corporate compatibility. The UI/transport arrangement remains experimental.

## Validation evidence

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| JavaScript importer, ZIP, comparison, inventory and Lenovo evidence tests | PASS | 76 tests on OpenCode Node 24.18.1 and CI, including 12 comparison, 11 inventory, 11 package/readme extraction and 17 update-assessment tests. Repeated conflicting fields, placeholder identities, unknown rules and package/component separation are covered. |
| Python loopback transport tests | PASS | 13 tests on OpenCode Python 3.14.4 |
| Linux HTTP start and asset delivery | PASS | Health, HTML, ES module, ZIP fixture and MIME types returned correctly |
| Initial real supplied CDAT import, shared core under Node on Linux | PASS, partial source coverage | Earlier importer evidence: 170 files indexed, 809,756,540 bytes declared expanded; 102,848 archive bytes read; 10 overview fields and 244 driver rows recovered. Six driver-table lines remain unresolved and are flagged. No customer identifiers committed. |
| Expanded private CDAT radio inventory, shared core under Node | PASS, partial source coverage | 131,411 archive bytes read after five bounded source additions; 344 PnP records and 319 identifiable store records, including two damaged store records retained as issues. One WLAN and one Bluetooth radio each have an unambiguous device/INF/store/report chain. No field conflicts found in this sample. This is not native-browser evidence. |
| Real supplied CDAT compared with itself, shared core under Node | PASS, matching uncertainty retained | Zero observed differences or one-sided records; 129 equal results and 26 unresolved results: 25 duplicate driver-name groups plus one incomplete-inventory summary. This is a core check, not native-browser evidence. |
| CDAT collection failures | PASS | COMException, NullArray and unavailable-event-log errors are reported as incomplete collection |
| Mixed partial capture sources | PASS | Different capture roots rejected; regression included |
| Lenovo catalog/package/readme from OpenCode | PASS | Ordinary HTTPS requests to the official 21MM Win11 catalog and n47uj13w metadata/readme returned content with source URL and UTC retrieval time |
| Current BIOS/WLAN/Bluetooth metadata and readme extraction | PASS | Four live official descriptors/readmes parsed through the actual functions with jsdom DOMParser. Current BIOS/header versions, model lists, dependency notices and radio IDs recovered; history excluded. A projection of the private capture's relevant fields produced three newer-version comparisons and one unmatched radio package. Applicability stayed unknown where hardware identity or prerequisites were not fully established. No live native-browser or corporate-network claim. |
| UI in DOM emulation | PASS, limited | Actual app modules plus jsdom: demo import, tabs, filters, source binding, live catalog (46 entries), BIOS metadata and readme text. Native dialog/scroll behavior emulated; no visual/focus acceptance inferred. |
| Local OpenCode Chromium UI acceptance | BLOCKED | Chromium with sandbox enabled exited with 'No usable sandbox!' on OpenCode. Zero browser cases executed; no protections disabled. |
| Local OpenCode Firefox acceptance | BLOCKED before launch | Remote command allow-list rejected firefox --version. No wrapper retry or screenshot. |
| Windows PowerShell 5.1 host on GitHub Windows runner | PASS | Six HTTP contract tests start the real host without an execution-policy override and verify socket release after termination. |
| Owner's Windows UI startup and real archive import | PASS, user-observed | Screenshot supplied on 2026-11-11 shows 170 files, 244 driver rows and four source-quality notices. Exact browser, elevation and proxy access were not established by this evidence. Screenshot and device identifiers are not committed. |
| Corporate Windows proxy access and complete manual interaction | NOT RUN | Requires the remaining checks in the intended corporate environment. |
| Native Windows Chromium browser with sandbox enabled | PASS | 29 recorded checks: previous import/comparison/preferences checks plus six new Lenovo-check groups covering explicit requests and direct navigation, component versions versus package versions, original CDAT/readme evidence, locale/scale retention, malformed metadata/missing-readme recovery, A/B binding and stale-result cancellation, and missing radio identity. No page/console errors or unexpected external requests; host cleanup passed. Lenovo responses are controlled synthetic fixtures. |
| Windows readable-layout validation | PASS, provisional presentation | Previously inspected overview/comparison views at desktop and narrow widths. New update-result screenshots inspected at 1440 px English/standard and 384 px German/extra-large, including direct capture actions and expanded readme sections. Native checks verify no page overflow and preference scaling. Narrow comparison tables require horizontal scrolling; lengthy evidence lists and final presentation remain open. |
| Linux native browser interaction | NOT RUN | Host/core tests and DOM emulation pass, but neither establishes actual Linux browser behavior. |

Verified code revision: `7b1c1df431954005421a44b062e779013ba47751`.
[Successful CI run and synthetic browser evidence](https://github.com/tbox99/lore/actions/runs/43026095304).
The native browser test uses controlled Lenovo responses; the separate live
Lenovo checks above ran on OpenCode. Corporate Windows policy/proxy behavior
still requires the user's environment.

Earlier research found that the 21MM catalog contained an older BIOS package
than the support website. The new check therefore reports versions in the
queried catalog and keeps applicability separate; it does not claim the latest
support-website release or recommend installation.

## Scope of the first importer

FileDetails.json, QuickData, ComputerInfo, Installed-HWD/Drivers.log and Issues
are read when present. Source file and line references remain available.
Large logs, registry exports, minidumps and other archive entries are listed,
not automatically loaded. Duplicate/mixed capture roots, traversal, encryption,
ZIP64, invalid checksums and over-limit content have explicit failure paths.

Text encodings supported initially: UTF-8 and BOM-marked UTF-16. Unsupported
encodings and wrapped/unreadable rows stay visible as incomplete parsing.
An initial [two-capture evidence comparison](COMPARISON-PROTOTYPE.md) now extends
this importer. The [bounded Lenovo check](UPDATE-PROTOTYPE.md) adds a narrow
device/INF/radio reconciliation and declarative assessment. Broader device
coverage, complete package applicability and report export remain future scope.

## Remaining decision

Complete [the manual run](RUNNING-PROTOTYPE.md) on corporate Windows and a normal
Linux browser. Record the accepted launch method, browser, proxy behavior,
ordinary user permissions and any blockers. Functional M1/M2 prototyping proceeds
with the owner's approval while these checks remain open. The final distribution
and UI design are still undecided.

## Reproducibility

Commands are listed in [RUNNING-PROTOTYPE.md](RUNNING-PROTOTYPE.md).
Temporary browser/DOM test dependencies and diagnostic logs remain in ignored
scratch directories on the development host. No real diagnostic archive,
private key or machine-specific runtime dependency is committed.
