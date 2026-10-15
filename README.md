# Relay · Multi-Agent Platform

[简体中文](README.zh-CN.md)

A local workspace for watching agents communicate and replaying their work. Roles are data: a run can contain writers, reviewers, researchers, planners, or any future role without changing the UI.

![Mission overview](artifacts/overview-redesign.jpg)

The interface, API guide, documentation, and bundled examples use English by default. Use **中文 / EN** in the header to switch the UI and API guide to Chinese; the choice persists across pages. Agent names, roles, messages and artifacts retain the content you submit.

The dashboard and API guide support light and dark themes. Use the theme switch in the header; your preference is saved across pages and reloads. Before a preference is saved, the UI follows your system appearance.

## GitHub Pages preview

**Live demo:** https://jiayi-liao.github.io/multi-agent-platform/ · **API guide:** https://jiayi-liao.github.io/multi-agent-platform/api.html

The source repository is public. Clone it to run the local backend, connect your agents, or extend the visualization. The Pages site provides synthetic examples and the client module.

The project includes a static GitHub Pages build: an interactive Three.js demo with two synthetic sample workflows, browser-simulated message traffic, replay, export, and an [API / setup guide](public/api.html). The published site has no Node/SQLite backend and never loads local histories, credentials, or real CLI traces. Connect real agents to the local HTTP API below.

```sh
npm run build:pages
npm run preview:pages
# Preview: http://localhost:4311/multi-agent-platform/
# dist/ contains only allowlisted public assets and freshly generated synthetic samples.
```

The `GitHub Pages` workflow automatically builds, checks, tests, and deploys on pushes to main. Pages uses **GitHub Actions** as its publishing source, with the repository Actions variable `PAGES_ENABLED=true`. Only the generated `dist/` assets are deployed.

## Start

Requires **Node.js 22.13 or newer**. No API keys are needed for the deterministic demo.

```sh
npm ci --ignore-scripts
npm start
```

Open **http://localhost:4310**, then click **Launch demo**. Or run `npm run demo` in another terminal.

The demo intentionally starts from a flawed announcement, then goes through **reject → revise → accept**. The initial flawed draft is a fixed test fixture in both modes; this guarantees a meaningful review target. Deterministic mode uses fixtures throughout. Codex mode invokes real verifier and rewriter turns after that initial fixture.

## What you can do

Use the sidebar to move between **Overview**, **Replay studio**, **Agent crew**, and **Dashboard** (planning). The URL hash preserves the selected view on reload and supports direct links on GitHub Pages (`#overview`, `#replay`, `#agents`, `#dashboard`).

- **Overview:** a 3D mission outpost, compact run metrics, the latest output, and quick crew access.
- **Replay studio:** a current-event card, transport controls, scrollable chapter checkpoints, and the complete event journal. Events ahead of the cursor are dimmed; selecting one restores that exact point. Space toggles playback and arrow keys step events outside text fields and controls with their own native keyboard behavior.
- **Dashboard:** a planning brief for a chart gallery grouped by agent: choose an agent, preview its finished images, and open the original files. Image submission and the gallery are not implemented yet; see the [implementation plan](artifacts/dashboard-plan.md) ([中文](artifacts/dashboard-plan.zh-CN.md)).
- **Agent crew:** search arbitrary names or roles, inspect current activity and parent relationships, and switch between complete history, messages, artifacts, and tools. Opening a record jumps to it in replay. Event journals, chapters, agent records, conversations, acknowledgements, tools and artifacts list newest events first. Artifact cards include a full local timestamp with timezone, elapsed time, and source event sequence. Every profile follows the selected replay point; agents and output that do not exist yet remain absent.


- Explore a Three.js agent outpost: robots, workstations, glowing communication routes, and recorded send packets. Drag to orbit, scroll or use buttons to zoom, and reset the camera. Select a robot to inspect it; select a route to filter its messages. Arbitrary roles and parent relationships appear automatically.
- The 3D world follows the replay clock, including agent statuses and message sends. Pausing freezes activity; scrubbing reconstructs that point in history. Send animations last 1.8 seconds and do not imply delivery — acknowledgements are recorded separately. Accessible agent/route buttons remain available when WebGL2 is unavailable.
- Follow a timeline with a lane per agent; inspect messages, delivery history, correlated replies, tool input/output, and versioned artifacts.
- Replay saved runs with play/pause, event stepping, scrubbing, and 1×/2×/4×/8× speed. Replay does not execute agents or make model calls.
- Create a custom run, add agents, exchange messages manually in the inspector, then finish the run.
- Connect your own runtime through the API and the small JavaScript client.
- Export run history as JSON. Local histories survive browser reloads and server restarts.

