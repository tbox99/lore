# BIOS and wireless update evidence

Status: initial M3 implementation. Presentation and full package applicability
remain provisional. The checker compares a captured state with the queried
Lenovo catalog, not with a live device or every Lenovo publication channel.

## Using the check

1. Open a CDAT ZIP as capture A.
2. Select **Lenovo update check** beneath the capture header.
3. Select **Check Lenovo updates** in the Lenovo tab.
4. Compare **Installed version** with **Available Lenovo version**. The result
   and a separate **Compatibility** note stay visible. Open **Details** for
   explanations, grouped CDAT source links, package metadata and readme
   highlights; **Readme** opens the original text directly.

The available version comes from the queried catalog; the label does not claim
the latest release across all Lenovo channels. Sources are grouped by file with
all referenced line numbers retained. Details start collapsed and preserve their
open/closed state when the display language changes.

The shortcut only navigates; the check button initiates the requests. The lookup
uses capture A's unambiguous machine type and Windows 10/11 identity. Editing
the separate manual catalog lookup clears existing check results; the next
check still derives its identity from A. Capture B does not change this check.
Replacing A cancels and invalidates outstanding work. Language and text-size
changes preserve results without fetching again.

## Installed-device evidence

Five additional bounded sources are imported when present, each limited to
1 MiB before decompression:

- `Installed-HWD/InstalledHardwareList.log`: reported PnP records and status.
- `Installed-HWD/DriversINFInstallDate.log`: exact device-to-published-INF binding.
- `Installed-HWD/Driver3rdPartyOEMINF.log`: original INF, provider and version.
- `Network/WLANnetsh.log`: WLAN radio/version/INF corroboration.
- `Network/BluetoothSystemReport.log`: Bluetooth radio and driver corroboration.

Each join must be unique and consistent. A stored driver package alone does not
establish a driver in use. PnP status is retained; the general list is not a
present-only inventory. Radio reports corroborate the narrow WLAN/Bluetooth
bindings. Missing, conflicting, damaged or duplicate records stay unresolved.
Archive-relative paths and line references remain available in the source dialog.

Observed hardware IDs and IDs inferred from instance strings are separate.
An exact match to an inferred PCI/USB identifier can select a candidate but
cannot establish full applicability. A strictly formatted PCI identifier may
also be compared without its revision suffix, still at inferred confidence.
Friendly names and per-machine `oemNNN.inf` names are not cross-device identity.

## Lenovo evidence and assessments

The checker fetches the model/OS catalog, then only BIOS/UEFI, wireless LAN and
Bluetooth category descriptors and their readmes. WWAN and Ethernet are outside
this increment. Requests are sequential, cancellable and limited to 40 selected
packages. Existing URL, response-size and timeout restrictions remain in force.
Response document identity must equal the requested URL. No installer,
external detection executable or package-supplied script is downloaded or run.

Driver target versions come from positive installation-detection rules, never
from package release numbers or prerequisite versions. BIOS target versions
come from the current readme header, with machine-type and target BIOS-family
evidence. Dotted numeric versions are compared component by component only
when their formats agree. Version differences, dependency evaluation and
installation detection remain separate.

Supported declarative rules use three states: true, false and unknown. Unknown
rules, modifiers, nested fields or unavailable device evidence remain unknown.
The subset covers simple OS, CPU bitness, Windows build, BIOS-prefix and exact
radio ID/version conditions. Firmware resources, driver-date conditions,
unverified non-radio dependencies and other rules are not fully evaluated.
For example, Intel SST dependencies in Bluetooth packages and ME firmware
requirements in BIOS packages can require further evidence or manual review.

The UI distinguishes:

- A newer component version in the queried source.
- An equal version in that source, or a newer installed version.
- Whether evaluated package prerequisites are satisfied, unmet or unresolved.
- Missing catalog categories, unmatched hardware and failed document requests.

Equality does not mean the whole device is current. An older queried package
does not recommend a downgrade. A query failure is not a clean bill of health.
Catalog and support-page publication can differ; this increment does not resolve
those differences or claim the latest release on the support website.

## Readme extraction

Current supported models/OS, component versions, release changes, dependencies
and important notices are extracted deterministically with original plaintext
line references. History is not used to infer current model support. A version
heading inside current change notes is not another header component version.
Explicit `None.` or `Nothing.` prerequisite sections are distinguished from
unreviewed requirements. Conflicting model evidence, duplicate sections and
truncation prevent a complete applicability verdict. Original readme text and
the Lenovo link remain accessible; automatic change-history slicing, update
ordering and free-form prerequisite evaluation are future work.

## Privacy and validation

Archives and serial numbers remain local. Only machine type, OS and selected
Lenovo document paths are requested. Results retain collection time, document
URLs and retrieval times. No diagnostic capture is persisted by the browser.

Tests cover numeric version ordering, package/component separation, uncertain
hardware identity, duplicate/conflicting input, unknown rules, incomplete
readmes, partial network failures and stale asynchronous results. See
[platform evidence](PLATFORM-SPIKE.md) for executed checks and limitations.

## Reference semantics

- [Lenovo applicability and detection](https://docs.lenovocdrt.com/guides/sus/su_dg/su_dg_ch4/)
- [Lenovo Client Update background](https://docs.lenovocdrt.com/guides/lcu/)
- [Upstream version-pattern implementation](https://github.com/jantari/LSUClient/blob/master/private/Test-VersionPattern.ps1)
- [Upstream dependency implementation](https://github.com/jantari/LSUClient/blob/master/private/Test-MachineSatisfiesDependency.ps1)
- [Microsoft PnP inventory semantics](https://learn.microsoft.com/en-us/powershell/module/pnpdevice/get-pnpdevice)
- [Microsoft device identification strings](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/device-identification-strings)
- [Microsoft DISM driver inventory](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/take-inventory-of-an-image-or-component-using-dism)

These references inform the bounded implementation; the prototype does not
reimplement the complete Lenovo update engine.
