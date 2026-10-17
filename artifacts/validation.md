# Validation · 2026-10-12

## Automated

`npm run check` passes. `npm test` passes **31 tests**, including protocol invariants, replay projections, persistence, atomic run creation, HTTP/SSE behavior, cancellation, the CLI adapter's success/error/timeout paths, stable arbitrary-role 3D placement, recorded packet timing, and local delivery of all Three.js modules. Local environment: Node 23.11.0, macOS. CI is configured for Node 22 and 24.

## Real Codex integration

A synthetic announcement run completed using installed `codex-cli 0.142.2`, with per-process `CODEX_MODEL=gpt-5.5` and `CODEX_IGNORE_USER_CONFIG=1`. Global user settings were not modified.

Run `a8f16c76-0ca1-4d94-a013-a6e55d7a0fc9` records **62 events**, **7 inter-agent messages**, three agents, and three actual CLI turns: verifier rejection, rewriter revision, and verifier acceptance. The flawed first draft is an intentional fixed fixture. All requests are answered; the run is completed. Source plus two draft versions are visible.

The initial attempt using the globally configured model was rejected by CLI authentication and remains visible locally as a failed run. The CLI cache advertised gpt-5.5, which was verified before use. Model availability remains account-dependent.

## Browser checks

- Launched the deterministic demo from the UI and observed live SSE updates.
- Rewound to the beginning: no future agents, messages, or artifacts were displayed.
- Played history at 8×, then returned to live.
- Created a separate custom run; added planning and research roles with a parent relationship; sent, acknowledged, and replied to a message in one conversation.
- Reopened the completed real CLI run after server restart. Agent graph, saved artifacts, delivery history, and verifier feedback remained available.
- Tested keyboard activation of a graph edge and confirmed directional message filtering.
- Stepped through the real run's registration events: three agents and zero messages at that point.
- The initial 2D MVP was checked at desktop (1440 × 1000) and mobile (390 × 844). The Three.js update was checked at default desktop (1280 × 720), tablet (1024 × 768), and mobile (390 × 844): no document-level horizontal overflow. The canvas resizes and the inspector moves below the scene on narrow layouts.
- Browser error/warning logs were empty during the initial interactive run.

## Three.js update · v0.2

- Installed pinned Three.js 0.186.1 through npm; module and core are served locally under the existing self-only CSP. No CDN or imported assets.
- Launched a fresh UI demo and observed live crew status and message routes. It completed with **55 events, 7 messages**, and reject → revise → accept. CLI demo run `77e93edd-9a3d-4245-b920-caa55d29a5b3` also completed. These are deterministic fixtures; the existing real Codex run above was reused for 3D replay validation without new model calls.
- Selected a robot directly through canvas raycasting, opened its agent history, dragged to orbit, zoomed, and reset the camera.
- Selected a directional route and confirmed eight related message/ACK events in the real run.
- Rewound the real run to event 1: the crew was empty. Stepped once: only Coordinator existed. At event 34 the scene showed Coordinator waiting, Rewriter working, and Verifier waiting, with four recorded sends rather than the completed run's seven.
- Played at 2× and verified the replay mode; stepping/scrubbing freezes the projected state. Message packets represent recorded sends for 1.8 seconds, not delivery acknowledgements.
- Accessible agent and route controls sit below the canvas. WebGL2 failure has a readable fallback; that failure path was inspected in source, not forced in this browser. Reduced-motion mode uses stationary packet indicators and removes robot bobbing.
- Browser error logs were empty throughout Three.js interaction.

Screenshots: [desktop](dashboard.jpg), [mobile](mobile.jpg). Full synthetic exports are saved locally as ignored `artifacts/local-*.json`; the SQLite history remains in ignored `.runtime/`.

## Boundaries

This is a local MVP. It captures communication routed through its broker and activity emitted by adapters. It does not automatically import existing Codex desktop subagent sessions. Replay reconstructs recorded state and does not rerun models. Worker resumption, multi-user authentication, MCP, pagination, and state snapshots are future work.

## GitHub Pages and API reference