## Real Codex demo

Install and authenticate the official Codex CLI. Enable model-backed runs explicitly:

```sh
ENABLE_CODEX=1 npm start
# In a second terminal:
npm run demo:codex
```

You can also choose **Codex CLI · real agents** in the dashboard. These turns use your CLI account and consume its normal usage. Each turn runs in a temporary directory, in a read-only sandbox, with structured output and a three-minute timeout.

The adapter preserves your configured CLI settings by default. If that configuration uses a model unavailable to CLI authentication, choose a model supported by your own CLI account for this process:

```sh
ENABLE_CODEX=1 CODEX_MODEL=gpt-5.5 CODEX_IGNORE_USER_CONFIG=1 npm start
```

This was the configuration verified on the development machine. It does not modify global Codex settings and is not a guarantee of model access for other accounts. `CODEX_BIN` can point to another installed Codex executable.

The UI records CLI runtime activity and usage separately from inter-agent messages. Agents communicate through the platform's durable mailbox; model execution is an adapter operation orchestrated by the demo.

## Connect arbitrary agents

```js
import { PlatformClient } from "./src/client.js";

const planner = new PlatformClient({ agentId: "planner" });
const run = await planner.createRun("Research review");
await planner.register({ name: "Planner", role: "planning" });

const researcher = new PlatformClient({ runId: run.id, agentId: "researcher" });
await researcher.register({
  name: "Researcher",
  role: "research",
  parentId: "planner",
});

const request = await planner.send("researcher", "Find relevant papers.", {
  id: "research-request-1",
  conversationId: "research-conversation-1",
});
await researcher.ack(request.id, "delivered");
await researcher.ack(request.id, "processing");
await researcher.status("working", "Reviewing papers");
// Your actual agent/runtime does the work here.
const result = await researcher.reply(request, "Here is the research summary.");
await planner.ack(result.id, "delivered");
await planner.ack(result.id, "answered");
await planner.finish();
```

Poll `client.inbox()` from an external worker to receive outstanding messages; acknowledged terminal messages leave the inbox. Add your runtime's tools/artifacts with `client.record()`. This MVP does **not** automatically capture arbitrary existing Codex desktop chats or their native subagent messages.

## API

UI ordering never mutates the persisted log: history APIs, exports, SSE and replay projection stay in ascending commit order; worker inboxes retain oldest-first processing.

The HTTP API is available at **http://localhost:4310**. It is a local API, not an internet-hosted service. POST requests require `Content-Type: application/json` and at most 128,000 bytes. Run endpoints are run-scoped and use JSON. The [browser API guide](public/api.html) also covers the JavaScript client and SSE subscriptions. A run is the communication namespace. A conversation belongs to two participants inside that run.

| Method     | Endpoint                                   | Purpose                                                                                                           |
| ---------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| GET        | `/api/config`                              | Whether the server allows Codex CLI demos (`enableCodex`)                                                         |
| GET / POST | `/api/runs`                                | List / create runs (`title`, optional `mode`)                                                                     |
| GET        | `/api/runs/:runId`                         | Run and ordered events                                                                                            |
| POST       | `/api/runs/:runId/agents`                  | Register `id`, `name`, `role`, optional `parentId`                                                                |
| POST       | `/api/runs/:runId/messages`                | Send `fromAgentId`, `toAgentId`, `content`, optional `id`, `conversationId`, `replyTo`, `kind`, `expectsResponse` |
| GET        | `/api/runs/:runId/agents/:agentId/inbox`   | Pending messages, oldest first; `limit=1..100`, default 25                                                        |
| POST       | `/api/runs/:runId/messages/:messageId/ack` | Recipient `actorId` and delivery `state`                                                                          |
| POST       | `/api/runs/:runId/events`                  | Record `type` and `payload` for status, tools, artifacts                                                          |
| GET        | `/api/runs/:runId/stream?after=:seq`       | SSE backlog and live events; honors `Last-Event-ID` on reconnect                                                  |
| POST       | `/api/runs/:runId/finish`                  | Finish with `status=completed` (default), `failed`, or `cancelled`; optional `error`                              |
| POST       | `/api/runs/:runId/cancel`                  | Stop the owned demo and mark the run cancelled                                                                    |
| GET        | `/api/runs/:runId/export`                  | Download recorded run JSON                                                                                        |
| POST       | `/api/demo`                                | Start `mode=deterministic` or opt-in `codex`                                                                      |

