# Validation · 2026-10-12

## Automated

`npm run check` passes. `npm test` passes **26 tests**, including protocol invariants, replay projections, persistence, atomic run creation, HTTP/SSE behavior, cancellation, the CLI adapter's success/error/timeout paths, stable arbitrary-role 3D placement, recorded packet timing, and local delivery of all Three.js modules. Local environment: Node 23.11.0, macOS. CI is configured for Node 22 and 24.

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
