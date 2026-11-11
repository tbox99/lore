# Data and comparison requirements

Status: design requirements, not a finalized JSON schema.

## Evidence before conclusions

Each normalized value should retain:

- Its field name, raw value and normalized value.
- Collection identifier and relevant device/component identity.
- Full archive-relative source path and a useful line, record or XML locator.
- Capture time or collection interval, including timezone certainty.
- Importer version and any parsing, collection or matching uncertainty.

Do not silently merge conflicting sources. Display the conflict and the reason
for any preferred source. A collection is an interval, not an atomic snapshot.

Keep these dimensions separate:

| Dimension | Examples |
| --- | --- |
| Collection coverage | Collected, not collected, collection failed, partially collected, unknown |
| Parse outcome | Parsed, partially parsed, unsupported format, invalid data |
| Observed presence | Present, absent with evidence, unknown |
| Match confidence | Exact, supported inference, ambiguous, unmatched |
| Update assessment | Current for the matched source, newer applicable candidate, not applicable, newer installed than source, not assessable |

Absence in a file is not automatically evidence of absence on the device.
No update comparison is current forever: show the collection time and the
Lenovo metadata retrieval time.

## Findings from the supplied CDAT 1.26 sample

The inspected archive contains 170 files, 809,756,540 bytes uncompressed.
These are observations about this sample, not a promise about all CDAT versions.

- `FileDetails.json` indexes 169 other files with categories and file metadata.
  It is an import aid, not a normalized hardware inventory.
- Small inventory sources can be read first. Large setup/event logs and dumps
  account for most of the expanded size and should be loaded on demand.
- Text includes UTF-16LE, UTF-8 with/without BOM, localized dates and headings,
  wrapped/truncated tables and some already damaged characters.
- Driver names, INF association, versions and PnP identity are spread across
  different files. Preserve the full paths; duplicate basenames can occur.
- Current device records, earlier devices and retained driver-store packages
  coexist. A stored old driver is not necessarily the driver in use.
- Available-Windows-Updates collection includes a COMException. Odometer
  collection includes NullArray errors. Event-log enumeration partly fails.
  These are coverage problems, not clean checks or zero-valued observations.
- Generic CDAT issue-summary prose can mention possible problems even for zero
  counts. Derive findings from evidence, not from copying that prose.
- CDAT already includes TPM/BitLocker data. The supplementary collector adds
  BIOS settings, power context, event timelines and questionnaire context.

No real collection, serial number, recovery material, customer name or raw
event/registry dump belongs in the public repository.

## Driver and device matching

Represent devices, active driver associations, driver-store packages and
Lenovo download packages separately.

- Use hardware identity, subsystem/vendor details, class and function where
  available. Retain the ambiguity when a source lacks a reliable key.
- FriendlyName alone is not identity. Neither is a per-machine
  `oemNNN.inf` name; an instance ID is not a universal cross-device key.
- Distinguish comparison of two different devices from two captures of the
  same device. Different optional hardware can legitimately need different
  packages.
- Compare versions using component/vendor semantics, not lexical sorting.
  A firmware identifier and a package release number can describe different
  things. A date alone does not establish a newer applicable driver.
- Store package-to-component mappings explicitly. A package can update several
  components and contain different versions for different hardware.
- Missing evidence yields an unresolved comparison, not a removed component
  or a missing required update.

## Lenovo metadata and readmes

Product identity/serial lookup can help locate the support page, but serial
number alone does not prove which download applies to installed hardware.

Retain source URL, document/package ID, applicable OS/model/hardware, retrieval
time and package/component versions. Treat cached/catalog/support-page
disagreements as evidence to resolve, not permission to silently choose a value.
Query failures and stale cached data must remain visible.

Extract supported models/OS, component versions, relevant changes between the
installed and candidate versions, prerequisites, update order, limitations and
reboot requirements where provided. Keep source sections/links. Preserve an
unparsed section rather than inventing a dependency or security conclusion.
The initial approach should be deterministic extraction; AI interpretation is
not required for import or comparison.

## Supplementary TPM/standby collections

- Current BIOS/TPM state does not by itself describe the state during a past
  incident.
- The script's success label does not establish successful collection of every
  native command or generated report. Inspect contents and expected outputs.
- Some event exports can be omitted by the collector's size rules.
- Preserve timezone uncertainty for timestamps without an offset.
- Correlate events without presenting timing alone as proof of causation.
- Existing text masking does not anonymize raw EVTX, registry or MDM contents.

## Import and export handling

Process collections locally by default. Limit Lenovo requests to the device
information required for the selected lookup; do not send diagnostic archives.
Use a designated ignored `local-data/` directory for private fixtures.

Validate ZIP paths, member counts and expanded-size limits before extraction.
Do not execute archive programs or scripts embedded in imported HTML. Keep
source viewing separate from active application content.

Use synthetic or deliberately reviewed, sanitized test fixtures in
`tests/fixtures/`. At minimum cover identical input, version changes, optional
hardware, failed collection, ambiguous matching, encoding/wrapping and partial
archives. Real customer archives must stay outside Git.

Exports should retain source/assessment context while allowing explicit removal
of personal/device/network identifiers. Verify the final exported content;
masking a UI table does not sanitize attached raw files.
