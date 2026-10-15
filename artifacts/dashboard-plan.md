# Agent-created Dashboards — implementation plan

Status: proposed, not implemented. The sidebar opens a design brief, not a chart editor.

[简体中文](dashboard-plan.zh-CN.md)

## Goal and representative flow

Let any agent publish structured experiment results and a dashboard through the same durable history used for communication. A training agent emits `train/loss` at explicit steps; an evaluator emits `eval/loss` against the same experiment ID; a coordinator creates a board comparing those series. A user watches updates, pauses at an earlier event, and selects a point to inspect the publishing agent and related artifact.

Support arbitrary roles and experiment types. Rewriter/verifier is one example, not a data-model constraint. Keep the existing Three.js outpost for agent activity; charts use a readable 2D workspace with matching themes and localization.

## First release boundaries

- One run owns many experiments, dashboards, metric series, and points. Boards are run-scoped initially. Cross-run comparison requires an explicit later workspace model, rather than silently joining unrelated histories.
- Agents create/update boards through a validated JSON specification. Users can select boards and experiments, toggle series, zoom/reset chart ranges, inspect points, and copy a board definition.
- Widgets: line chart (loss/evaluation curves), scalar summary, and compact results table. Default line view uses raw values, an explicit step axis, and a visible latest value. No smoothing by default.
- The sidebar Dashboard becomes a functional workspace with board selection, live/paused indicator, chart grid, empty state, and an inspector. It works without a selected agent.
- Static Pages ships synthetic training/evaluation traces and runs entirely in browser memory. Local mode persists data and accepts agent writes.

Exclude arbitrary agent HTML/JavaScript, remote iframes, hosted authentication, training-process management, alerts, and a drag-and-drop chart builder from the first release. A dashboard is a presentation of submitted data, not a process launcher.

## Proposed contract (not available today)

```json
{
  "id": "training-overview",
  "title": "Training experiment",
  "authorAgentId": "coordinator",
  "expectedRevision": 0,
  "widgets": [
    {
      "id": "loss", "type": "line", "title": "Loss",
      "experimentIds": ["experiment-a"],
      "series": ["train/loss", "eval/loss"],
      "xAxis": "step", "yScale": "linear",
      "layout": { "column": 0, "row": 0, "width": 8 }
    }
  ]
}
```

A board update supplies the expected revision. Stale writes return 409; each accepted revision remains in history. References to missing experiments/series fail validation; clients register sources first. Rev 1 has no deletion API; hiding a widget in a new board revision preserves old history.

Metric batches carry a unique stable `batchId`, registered `agentId`, and `experimentId`. Each point contains `series`, finite numeric `value`, nonnegative integer `step`, optional `observedAt`, and optional `sourceEventId`/`artifactId` inside the same run. Series are registered with a display name, unit, and owning agent before writes. Only that routing identity may publish it in trusted local mode; this is consistency validation, not authentication.

Within one experiment/series, step uniquely identifies a point. Identical retry batches are idempotent; reusing an ID or step with conflicting content returns 409. Different series may share a step. Initially, corrections use a new series/experiment; no silent overwrite. Non-finite numbers, unregistered identities, invalid references, and malformed widget specs return 400. All endpoints inherit existing same-origin/JSON checks. New write endpoints reject finished runs.

| Proposed method | Run-scoped path | Purpose |
| --- | --- | --- |
| POST | `R/experiments` | Register experiment ID, name, agent ID, bounded configuration |
| POST | `R/metric-series` | Register series identity, experiment, owner, unit |
| POST | `R/metrics/batches` | Append validated points atomically; return committed sequence |
| GET | `R/metrics` | Query experiment/series, step bounds, `asOfSeq`, page limit/cursor |
| POST | `R/dashboards` | Create revision 1 with idempotency key |
| PUT | `R/dashboards/:id` | Append revision with `expectedRevision` |
| GET | `R/dashboards?asOfSeq=...` | List boards visible at the replay cursor |
| GET | `R/dashboards/:id?asOfSeq=...` | Read a particular projected board revision |

`R = /api/runs/:runId`. These names are proposals, not additions to the current API guide's available endpoints. SDK additions mirror this contract: `experiment`, `series`, `metrics`, `createDashboard`, `updateDashboard`, `dashboards`.

Initial hard limits: 64 KiB per new request (also below the existing 128,000-byte ceiling), 500 points per batch, 24 widgets per board, 32 queried series, and 5,000 returned points per request. Paginate exact points; chart rendering may use a clearly labeled downsampled view. Revisit limits using measured load rather than silently truncating data.

## Durable history and replay

