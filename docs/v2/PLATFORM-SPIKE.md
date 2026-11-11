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
additional runtime installation. That assumption has not been confirmed by the
owner or a successful corporate Windows run. The UI/transport arrangement can
still change based on that test.

## Validation evidence

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| JavaScript importer, ZIP and Lenovo transport unit tests | PASS | 17 tests on the OpenCode Node 24.18.1 runtime |
| Python loopback transport tests | PASS | 13 tests on OpenCode Python 3.14.4 |
| Linux HTTP start and asset delivery | PASS | Health, HTML, ES module, ZIP fixture and MIME types returned correctly |
| Real supplied CDAT import, shared core under Node on Linux | PASS, partial source coverage | 170 files indexed, 809,756,540 bytes declared expanded; only 102,848 archive bytes read; 10 overview fields and 244 driver rows recovered. Six driver-table lines remain unresolved and are flagged. No customer identifiers committed. |
| CDAT collection failures | PASS | COMException, NullArray and unavailable-event-log errors are reported as incomplete collection |
| Mixed partial capture sources | PASS | Different capture roots rejected; regression included |
| Lenovo catalog/package/readme from OpenCode | PASS | Ordinary HTTPS requests to the official 21MM Win11 catalog and n47uj13w metadata/readme returned content with source URL and UTC retrieval time |
| UI in DOM emulation | PASS, limited | Actual app modules plus jsdom: demo import, tabs, filters, source binding, live catalog (46 entries), BIOS metadata and readme text. Native dialog/scroll behavior emulated; no visual/focus acceptance inferred. |
| Local OpenCode Chromium UI acceptance | BLOCKED | Chromium with sandbox enabled exited with 'No usable sandbox!' on OpenCode. Zero browser cases executed; no protections disabled. |
| Local OpenCode Firefox acceptance | BLOCKED before launch | Remote command allow-list rejected firefox --version. No wrapper retry or screenshot. |
| Windows PowerShell 5.1 host on GitHub Windows runner | PASS | Six HTTP contract tests start the real host without an execution-policy override and verify socket release after termination. |
| Corporate Windows startup, browser interaction and proxy access | NOT RUN | Requires the intended corporate environment. |
| Native Windows Chromium browser with sandbox enabled | PASS | Ten recorded checks: real file input, ZIP capability, tabs/filters, native source dialog, Escape/focus return, failed-import recovery, late-response handling, synthetic Lenovo XML/readme rendering, no page errors/external requests, host cleanup. |
| Windows screenshot inspection | PASS at 1440 px | Synthetic overview and readme screenshots preserved as CI evidence; overview visually inspected. Mobile/responsive acceptance is not claimed. |
| Linux native browser interaction | NOT RUN | Host/core tests and DOM emulation pass, but neither establishes actual Linux browser behavior. |

Verified code revision: `53b56449097679db307e8445139af78d8f6c7a74`.
[Successful CI run and synthetic browser evidence](https://github.com/tbox99/lore/actions/runs/43006480566).
The native browser test uses controlled Lenovo responses; the separate live
Lenovo checks above ran on OpenCode. Corporate Windows policy/proxy behavior
still requires the user's environment.

The 21MM catalog currently contains an older BIOS package than was independently
observed on the support website during research. Therefore the prototype labels
catalog packages as research results, not as the latest applicable updates.

## Scope of the first importer

FileDetails.json, QuickData, ComputerInfo, Installed-HWD/Drivers.log and Issues
are read when present. Source file and line references remain available.
Large logs, registry exports, minidumps and other archive entries are listed,
not automatically loaded. Duplicate/mixed capture roots, traversal, encryption,
ZIP64, invalid checksums and over-limit content have explicit failure paths.

Text encodings supported initially: UTF-8 and BOM-marked UTF-16. Unsupported
encodings and wrapped/unreadable rows stay visible as incomplete parsing.
No snapshot comparison, active-device reconciliation, automatic package
applicability analysis or report export is claimed yet.

## Remaining decision

Complete [the manual run](RUNNING-PROTOTYPE.md) on corporate Windows and a normal
Linux browser. Record the accepted launch method, browser, proxy behavior,
ordinary user permissions and any blockers. Then decide whether to keep these
thin hosts or change distribution before building M1/M2.

## Reproducibility

Commands are listed in [RUNNING-PROTOTYPE.md](RUNNING-PROTOTYPE.md).
Temporary browser/DOM test dependencies and diagnostic logs remain in ignored
scratch directories on the development host. No real diagnostic archive,
private key or machine-specific runtime dependency is committed.
