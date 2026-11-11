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
| JavaScript importer, ZIP and Lenovo transport unit tests | PASS | 21 tests on the OpenCode Node 24.18.1 runtime, including localized messages with unchanged evidence |
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
| Owner's Windows UI startup and real archive import | PASS, user-observed | Screenshot supplied on 2026-11-11 shows 170 files, 244 driver rows and four source-quality notices. Exact browser, elevation and proxy access were not established by this evidence. Screenshot and device identifiers are not committed. |
| Corporate Windows proxy access and complete manual interaction | NOT RUN | Requires the remaining checks in the intended corporate environment. |
| Native Windows Chromium browser with sandbox enabled | PASS | Seventeen recorded checks: real import, keyboard/source-dialog behavior, recovery and async guards, synthetic Lenovo XML/readme rendering, English default in a German browser, live translation without data loss or network requests, 18/20/22 px text scaling, persistence and invalid/blocked storage, responsive layout, no page errors/external requests and host cleanup. |
| Windows readable-layout validation | PASS | Screenshots inspected at 1440 px in English/standard and German/extra-large, plus 384 px German/extra-large. Native checks verify internal table scrolling without page overflow, source-dialog scaling and keyboard-only skip-link visibility. |
| Linux native browser interaction | NOT RUN | Host/core tests and DOM emulation pass, but neither establishes actual Linux browser behavior. |

Verified code revision: `71651274e6a658e1c674925c9baa33f15bcd205d`.
[Successful CI run and synthetic browser evidence](https://github.com/tbox99/lore/actions/runs/43019677395).
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