1. Add versioned `experiment.registered`, `metric.series.registered`, `metric.batch.appended`, and `dashboard.revised` events. Keep batches atomic. Assign the server timestamp and committed sequence; preserve optional producer observation time separately.
2. Add an additive SQLite migration with indexed metric projections `(run_id, experiment_id, series, step, event_seq)` and dashboard revision projections. Write log and projection rows in one transaction. Persist the batch payload once in the event log; indexed rows support bounded queries. Existing databases/runs remain readable.
3. Use append-only events as the source of truth. Projection tables must be rebuildable from the log. Migration runs transactionally; export version 2 includes all data/schema metadata. Test round-trip replay from an exported fixture before claiming compatibility; existing version 1 exports stay readable by the existing app.
4. Reuse the current SSE stream for committed board/metric events. Reconnect with the last seen sequence and deduplicate by event/batch ID. Coalesce browser redraws to at most four per second, without dropping committed records.
5. Filter boards, experiments, series and points by `event_seq <= asOfSeq`. A future board revision or point must remain absent when rewinding. Use commit sequence as the time-travel authority even for backdated observation timestamps.
6. A metric point's x position comes from its explicit step; commit order controls visibility. Backfilled steps can appear out of order without redrawing an invented history. Clicking a point jumps to its batch event and opens per-point provenance. If a batch has multiple points, select by series + step.
7. List histories newest first; charts retain ascending x coordinates. A paused board shows “new events available” and only advances through an explicit return-to-live action. Resuming follows the latest committed sequence.

The present frontend loads all run events. Introduce bounded metric queries and a metadata/bootstrap plus paged-history path as part of this feature; otherwise large batches would defeat the scalability benefit of an index. Keep old endpoints compatible for small histories, and document their memory cost.

## UI and agent workflow

On Dashboard, show a board/experiment selector, live state, last update time (with timezone), and a full-width chart grid. Each widget shows units, source agent, legend, data range, empty/loading/error states, and whether its view is downsampled. Shared hover/crosshair can compare series at the same step; missing steps remain gaps. Log scale rejects/flags nonpositive values explicitly. Scalar widgets state their reduction (latest/min/max) and the step of the selected value; tables have explicit column schemas and row limits.

An empty board offers an SDK example, a JSON schema link, and a synthetic loss-curve demo. The inspector links to agent profiles, source event, and optional artifact. Keep English default, add Chinese labels, keyboard-accessible controls, accessible chart summaries/data tables, reduced motion, and light/dark themes. Never mutate submitted names or experiment values during translation.

Agents can discover capabilities through a read-only schema/example endpoint in the feature release. Provide a complete local script: create run → register arbitrary trainer/evaluator/coordinator → register experiment/series → create board → append batches → finish → inspect and replay. Failed writes return actionable field-level errors. Dashboard mutations remain a separate contract from free-text artifacts.

## Implementation sequence and review gates

| Phase | Deliverable | Exit evidence |
| --- | --- | --- |
| 0 — contract | Schema, error model, migration design, sample fixture, UI wireframe | Review loss-curve flow, limits, idempotency and replay semantics before implementation |
| 1 — storage + API | Transactional events/indexes, queries, SDK, schema discovery | Migration from current DB; duplicate/conflict/restart tests; exact `asOfSeq` queries |
| 2 — workspace | Functional Dashboard nav, board selection, line/scalar/table rendering, inspector | End-to-end agent script produces a visible chart and point-to-event navigation |
| 3 — live + replay | SSE coalescing/reconnect, paused/live UX, bounded history loading | New points stream in; rewind removes future points/board revisions; reconnect has no duplicates |
| 4 — release | Synthetic Pages demo, English/Chinese docs, performance/a11y checks | CI + clean build + local/browser/Pages verification; migration/export recovery documented |

Do not assign a fixed schedule until phase 0 settles the volume and chart-rendering approach. Prototype 10,000 and 100,000 points, then choose a chart renderer based on measured interaction cost, accessible fallbacks, bundle size, and licensing. Keep Three.js independent of the chart lifecycle.

## Acceptance tests

- Run one trainer plus evaluator publishing 100 loss steps. Both lines appear; a coordinator-created scalar and results table agree with source points.
- Two agents update a board concurrently: one succeeds, one receives a revision conflict; no lost update.
- Retry an acknowledged batch after reconnect/restart: no duplicate points or events. Conflicting retries fail atomically.
- Send same timestamps, late/backfilled steps and multiple points in one batch. Replay visibility follows event sequence, charts order by explicit x, and provenance selects the correct point.
- Rewind before an experiment, point, or board revision exists; none of its data leaks into the UI. Switching boards/runs aborts stale queries.
- Reject NaN/infinity, excessive payloads, unknown series, cross-run references, finished-run writes, unsafe widget types and embedded executable markup.
- Validate old DB migration and rebuild projections. Kill a process between requests; committed data survives, incomplete batches cannot appear.
- Benchmark 100,000 points across 10 series: every query is bounded, displayed reductions are labeled, paused replay remains responsive. Target interactions under 200 ms and no long task over 100 ms during a normal batch; record actual browser/hardware results and refine before release.
- Verify Chinese/English, light/dark, 390 px layout, keyboard flow, chart summaries, and Pages synthetic data isolation.

## Open design decisions

After the run-scoped release: cross-run comparison/retention, corrected metric values, user-edited boards vs agent ownership, downloadable analytical data, and remote authentication. A follow-up proposal must specify permissions and history semantics before adding any of them.
