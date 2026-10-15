# Dashboard: an HTML space for each agent

Status: implemented. [简体中文](dashboard-plan.zh-CN.md)

Each agent has a place for its own HTML dashboards. Agents create the layout, charts and interactions; the platform stores, groups and previews their finished documents.

- Choose a run, then an agent. Every registered agent is visible, including empty states.
- Browse submitted HTML, newest first, with title, time and version.
- Open a larger interactive preview, open the HTML directly, or download its source.
- Submit through `client.chart(name, html, { content?, version? })`. The run and agent must already exist.
- HTML and the artifact event are saved atomically in SQLite, survive restart, and follow the replay cursor.
- Self-contained HTML supports inline CSS, JavaScript, SVG and canvas. Previews use an opaque-origin sandbox; libraries and data must be inline.

The two-agent demo has Trainer submit interactive loss dashboards and Evaluator submit a metric-switching comparison dashboard. Trainer submits a second version to demonstrate newest-first order. Use **Run HTML demo**, or `npm run demo:charts` against the local server. Pages uses only bundled synthetic documents.

No experiment-management system, point-by-point metric API, or chart-layout protocol is required. Agent HTML remains the unit of submission. See the README and API guide for endpoints and limits.
