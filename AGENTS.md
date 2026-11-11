# LORE development guidance

## Current branch purpose

The `lore-v2` branch prepares a ground-up LORE 2.0 rewrite. Start with
`docs/v2/README.md`, `docs/v2/DATA-CONTRACT.md` and
`docs/v2/PLATFORM-SPIKE.md`.

Existing application code and build commands are LORE 1.x reference material.
Preparation has not selected a new runtime or framework and has not implemented
a v2 application. Record a technical choice and its validation when made;
do not infer it from whichever runtime is installed on the development host.

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
- For documentation preparation, check the diff, links and ignore behavior.
  Do not describe v1 builds/tests as evidence of v2 functionality.
- Future implementation tests should cover actual importer/matching failure
  modes and use the milestone acceptance criteria.
- Report PASS, FAIL, BLOCKED or NOT RUN accurately. Never disable host/corporate
  protections to turn a blocked platform check into a pass.