- The optional static build copies only named frontend/client assets, licenses and generated synthetic samples. It never reads `.runtime`, CLI traces, credentials or personal histories.
- Two sample workflows cover rewriter/verifier and planner/researcher/editor roles. Browser simulation progressively records sends and ACKs; replay and export use the same projection as the real dashboard.
- Static demo tests cover partial versus completed state, event sequencing, read-only behavior, Codex rejection, timer cleanup, and repository-subpath asset delivery.
- Browser preview at `/multi-agent-platform/` loaded Three.js successfully; a simulated mission reached 55 events and 7 messages. Rewinding produced an empty crew, and one step showed only Coordinator. The alternate role sample and API guide were accessible.
- The API reference documents all 14 current HTTP method/path combinations, supported event types, mailbox rules, local-only scope, SSE and nine JavaScript client methods.
- GitHub rejected Pages enablement for the private source repository with HTTP 422: “Your current plan does not support GitHub Pages for this repository.” Deployment is gated by `PAGES_ENABLED=true`; builds/tests can pass while repository publishing scope is being decided.

- Preserved the private source repository and created a dedicated public static-assets repository, `Jiayi-Liao/multi-agent-platform-pages`. GitHub accepted Pages enablement for that repository with HTTPS enforced. Generated assets are published from its main branch.

- Public deployment `38211154247` succeeded. Verified the live site at `https://jiayi-liao.github.io/multi-agent-platform-pages/` and its API guide.

- Verified public demo and API guide at a 390px viewport with no document-level horizontal overflow. Downloaded `client.js` through the public guide, and confirmed the updated local dashboard still reconnects to its real SSE stream and original saved Codex history. Screenshots: [public demo](pages-demo.jpg), [API guide](pages-api.jpg).

## Public source repository

- At the user's explicit request, changed `Jiayi-Liao/multi-agent-platform` to public and enabled Actions-based Pages with `PAGES_ENABLED=true`.
- Updated the canonical demo and API URLs to `https://jiayi-liao.github.io/multi-agent-platform/`, and changed the setup guide to anonymous HTTPS cloning. The earlier static-assets repository remains available as a historical preview.

## English default

- Translated the API guide, its navigation, endpoint descriptions, protocol explanations, SDK and curl comments, and page metadata to English. Set `lang="en"` and English UI date formatting. Documented English as the default in the README.
- Checked project source, scripts, tests, documentation, and generated Pages assets for remaining Chinese text; none was found. Agent-provided content remains unchanged.
- Syntax checks, all 31 existing tests, and the Pages build passed. Browser preview confirmed 14 documented HTTP endpoints, an English demo banner and guide, and a working Three.js canvas. Refreshed the API and demo screenshots above.

## Light and dark themes

- Added a shared header theme switch for the dashboard and API guide. A saved preference survives navigation and reloads; system appearance is used before a preference is selected. Theme initialization runs before page paint and tolerates unavailable browser storage.
- The light theme covers panels, forms, status badges, history, replay, timeline, inspector, documentation, and the Three.js outpost. Switching updates fog, lighting, base materials, and labels while preserving the current run and camera.
- Verified light/dark switching, reload persistence, and cross-page preference sharing in the browser. Dashboard and guide stayed within a 390px viewport. Syntax checks, all 31 tests, and the Pages build passed, including delivery and packaging of both theme assets.
- Preview: [light theme](light-theme.jpg).

## Mission overview, replay studio, and crew directory

