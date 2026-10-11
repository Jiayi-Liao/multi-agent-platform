# Validation · 2026-10-12

## Automated

`npm run check` passes. `npm test` passes **23 tests**, including protocol invariants, replay projections, persistence, atomic run creation, HTTP/SSE behavior, cancellation, and the CLI adapter's success/error/timeout paths. Local environment: Node 23.11.0, macOS. CI is configured for Node 22 and 24.

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
- Checked desktop (1440 × 1000) and mobile (390 × 844) layouts. Neither had document-level horizontal overflow; the graph has its own scrolling surface on narrow screens.
- Browser error/warning logs were empty during the initial interactive run.

Screenshots: [desktop](dashboard.jpg), [mobile replay](mobile.jpg). Full synthetic exports are saved locally as ignored `artifacts/local-*.json`; the SQLite history remains in ignored `.runtime/`.

## Boundaries

This is a local MVP. It captures communication routed through its broker and activity emitted by adapters. It does not automatically import existing Codex desktop subagent sessions. Replay reconstructs recorded state and does not rerun models. Worker resumption, multi-user authentication, MCP, pagination, and checkpoints are future work.
