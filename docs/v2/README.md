# LORE 2.0 preparation

Status: preparation only. There is no runnable v2 application yet.

LORE 2.0 will turn Windows diagnostic collections into a readable, comparable
device report on Windows and Linux. CDAT remains the initial collector.
The existing LORE 1.x implementation is a reference for Lenovo integrations;
it does not determine the v2 language, runtime, UI framework or packaging.

## Working arrangement

- Repository: https://github.com/tbox99/lore
- Development branch: `lore-v2`.
- Starting point: `e6226db50d05110a3cffa9578c844f99d585df7c`.
- Use a separate Git worktree; keep the main worktree available for 1.x.
- This preparation changes documentation and ignore rules only.
- Existing source files and npm/Tauri commands still belong to 1.x.
- Decide which source files to replace when the platform experiment establishes
  the implementation approach. Avoid maintaining two separate v2 applications.

## User workflow

1. Open a CDAT ZIP or an already extracted collection.
2. See device identity, collection period, data coverage and relevant findings.
3. Inspect tabs for hardware, BIOS/firmware, drivers, Windows/software,
   TPM/BitLocker, energy/events and source files.
4. Optionally open a second collection. Compare two devices or two captures of
   one device; filter to differences and retain the underlying evidence.
5. Request Lenovo comparison using the required device/model information.
6. Read relevant changes, prerequisites and limitations for candidate updates.
7. Export a report suited to a customer, escalation or further analysis.

## Scope and milestones

| Step | Deliverable | Acceptance |
| --- | --- | --- |
| M0: platform experiment | Small launch/import/Lenovo connectivity experiment | Minimal UI starts on corporate Windows and Linux. A selected ZIP yields its directory and small metadata file. Ordinary Lenovo access succeeds or gives a useful error. Runtime, proxy and permission requirements are recorded. |
| M1: one collection offline | Device overview, first tabs, source references and coverage | Identity, BIOS/firmware and driver evidence are imported from a representative collection. Collection failures are visible. Large logs load only when requested. |
| M2: two collections | Device-to-device and before/after comparison | Identical input yields no semantic differences. Known version/component/setting changes are found. A missing input file is not reported as removed hardware. |
| M3: Lenovo and readmes | Applicable update candidates and contextual changes | Model, OS and hardware applicability are considered. Package and component versions are distinct. Sources and retrieval time are retained. Ambiguous matches remain explicit. |
| M4: reporting | Shareable offline report and comparison table | Export retains assessment, time and source context. Redaction is checked on the exported result. HTML is the proposed detailed format; PDF summary and CSV/XLSX tables follow actual need. |

The first useful product milestone is M1 plus M2. M0 informs the technical
choice before substantial implementation. Partial platform results must be
labelled; Linux success does not establish corporate Windows compatibility.

## Architecture boundaries

These are responsibilities, not a choice of framework or services:

- Import adapters: CDAT first; supplementary TPM/standby collector separately.
- Shared model: evidence, device snapshots, collection coverage and identity.
- Analysis: normalization, matching and comparisons.
- Lenovo adapter: product lookup, package metadata, readmes and source caching.
- Presentation/export: tabs, filters, differences and shareable reports.

Keep one shared analysis implementation for Windows and Linux. PowerShell may
later serve as a Windows collector. Importing Windows data on Linux does not
imply collecting Linux inventory; a Linux collector is a separate future scope.

## Lenovo and LORE

The inspected LORE 1.x source provides product, driver, warranty and readme
integration references. Revalidate the endpoints when implementing v2; website
endpoints are not a guaranteed stable public API contract.

PSREF is complementary product specification data. It is not evidence of the
currently installed components, drivers or BIOS settings. The collected device
evidence remains the source for actual state.

Review useful 1.x behavior rather than copying it wholesale: session handling,
URL validation, retries and caching. Do not reuse the assumption that the first
download file's version describes every component in a package.

## Initially outside the scope

- Installing drivers, flashing firmware or changing device configuration.
- Replacing CDAT or reverse-engineering its executable.
- Automatic root-cause conclusions from incomplete event/log evidence.
- A hosted multi-user service or mandatory cloud upload of collections.
- A second independently implemented PowerShell/EXE edition.

## Next work

Start with [the platform experiment](PLATFORM-SPIKE.md), then formalize and
implement the first import adapter using the [data requirements](DATA-CONTRACT.md).
No final runtime or framework has been selected.