- Added navigable `#overview`, `#replay`, and `#agents` views with a field-guide visual system: warm paper, forest accents, serif display typography, robot portraits, and matching dark styling. The Three.js outpost remains interactive.
- Overview prioritizes the mission world, compact metrics, latest artifact, and crew access. The replay studio adds a current-event card, scrollable navigation chapters, complete event journal, and keyboard transport controls. Chapters are event landmarks, not persisted state snapshots.
- Agent profiles support arbitrary roles and expose complete cursor-limited histories, incoming/outgoing messages, artifact versions, and tool input/output. The synthetic Verifier profile displayed all **26 related events**, including both sides of message acknowledgement history.
- Selecting a recorded message restored its original queued state. Jumping to event 1 removed all agents and artifacts, while the full journal remained available for navigation. The rewriter/verifier rejection checkpoint displayed the actual recorded feedback.
- Browser checks covered default desktop and **390 × 844** mobile, both themes, no document-level horizontal overflow, play/pause, arrow-key stepping, chapter navigation, profile tabs, and record-to-replay navigation. A deprecated shadow-map constant was replaced with the supported Three.js equivalent.
- Launched a fresh synthetic browser mission; live history updates reached **55 events and 7 messages**, with the completed crew visible in the new agent page.
- Verified the local backend through the UI: created Archivist (memory) and Explorer (research), assigned a parent, composed a message from the agent profile, acknowledged delivery and handling, then completed the run. Delivery history showed queued → delivered → answered. The local browser had no errors or warnings. Existing histories were preserved; no new model calls were made.
- Syntax checks covered **23 JavaScript files**. All **34 tests** passed, including new agent-history, rewind, and chapter-index regressions. Packaging checks cover the new shared history helper and experience stylesheet for local serving and repository-subpath Pages output.

Screenshots: [overview](overview-redesign.jpg), [replay](replay-redesign.jpg), [agent profile](agent-redesign.jpg).

## Newest-first records, Chinese locale, and Dashboard plan — 2026-10-15

- All UI history collections now use committed sequence in descending order: event journal, chapter navigation, agent history/messages/tools/artifacts, conversations, and ACKs. The SQLite log, HTTP history/export/SSE, state projection, and replay clock preserve their ascending processing semantics. Tests include identical timestamps and a later event with an earlier timestamp.
- Projected artifacts/messages/ACKs retain source sequence metadata. Tool ordering follows the latest tool event. Overview output, inspector cards, agent artifacts and generic event details show a full local date/time with milliseconds and timezone, ISO machine time/tooltip, elapsed time, and event sequence.
- English remains the default. Chinese UI and API guide use an explicit catalog, with a persistent language switch shared across pages. Only authored static nodes and explicit dynamic UI labels are translated; runtime names, roles, messages, artifacts and code remain verbatim. Authored capture finishes before runtime rendering. Added a Chinese README and paired Dashboard plans.
- Dashboard navigation opens a clearly labeled planning brief. No metrics or dashboard-write API is advertised as available. The standalone plan covers arbitrary roles, structured metrics and JSON widgets, sequence-based replay, indexed storage, idempotency, request limits, migration/export, implementation stages, and acceptance criteria.
- `npm run check`: 25 JavaScript files; `npm test`: 39 passed; `npm run build:pages`: passed; `git diff --check`: passed.
- Browser checks: local saved Codex run reused without model calls; reverse journal and agent history; artifact v2 before v1 with complete timestamps; rewind to the first event hides future crew/output; return to live restores records; English/Chinese switching and reload persistence; the local enabled Codex option translates correctly; API prose translates while code/paths/fields remain unchanged.
- Static Pages bundle validated at `/multi-agent-platform/`: fresh storage defaults to English, synthetic demo streams new events into the first list position, completed artifacts stay newest-first, and Dashboard is available without requiring an agent selection. No console errors/warnings.
- Responsive checks at 390×844: Chinese navigation, Dashboard brief, agent artifacts and API guide have no horizontal overflow. Temporary viewport overrides reset after verification. Light theme checked visually; theme/language are independently stored and dark styling uses existing semantic tokens.
- Screenshots: `artifacts/chinese-artifacts.jpg` (synthetic data, two artifact versions and timestamps) and `artifacts/dashboard-plan.jpg` (Chinese planning entry).

### Dashboard scope correction — 2026-10-15

The user clarified that Dashboard should give each agent a place to display its finished charts. Replaced the earlier metrics-platform proposal with a small agent chart gallery: agent selection, image thumbnails, title/time, newest-first order, larger preview, and original-file access. Reuse existing agents/artifact ownership and add image attachments during implementation. Updated both plans, both READMEs, and the bilingual planning brief. No chart gallery or upload API is implemented in this planning change. Syntax check, Pages build and diff check passed; the local Chinese brief was visually verified.

