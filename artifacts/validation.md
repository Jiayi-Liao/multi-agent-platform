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

This is a local MVP. It captures communication routed through its broker and activity emitted by adapters. It does not automatically import existing Codex desktop subagent sessions. Replay reconstructs recorded state and does not rerun models. Worker resumption, multi-user authentication, MCP, pagination, and checkpoints are future work.

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
