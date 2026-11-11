# First two-capture comparison

This is an initial M2 function on the existing partial M1 importer. The UI is a
working view, not the final product design. It compares recorded evidence rather
than assessing driver currency, compatibility or the cause of a fault.

## What is compared

- BIOS identifier/version, embedded controller, ME firmware, operating system
  and Windows build.
- Reported device-driver names and versions from `Installed-HWD/Drivers.log`.
- Capture identity and capture time are context. Different collection times or
  archive filenames alone do not count as changed device state.

The sides are A and B. Neither side is automatically labelled before/after.
Source timestamps are retained as recorded, without assuming a timezone or
chronological order. Device identity is classified conservatively from available
serial/model evidence, with conflicts and unknown placeholders left unresolved.

## Reading the results

| Result | Meaning |
| --- | --- |
| Same | The compared recorded values agree after limited whitespace normalization. |
| Different | Both values are present and differ. This does not establish which is newer or preferable. |
| Only in A / only in B | A driver record is listed on one side and not in the other side's readable driver table. This does not prove hardware was added or removed. |
| Unresolved | Missing/failed evidence, conflicting values, ambiguous duplicate names or an incomplete opposite driver table prevents a conclusion. |

The differences filter shows observed differences and one-sided records.
Unresolved rows have their own visible count/filter; zero differences is not a
clean bill of health. An incomplete driver inventory also gets an unresolved
summary row, even when all recovered names appear on both sides.

## Driver matching boundary

The current source provides names and version strings, not a validated hardware
identity. The prototype aligns unique names after case/whitespace normalization
and labels that basis explicitly. Duplicate names are ambiguous; their source
records are retained instead of selecting a convenient match. Version strings
are not numerically sorted or interpreted as upgrade/downgrade recommendations.

This permits a useful comparison of reported records while preserving the
distinction from confirmed hardware/active-driver matching. Hardware IDs,
subsystem identity, device class, INF association and retained driver-store
packages require a subsequent importer extension. No Lenovo package applicability
is inferred from this name alignment.

## Evidence and state handling

Each side retains its own original text, source path and line. The same path in
two archives must still open the text from the selected side. Missing values and
conflicts remain visible rather than silently becoming equal or absent.

Language and text-size changes keep both captures and filters without making
network requests. A failed B import keeps A usable. Replacing A or removing B
invalidates outstanding B imports so a late result cannot restore stale data.
No capture or comparison is persisted to browser storage.

## Validation

Synthetic core tests cover identity, equality, changed versions, one-sided
records, partial/missing sources, conflicts, duplicate names and source retention.
Native Windows browser tests exercise actual ZIP input, filters, A/B source
binding, language switching, import recovery, pending-import invalidation and
responsive layouts. Current executed evidence is recorded in
[the platform validation log](PLATFORM-SPIKE.md).