## Per-agent interactive HTML dashboards — 2026-10-15

- Implemented the clarified scope: each agent has its own HTML dashboard space. Agents submit complete HTML source, not raster images or a chart-layout/metrics specification. Existing text artifacts are unchanged.
- Added `PlatformClient.chart(name, html, options)`, `POST R/charts`, and `GET R/charts/:documentId/html` with `?download=1`. Source documents and artifact events commit atomically to an additive SQLite table. Metadata is streamed/exported; HTML source is downloaded separately. Registered ownership, UTF-8 size limits, finished-run writes and run isolation are enforced. Request parsing preserves multibyte text across streamed chunks.
- Gallery shows every registered agent, including empty states; work is newest-first with title, version, timestamp, owner and HTML download. Larger previews support the agent's own CSS/JavaScript. Preview frames never receive same-origin access; local responses apply sandbox CSP even for direct opening. Inline dependencies are required; external script loading and fetch/XHR are blocked.
- Trainer submits initial/final loss dashboards; Evaluator submits a comparison dashboard. Trainer has a step slider and validation toggle; Evaluator switches Accuracy/F1. All fixtures use synthetic data, inline SVG/CSS/JavaScript, and no network/model/charting dependency. Both the UI demo and `npm run demo:charts` ran successfully against the local server; the latter uses separate clients for each agent.
- `npm run check`: 31 JavaScript files; `npm test`: 45 passed; `npm run build:pages` and `git diff --check`: passed. Added tests for source preservation/restart, ownership, rollback without orphan files, UTF-8 chunk boundaries, HTTP limits, SSE metadata, direct-view sandbox headers, source downloads, cancellation and Pages streaming. Node 22/24 CI remains configured.
- Browser checks: Evaluator's F1 selection changes the best score from 92% to 88%; Trainer's step control moves to step 5 and validation toggles off. Language changes preserve the active HTML state. Agent content remains verbatim. English/Chinese API guide and SDK examples were checked.
- Local-only isolation fixture: parent DOM, localStorage and `/api/config` fetch were blocked; an internal button still responded to keyboard interaction. The expected blocked fetch produces a CSP console entry only for this deliberate probe. Normal static demo previews have no console errors/warnings.
- Pages preview tested under `/multi-agent-platform/`, with three allowlisted HTML fixtures and no runtime/private data. Browser demo streams HTML artifacts to the correct agents. Rewinding to the start yields zero agents/dashboards; returning to live restores both agents and Trainer's newest-first versions.
- 390×844 mobile gallery/viewer have no horizontal overflow; F1 interaction works on mobile. Light/dark gallery styling checked, with each agent's document retaining its authored appearance. Temporary viewport override reset.
- Screenshots: `artifacts/html-gallery.jpg` and `artifacts/html-interaction.jpg`, both captured from the synthetic Pages preview.

## Agent display names · 2026-10-15

- `npm test`: **52 passing tests**. Seven rename regressions cover run isolation and validation, unchanged routing/hierarchy/HTML ownership, cursor-limited historical names, retry no-ops, terminal execution protection, SQLite restart persistence, encoded agent IDs through HTTP/SDK, SSE delivery, in-flight browser-demo sequences, immutable sample templates, and replay across long post-run metadata gaps.
- `npm run check`: 32 JavaScript files pass syntax checks. `npm run build:pages` and `git diff --check` pass.
- Browser: created a separate two-agent HTML demo (`e601652f-1c08-4080-9f7e-fdab32d92555`); renamed Trainer to `训练负责人` and Evaluator to `Evaluation lead`. Confirmed new names in Dashboard ownership labels, agent profiles/history, 3D labels, and Overview inspector. Agent IDs remain `trainer` / `evaluator`; both agents retain their HTML documents.
- Browser: whitespace-only input is rejected in Chinese; cancellation discards an unsaved draft; a page reload retains saved local names. The event before the Evaluator rename restores `Evaluator`, while returning to live restores `Evaluation lead`. Execution elapsed remains `00:02` after post-run changes.
- Pages preview: renamed a completed synthetic agent, verified the mobile dialog and profile controls without horizontal overflow, and confirmed reload restores the original sample name. Public-demo edits stay in browser memory. English and Chinese UI/API copy, the rename endpoint, and the eleven-method SDK guide were inspected.

