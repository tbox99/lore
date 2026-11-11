# LORE development guidance

## Current branch purpose

The `lore-v2` branch develops a ground-up LORE 2.0 rewrite. The M0 prototype
lives in `prototype/`. Start with
`docs/v2/README.md`, `docs/v2/DATA-CONTRACT.md` and
`docs/v2/PLATFORM-SPIKE.md`.

Existing application code and build commands are LORE 1.x reference material.
The prototype uses shared browser JavaScript, with a thin Windows PowerShell 5.1
or Python 3.10+ loopback transport. This is a platform experiment, not a final
packaging decision. See `docs/v2/RUNNING-PROTOTYPE.md` for start/test commands.
Keep platform validation separate from assumptions about corporate deployment.

## Implementation principles

- Keep one analysis implementation for Windows and Linux.
- Start with importing Windows CDAT collections. A new collector is later scope.
- Separate import, evidence/model, comparison, Lenovo integration and UI/export.
- Keep original source locators and explicit missing/failed/ambiguous states.
- Distinguish active drivers from retained driver-store packages.
- Resolve hardware and package/component applicability before update conclusions.
- Do not automatically execute or install anything from imported collections.

## Repository hygiene and validation

- Never commit real customer collections, device identifiers, recovery material
  or raw registry/event/dump files. Private inputs belong in ignored
  `local-data/`; committed fixtures should be synthetic or reviewed/sanitized.
- Project documentation belongs under `docs/`.
- Check the worktree and branch before edits; preserve unrelated user changes.
- For documentation changes, check the diff, links and ignore behavior.
  For prototype changes, run its Node and Python tests. Do not describe v1
  builds/tests or DOM emulation as evidence of real v2 browser acceptance.
- Future implementation tests should cover actual importer/matching failure
  modes and use the milestone acceptance criteria.
- Report PASS, FAIL, BLOCKED or NOT RUN accurately. Never disable host/corporate
  protections to turn a blocked platform check into a pass.