Supported external event types:

- `agent.status`: `{ agentId, status, activity }`; statuses: `idle`, `working`, `waiting`, `completed`, `failed`.
- `tool.started`: `{ id, agentId, name, input? }`.
- `tool.completed`: `{ id, agentId, output?, error? }`.
- `artifact.created`: `{ id?, agentId, name, content, version? }`.

Message delivery follows `queued → delivered → processing → answered`, with a `failed` terminal path. A correlated reply can atomically mark its request answered. Requests with `expectsResponse=true` require a reply; ACK alone cannot claim a response. Fire-and-forget messages can be marked answered by their recipient.

Use the same explicit `id` and `conversationId` when retrying a send: identical retries are idempotent, while conflicting reuse returns HTTP 409. Finished runs are read-only. Successful completion rejects outstanding reply requests or running tools. Cancellation/failure closes pending messages and recorded tools. Interrupted runs become visibly failed after restart; history remains intact. Automatic worker resumption is not implemented.

## Architecture

```text
Runtime / manual UI / demo
          ↓
Run-scoped message broker + validation
          ↓
SQLite append-only event log (WAL, ordered sequence)
          ↓
SSE stream and history API
          ↓
Shared pure state projection
          ↓
Three.js world / agent timeline / inspector / replay
```

`src/store.js` owns protocol validation and transactional persistence. `src/state.js` projects recorded events and is shared directly by the server and browser. `src/codex.js` adapts real CLI turns. `src/client.js` is runtime-neutral. The frontend uses browser ES modules and Three.js 0.186.1, installed through npm and served locally. The local app needs no build step, CDN, external assets, or framework. The optional Pages build rewrites module/asset paths for a repository subdirectory and switches to a synthetic browser transport. `public/world.js` renders the scene; `src/world-state.js` owns stable agent slots and recorded send timing. Graphics resources are disposed on scene changes, pixel density is capped, offscreen rendering pauses, and reduced-motion preferences are respected.

Three.js setup and resizing follow the [official installation guide](https://threejs.org/manual/pages/installation.html) and [responsive canvas guide](https://threejs.org/manual/pages/responsive.html).

Data lives in `.runtime/events.sqlite` and is ignored by Git. The server binds only to `127.0.0.1`; browser writes require the same origin and JSON. Agent IDs are routing identities, **not authenticated principals**. Use this as a trusted local tool; remote hosting needs authentication and authorization first.

## Validation

```sh
npm run check
npm test
```

Tests cover correlated replies, idempotency, acknowledgement transitions, run isolation, dynamic roles, replay state, SQLite restart persistence, HTTP validation, SSE backlog/live delivery, cancellation, adapter failures, subprocess timeouts, and the full reject/revise/accept demo. CI runs on Node 22 and 24. Real CLI runs are manual integration checks, not credentialed CI jobs. See [validation evidence](artifacts/validation.md).

## Scope and next steps

This first version includes communication recording and playback plus a functioning Codex demo adapter. It does not manage arbitrary desktop agent processes, provide multi-user access, implement MCP, automatically resume crashed workers, or import exported histories. Large histories currently load into memory; pagination, state snapshots, and timeline virtualization are natural next steps for very long runs.

## Inspiration

Communication design informed by [Open Agent Bridge](https://github.com/kevinArgueta96/open-agent-bridge): conversation correlation, directed mailboxes, explicit delivery states, and durable messages. This project is an independent implementation, not a fork or a protocol-compatible client.

The Codex adapter follows [official OpenAI non-interactive documentation](https://developers.openai.com/codex/noninteractive/) and was checked against the locally installed CLI's flags.

MIT licensed.