## Empty first-use history · 2026-10-18

- Public demo templates no longer appear as saved runs. A new browser session starts with zero runs, agents, events, and dashboards. The explicit rewrite/verifier and HTML demo buttons create their own run histories. Reloading returns browser demo history to empty.
- Existing local SQLite histories and HTML documents are preserved. Fresh local installations already start with an empty database; server startup does not erase work.
- `npm run check`: 32 files pass. `npm test`: **53 passing tests**, including a new initial-empty / explicit-launch / reload regression and updated rename/template-isolation checks. `npm run build:pages` and `git diff --check` pass.
- Browser checks at the repository subpath: initial Overview shows `00` runs and the first-mission prompt; launching a rewrite demo creates one run with four initial events; reload restores `00`. Dashboard initially shows zero agents and HTML documents; explicit HTML demo launch creates two agents; reload restores zero. No browser console errors were recorded. English defaults and Chinese translations are retained.

## Full conversation reader · 2026-10-18

- Replay now opens with a full-width conversation reader: complete multiline message bodies, two-way threads, full-text search, participant filters, reply navigation, exact timestamps, message kinds, delivery states, correlation IDs, and expandable ACK history. Messages remain newest first and follow the replay cursor. The event journal now shows multiline previews, and inspector thread entries retain complete text.
- `npm test`: **57 passing tests**. New regressions cover full long text, separate conversation IDs, bidirectional route filtering, search with intact thread context, ACK-based ordering with skewed timestamps, and cursor-limited messages/status/name changes. `npm run check`: 34 JavaScript files pass. Pages build and whitespace checks pass.
- Verified an isolated in-memory Checker–Worker fixture with long messages, literal HTML markup rendered as text, unrelated threads excluded by participant filtering, full-body search, and links to original messages. Rewinding to the feedback send hides later revisions and ACKs. Expanded message details and reader scroll position survive an unrelated SSE update.
- Verified the actual seven-message Checker–Worker exchange through a private in-memory copy of the pre-reset recovery backup. All original body lengths were retained (including the 4,714-character final review); three explicit reply links are visible. No private conversation text or backup data is included in the public build or repository changes.
- Confirmed the main local API still returns zero runs and serves the new reader module successfully. Browser checks cover mobile width without horizontal overflow, English/Chinese labels, light/dark themes, and the static Pages build under its repository subpath.

## Conversation-first replay layout · 2026-10-18

- Replay uses a single compact, sticky playback toolbar above the conversation reader. Event journal, checkpoints, current-event summary, and inspector live inside a native **Event details** disclosure, closed by default for a new run. The 3D replay world remains available in a nested disclosure and initializes only when requested. Overview retains its world and inspector using the same nodes and controls.
- **Inspect event** seeks the send and automatically opens/focuses the inspector. Chapter/event links open the diagnostic area. Native Enter/Space disclosure behavior remains independent of playback shortcuts. The duplicate conversation-level return-to-live button was removed.
- Automated suite: **57 tests passed**. Final syntax check: **34 JavaScript files**. Pages build and whitespace checks pass.
- Browser validation on the existing private in-memory recovery preview: initial details closed, seven messages intact, one play button and one inspector across repeated Overview/Replay navigation. Rewind hides future messages; return-to-live restores all seven; play/pause works. Space expands details without starting playback. The optional scene displays both agents only after expansion. Inspecting the latest send opens details and selects event 55/66.
- Responsive/static preview: mobile viewport has no horizontal overflow; transport measures 101 px, with unwrapped control icons and 36 px touch buttons. English/Chinese and keyboard disclosure checks passed. A disclosure opened during browser demo playback remains open as events advance to 55. No run history or private message data was added to the main database or public assets.
