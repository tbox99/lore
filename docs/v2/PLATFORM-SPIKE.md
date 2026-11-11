# M0: platform experiment

Status: NOT RUN. Preparation and environment inventory are complete;
application launch, ZIP import and Lenovo connectivity have not been tested
as a v2 application.

## Question to answer

Which execution and distribution approach can run the same analysis application
on corporate Windows and Linux with an acceptable start-up experience?

A local browser UI is the current candidate. The language, backend requirement,
runtime distribution and packaging remain open. Neither a rewrite nor a browser
UI by itself resolves executable restrictions, proxy requirements or runtime
availability.

## Development environment observed on 2026-11-11

| Item | Observation |
| --- | --- |
| Repository baseline | `e6226db50d05110a3cffa9578c844f99d585df7c`; existing main worktree clean |
| Host | OpenCode development machine, Linux x86_64 |
| Git | 2.53.0 |
| Node.js / npm | 24.18.1 / 11.16.0 |
| Python | 3.14.4 |
| Firefox | Executable found; interactive launch not tested |
| PowerShell | Not found on the MCP session PATH |
| Rust / Cargo | Not found on the MCP session PATH |
| GitHub | Fetch from the existing origin succeeded |
| Corporate Windows | Not accessible through this development-host session |

These are environment observations, not chosen application dependencies.
No runtime installation is required for the documentation preparation.

## Small experiment

1. Describe each candidate's runtime, normal user permissions and launch method.
   Avoid choosing it solely because the development machine already has it.
2. Start a minimal local UI and identify where computation runs.
3. Select a synthetic ZIP, enumerate it and read a small metadata file.
4. Exercise a controlled private representative CDAT archive locally:
   read the directory and metadata without loading the whole expanded archive.
5. Perform ordinary Lenovo product/package/readme retrieval. Record the URL,
   response/result, retrieval time and any proxy/session requirements.
6. Repeat on corporate Windows and Linux. Record launch, import, networking and
   shutdown separately; a successful server-side request on Linux is not proof
   that browser requests on Windows will work.
7. Record the decision and tradeoffs before building the main application.

If the browser is the HTTP client, test cross-origin behavior explicitly.
If a local backend is needed, document its listener scope and shutdown behavior.
Do not weaken corporate execution policy, certificate validation or browser
protections to make an experiment pass.

## Acceptance matrix

| Check | Corporate Windows | Linux |
| --- | --- | --- |
| Runtime available / accepted launch method | NOT RUN | NOT RUN |
| UI starts as normal user | NOT RUN | NOT RUN |
| Synthetic ZIP metadata import | NOT RUN | NOT RUN |
| Representative CDAT metadata import | NOT RUN | NOT RUN |
| Lenovo product/package access | NOT RUN | NOT RUN |
| Lenovo readme retrieval | NOT RUN | NOT RUN |
| Offline import and understandable network failure | NOT RUN | NOT RUN |
| Application closes cleanly | NOT RUN | NOT RUN |

Use PASS, FAIL, BLOCKED or NOT RUN with actual evidence. Missing access is not a
passing result. A blocked Windows check can remain explicitly open while
independent importer/data-model work continues.

## Decision record to complete

- Chosen language/runtime and shared analysis module location:
- UI and local process arrangement:
- Required installs, permissions and corporate Windows prerequisites:
- Lenovo transport/session/proxy behavior:
- Expected user launch steps on each platform:
- Validation evidence and unresolved limitations:
- Distribution/update approach:
- Date and rationale:

Existing `npm` and Tauri commands build LORE 1.x. They are not the v2 launch or
validation instructions.
