import { project, terminalMessages } from "/state.js";
import { AgentWorld } from "/world.js";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const palette = [
  "#d5f867",
  "#8dbbd2",
  "#f0aa77",
  "#d9a3bd",
  "#91cdb2",
  "#c8b892",
];
let runs = [],
  runId = null,
  events = [],
  source = null,
  cursor = 0,
  live = true,
  playing = false,
  playbackTime = 0;
let selection = null,
  agentFilter = null,
  edgeFilter = null,
  state,
  generation = 0,
  connected = false,
  toastTimer,
  refreshTimer;
async function api(path, data) {
  const res = await fetch(
    path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Request failed.");
  return result;
}
const act =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      toast(error.message);
    }
  };
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 5500);
}
const duration = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const firstTime = () => events[0]?.timestamp || 0;
const lastTime = () => events.at(-1)?.timestamp || firstTime();
const color = (id) =>
  palette[Math.max(0, Object.keys(state.agents).indexOf(id)) % palette.length];
const name = (id) => state.agents[id]?.name || id || "System";
function connection(text, ok = false) {
  connected = ok;
  $("connection").textContent = text;
  document.querySelector(".connection-dot").style.background = ok
    ? "var(--lime)"
    : "var(--orange)";
}
async function refreshRuns() {
  runs = await api("/api/runs");
  renderRuns();
}
function renderRuns() {
  $("run-count").textContent = String(runs.length).padStart(2, "0");
  $("run-list").innerHTML = runs.length
    ? runs
        .map(
          (r) =>
            `<button class="run-item ${r.id === runId ? "selected" : ""}" data-run="${esc(r.id)}"><strong>${esc(r.title)}</strong><small><span>${esc(r.status.toUpperCase())} · ${r.agentCount} agents</span><span>${new Date(r.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></small></button>`,
        )
        .join("")
    : '<div class="sidebar-empty">No runs yet.<br>Your history will appear here.</div>';
}
async function selectRun(id) {
  const token = ++generation;
  source?.close();
  source = null;
  playing = false;
  selection = null;
  agentFilter = null;
  edgeFilter = null;
  live = true;
  connection("Loading history");
  const result = await api(`/api/runs/${id}`);
  if (token !== generation) return;
  runId = id;
  events = result.events;
  cursor = Math.max(0, events.length - 1);
  localStorage.setItem("relay-run", id);
  renderRuns();
  render();
  source = new EventSource(
    `/api/runs/${id}/stream?after=${events.at(-1)?.seq || 0}`,
  );
  source.onopen = () => {
    if (token === generation) {
      connection("Event stream connected", true);
      renderInspector();
    }
  };
  source.onerror = () => {
    if (token === generation) connection("Reconnecting…");
  };
  source.onmessage = (e) => {
    if (token !== generation) return;
    const event = JSON.parse(e.data);
    if (events.some((existing) => existing.seq === event.seq)) return;
    events.push(event);
    if (live) cursor = events.length - 1;
    render();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshRuns().catch(() => {}), 200);
  };
}
function visibleEvents() {
  return events.slice(0, cursor + 1);
}
function render() {
  $("workspace").hidden = !runId;
  $("empty").hidden = !!runId;
  if (!runId) return;
  state = project(visibleEvents());
  const run = state.run;
  $("run-title").textContent = run.title;
  $("run-id").textContent = run.id.slice(0, 8);
  $("run-badge").textContent = run.status.toUpperCase();
  $("run-badge").className = `badge ${run.status}`;
  const messages = Object.values(state.messages);
  $("stat-agents").textContent = String(
    Object.keys(state.agents).length,
  ).padStart(2, "0");
  $("stat-messages").textContent = String(messages.length).padStart(2, "0");
  $("stat-pending").textContent = String(
    messages.filter((m) => m.expectsResponse && !terminalMessages.has(m.status))
      .length,
  ).padStart(2, "0");
  $("stat-elapsed").textContent = duration(
    (events[cursor]?.timestamp || firstTime()) - firstTime(),
  );
  $("stat-events").textContent = `${cursor + 1} recorded events`;
  $("view-mode").textContent = live ? "● LIVE" : "◷ REPLAY";
  $("view-mode").className = `live-tag ${live ? "" : "replay"}`;
  $("replay-label").textContent = live
    ? "Following live events"
    : playing
      ? "Playing recorded history"
      : "Paused in history";
  $("scrubber").max = Math.max(0, events.length - 1);
  $("scrubber").value = cursor;
  $("cursor-label").textContent = `EVENT ${cursor + 1} / ${events.length}`;
  $("duration-label").textContent = duration(lastTime() - firstTime());
  $("play").textContent = playing ? "Ⅱ" : "▶";
  $("play").setAttribute(
    "aria-label",
    playing ? "Pause replay" : "Play replay",
  );
  $("cancel").hidden = !live || run.status !== "running";
  $("finish").hidden =
    !live || run.status !== "running" || run.mode !== "custom";
  $("finish").disabled =
    messages.some(
      (m) => m.expectsResponse && !terminalMessages.has(m.status),
    ) || state.tools.some((t) => t.status === "running");
  $("add-agent").disabled = !live || run.status !== "running";
  renderGraph();
  renderTimeline();
  renderInspector();
}
let world;
function pickWorld(item) {
  if (item.agentId) {
    selection = { agentId: item.agentId };
    render();
  } else if (item.messageId) {
    selection = {
      eventId: visibleEvents().find(
        (e) => e.type === "message.sent" && e.payload.id === item.messageId,
      )?.id,
    };
    render();
  } else if (item.from) {
    edgeFilter = { from: item.from, to: item.to };
    agentFilter = null;
    renderTimeline();
  }
}
function renderGraph() {
  world ||= new AgentWorld($("world-canvas"), pickWorld);
  world.update(state, {
    clock: live
      ? Math.max(Date.now(), events[cursor]?.timestamp || 0)
      : playing
        ? playbackTime
        : events[cursor]?.timestamp || firstTime(),
    live,
    playing,
    selected: selection?.agentId,
    runId,
  });
}
function eventInfo(e) {
  const p = e.payload;
  if (e.type === "message.sent")
    return {
      title: `${name(p.fromAgentId)} → ${name(p.toAgentId)}`,
      text: p.content,
      kind: "message",
      symbol: "↗",
      agentId: p.fromAgentId,
      status: state.messages[p.id]?.status,
    };
  if (e.type === "message.acknowledged") {
    const m = state.messages[p.messageId];
    return {
      title: `${name(p.actorId)} · ${p.state}`,
      text: m?.content || "",
      kind: "message",
      symbol: "✓",
      agentId: p.actorId,
    };
  }
  if (e.type === "agent.registered")
    return {
      title: `${p.name} joined`,
      text: `Role: ${p.role}${p.parentId ? ` · Parent: ${name(p.parentId)}` : ""}`,
      kind: "agent",
      symbol: "+",
      agentId: p.id,
    };
  if (e.type === "agent.status")
    return {
      title: `${name(p.agentId)} · ${p.status}`,
      text: p.activity,
      kind: "agent",
      symbol: "○",
      agentId: p.agentId,
    };
  if (e.type.startsWith("tool."))
    return {
      title: `${name(p.agentId)} · ${e.type === "tool.started" ? p.name : "Tool finished"}`,
      text: p.error || p.output || p.input,
      kind: "tool",
      symbol: "⌘",
      agentId: p.agentId,
    };
  if (e.type === "runtime.activity")
    return {
      title: `${name(p.agentId)} · ${p.eventType}`,
      text: p.itemType || (p.usage ? JSON.stringify(p.usage) : p.threadId),
      kind: "tool",
      symbol: "⌘",
      agentId: p.agentId,
    };
  if (e.type === "artifact.created")
    return {
      title: `${p.name} · v${p.version || 1}`,
      text: p.content,
      kind: "artifact",
      symbol: "◇",
      agentId: p.agentId,
    };
  return {
    title: e.type === "run.created" ? "Run started" : `Run ${p.status}`,
    text: p.error || state.run.title,
    kind: "run",
    symbol: "◎",
  };
}
function renderTimeline() {
  const visible = visibleEvents(),
    query = $("search").value.toLowerCase(),
    kind = $("event-kind").value;
  const filtered = visible.filter((e) => {
    const info = eventInfo(e),
      p = e.payload;
    const m =
      e.type === "message.acknowledged"
        ? state.messages[p.messageId]
        : e.type === "message.sent"
          ? p
          : null;
    const related =
      info.agentId === agentFilter ||
      m?.toAgentId === agentFilter ||
      m?.fromAgentId === agentFilter;
    if (agentFilter && !related) return false;
    if (
      edgeFilter &&
      (!m || m.fromAgentId !== edgeFilter.from || m.toAgentId !== edgeFilter.to)
    )
      return false;
    return (
      (kind === "all" || info.kind === kind) &&
      `${info.title} ${info.text || ""}`.toLowerCase().includes(query)
    );
  });
  $("activity-count").textContent = filtered.length;
  $("clear-filter").hidden = !agentFilter && !edgeFilter;
  const total = Math.max(1, lastTime() - firstTime());
  $("lanes").innerHTML = Object.values(state.agents)
    .map(
      (a) =>
        `<div class="swimlane"><button class="lane-name ${agentFilter === a.id ? "active" : ""}" data-filter-agent="${esc(a.id)}" style="color:${color(a.id)}">${esc(a.name)}</button><div class="lane-track"><span class="lane-progress" style="width:${Math.min(100, (((events[cursor]?.timestamp || firstTime()) - firstTime()) / total) * 100)}%"></span>${visible
          .filter((e) => eventInfo(e).agentId === a.id)
          .map(
            (e) =>
              `<button class="lane-event ${selection?.eventId === e.id ? "selected" : ""}" style="left:${((e.timestamp - firstTime()) / total) * 96 + 2}%;background:${color(a.id)}" data-event="${esc(e.id)}" aria-label="${esc(eventInfo(e).title)}" title="${esc(eventInfo(e).title)}"></button>`,
          )
          .join("")}</div></div>`,
    )
    .join("");
  $("timeline").innerHTML = filtered.length
    ? filtered
        .map((e) => {
          const info = eventInfo(e);
          return `<button class="event-row ${selection?.eventId === e.id ? "selected" : ""}" data-event="${esc(e.id)}"><span class="event-time">${duration(e.timestamp - firstTime())}</span><span class="event-symbol ${info.kind}">${info.symbol}</span><div class="event-main"><header>${esc(info.title)}<small>${esc(info.status || info.kind)}</small></header><p>${esc(info.text || "")}</p></div></button>`;
        })
        .join("")
    : '<p class="no-events">No events match this view.</p>';
}
function compose(agentId, original = null) {
  if (!live || state.run.status !== "running") return "";
  const peers = Object.values(state.agents).filter((a) => a.id !== agentId);
  if (!peers.length)
    return '<p class="inspector-intro">Add another agent to exchange messages.</p>';
  return `<form class="message-compose" id="message-form" data-to="${esc(agentId)}" ${original ? `data-reply="${esc(original.id)}"` : ""}><div class="eyebrow">${original ? "REPLY IN THIS CONVERSATION" : "SEND A MESSAGE"}</div>${original ? `<div class="detail-meta">${esc(name(agentId))} → ${esc(name(original.fromAgentId))}</div>` : `<label>From<select name="from">${peers.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}</select></label>`}<label>Message<textarea name="content" required maxlength="32000" placeholder="${original ? "Respond to this message…" : "Assign work or share context…"}"></textarea></label>${original ? "" : '<label><input type="checkbox" name="expectsResponse" checked> Expect a reply</label>'}<button class="primary">${original ? "Send reply" : "Send message"} ↗</button></form>`;
}
function renderInspector() {
  if (
    $("inspector-content").contains(document.activeElement) &&
    ["TEXTAREA", "INPUT", "SELECT"].includes(document.activeElement.tagName)
  )
    return;
  const el = $("inspector-content");
  if (selection?.agentId && state.agents[selection.agentId]) {
    const a = state.agents[selection.agentId];
    const history = visibleEvents()
      .filter((e) => {
        const info = eventInfo(e);
        return (
          info.agentId === a.id ||
          (e.type === "message.sent" && e.payload.toAgentId === a.id)
        );
      })
      .slice(-12);
    el.innerHTML = `<div class="eyebrow">AGENT DETAILS</div><h4>${esc(a.name)}</h4><span class="detail-tag">${esc(a.role)} · ${esc(a.status)}</span><div class="detail-label">Current activity</div><div class="detail-body">${esc(a.activity || "Ready for work")}</div><div class="detail-label">Identity</div><div class="detail-meta">${esc(a.id)}<br>Parent: ${esc(a.parentId ? name(a.parentId) : "Root agent")}</div><div class="detail-label">Recent agent history</div>${history.map((e) => `<button class="conversation-button" data-event="${esc(e.id)}">${esc(eventInfo(e).title)}<br><span class="muted">${esc((eventInfo(e).text || "").slice(0, 140))}</span></button>`).join("")}${compose(a.id)}`;
    return;
  }
  const event = visibleEvents().find((e) => e.id === selection?.eventId);
  if (!event) {
    el.innerHTML = `<div class="inspector-intro"><span class="big-arrow">↖</span>Select an agent to explore its history.<br>Select a message to follow its conversation.<br>Move through playback to inspect an earlier state.</div><div class="detail-label">Run summary</div><div class="detail-meta">${esc(state.run.mode)} runtime<br>${events.length} events saved locally<br>${connected ? "Live event stream connected" : "Connecting to event stream"}</div>${state.run.error ? `<div class="detail-label">Run stopped</div><div class="detail-body">${esc(state.run.error)}</div>` : ""}<div class="detail-label">Artifacts at this point</div>${state.artifacts.map((a) => `<div class="artifact-card"><strong>${esc(a.name)} · v${a.version || 1}</strong><p>${esc(a.content)}</p></div>`).join("")}`;
    return;
  }
  const p = event.payload,
    m =
      event.type === "message.sent"
        ? state.messages[p.id]
        : event.type === "message.acknowledged"
          ? state.messages[p.messageId]
          : null;
  if (m) {
    const thread = Object.values(state.messages).filter(
      (x) => x.conversationId === m.conversationId,
    );
    const canAck =
      live && state.run.status === "running" && !terminalMessages.has(m.status);
    el.innerHTML = `<div class="eyebrow">COMMUNICATION</div><h4>${esc(name(m.fromAgentId))} → ${esc(name(m.toAgentId))}</h4><span class="detail-tag">${esc(m.kind)} · ${esc(m.status)}</span><div class="detail-label">Message</div><div class="detail-body">${esc(m.content)}</div><div class="detail-label">Correlation</div><div class="detail-meta">Message: ${esc(m.id)}<br>Conversation: ${esc(m.conversationId)}<br>Reply to: ${esc(m.replyTo || "Conversation start")}</div><div class="detail-label">Delivery history</div><div class="ack-row"><span>queued</span><span>${duration(m.timestamp - firstTime())}</span></div>${m.acknowledgements.map((a) => `<div class="ack-row"><span>${esc(a.state)}</span><span>${duration(a.timestamp - firstTime())}</span></div>`).join("")}${canAck ? `<div class="detail-label">Recipient actions</div>${m.status === "queued" ? `<button class="quiet" data-ack="delivered" data-message="${esc(m.id)}">Mark delivered</button>` : ""}${m.status === "delivered" ? `<button class="quiet" data-ack="processing" data-message="${esc(m.id)}">Mark processing</button>` : ""}${!m.expectsResponse && m.status !== "queued" ? `<button class="quiet" data-ack="answered" data-message="${esc(m.id)}">Mark handled</button>` : ""}<button class="quiet danger" data-ack="failed" data-message="${esc(m.id)}">Mark failed</button>` : ""}<div class="detail-label">Conversation · ${thread.length} messages</div>${thread.map((x) => `<button class="conversation-button" data-message-event="${esc(x.id)}"><strong>${esc(name(x.fromAgentId))} → ${esc(name(x.toAgentId))}</strong><br>${esc(x.content.slice(0, 200))}</button>`).join("")}${m.status !== "failed" ? compose(m.toAgentId, m) : ""}`;
    return;
  }
  const info = eventInfo(event);
  el.innerHTML = `<div class="eyebrow">${esc(info.kind.toUpperCase())} EVENT</div><h4>${esc(info.title)}</h4><div class="detail-meta">${duration(event.timestamp - firstTime())} into run · event ${event.seq}</div><div class="detail-label">Recorded content</div><div class="detail-body">${esc(info.text || "")}</div><div class="detail-label">Event payload</div><pre class="detail-meta">${esc(JSON.stringify(p, null, 2))}</pre>`;
}
function seek(index) {
  live = false;
  playing = false;
  cursor = Math.max(0, Math.min(events.length - 1, index));
  playbackTime = events[cursor]?.timestamp || firstTime();
  render();
}
$("run-list").addEventListener(
  "click",
  act(async (e) => {
    const b = e.target.closest("[data-run]");
    if (b) await selectRun(b.dataset.run);
  }),
);
$("graph").addEventListener("keydown", (e) => {
  if (
    (e.key === "Enter" || e.key === " ") &&
    e.target.matches("[data-edge-from]")
  ) {
    e.preventDefault();
    e.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
});
$("graph").addEventListener("click", (e) => {
  const a = e.target.closest("[data-agent]"),
    edge = e.target.closest("[data-edge-from]");
  if (a) {
    selection = { agentId: a.dataset.agent };
    render();
  }
  if (edge) {
    edgeFilter = { from: edge.dataset.edgeFrom, to: edge.dataset.edgeTo };
    agentFilter = null;
    renderTimeline();
  }
});
document.addEventListener(
  "click",
  act(async (e) => {
    const eventButton = e.target.closest("[data-event]");
    if (eventButton) {
      selection = { eventId: eventButton.dataset.event };
      render();
    }
    const messageButton = e.target.closest("[data-message-event]");
    if (messageButton) {
      selection = {
        eventId: events.find(
          (x) =>
            x.type === "message.sent" &&
            x.payload.id === messageButton.dataset.messageEvent,
        )?.id,
      };
      render();
    }
    const filter = e.target.closest("[data-filter-agent]");
    if (filter) {
      agentFilter =
        agentFilter === filter.dataset.filterAgent
          ? null
          : filter.dataset.filterAgent;
      edgeFilter = null;
      renderTimeline();
    }
    const ack = e.target.closest("[data-ack]");
    if (ack)
      await api(
        `/api/runs/${runId}/messages/${encodeURIComponent(ack.dataset.message)}/ack`,
        {
          state: ack.dataset.ack,
          actorId: state.messages[ack.dataset.message].toAgentId,
        },
      );
    if (e.target.closest("[data-close]")) e.target.closest("dialog").close();
  }),
);
$("search").addEventListener("input", renderTimeline);
$("event-kind").addEventListener("change", renderTimeline);
$("clear-filter").onclick = () => {
  agentFilter = null;
  edgeFilter = null;
  renderTimeline();
};
$("scrubber").oninput = (e) => seek(Number(e.target.value));
$("rewind").onclick = () => seek(0);
$("step-back").onclick = () => seek(cursor - 1);
$("step-next").onclick = () => seek(cursor + 1);
$("go-live").onclick = () => {
  playing = false;
  live = true;
  cursor = events.length - 1;
  render();
};
$("play").onclick = () => {
  if (playing) {
    playing = false;
    render();
    return;
  }
  if (cursor >= events.length - 1) cursor = 0;
  live = false;
  playing = true;
  playbackTime = events[cursor]?.timestamp || firstTime();
  render();
};
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now(),
    elapsed = now - lastTick;
  lastTick = now;
  if (!playing) return;
  playbackTime += elapsed * Number($("speed").value);
  while (
    cursor + 1 < events.length &&
    events[cursor + 1].timestamp <= playbackTime
  )
    cursor++;
  if (cursor >= events.length - 1) playing = false;
  render();
}, 100);
async function launchDemo() {
  $("start-demo").disabled = true;
  try {
    const run = await api("/api/demo", { mode: $("demo-mode").value });
    await refreshRuns();
    await selectRun(run.id);
    toast("Demo launched. Watch the team work.");
  } finally {
    $("start-demo").disabled = false;
  }
}
$("start-demo").onclick = act(launchDemo);
$("empty-demo").onclick = act(launchDemo);
$("new-run").onclick = () => $("run-dialog").showModal();
$("run-form").onsubmit = act(async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const run = await api("/api/runs", { title: form.get("title") });
  $("run-dialog").close();
  e.target.reset();
  await refreshRuns();
  await selectRun(run.id);
});
$("add-agent").onclick = () => {
  $("parent-select").innerHTML =
    '<option value="">Root agent</option>' +
    Object.values(state.agents)
      .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
      .join("");
  $("agent-dialog").showModal();
};
$("agent-form").onsubmit = act(async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  await api(`/api/runs/${runId}/agents`, {
    name: form.get("name"),
    role: form.get("role"),
    parentId: form.get("parentId") || null,
  });
  $("agent-dialog").close();
  e.target.reset();
});
document.addEventListener(
  "submit",
  act(async (e) => {
    if (e.target.id !== "message-form") return;
    e.preventDefault();
    const form = new FormData(e.target);
    const reply = state.messages[e.target.dataset.reply];
    const p = reply
      ? {
          fromAgentId: reply.toAgentId,
          toAgentId: reply.fromAgentId,
          conversationId: reply.conversationId,
          replyTo: reply.id,
          content: form.get("content"),
          expectsResponse: false,
        }
      : {
          fromAgentId: form.get("from"),
          toAgentId: e.target.dataset.to,
          content: form.get("content"),
          expectsResponse: form.has("expectsResponse"),
        };
    await api(`/api/runs/${runId}/messages`, p);
    e.target.querySelector("textarea").value = "";
    e.target.querySelector("textarea").blur();
    toast("Message recorded and queued for the recipient.");
  }),
);
$("export").onclick = () =>
  (window.location.href = `/api/runs/${runId}/export`);
$("finish").onclick = act(async () => {
  await api(`/api/runs/${runId}/finish`, { status: "completed" });
  toast("Run complete. Its history is ready for replay.");
});
$("cancel").onclick = act(async () => {
  await api(`/api/runs/${runId}/cancel`, {});
  toast("Run stopped. Its history is preserved.");
});
window.addEventListener("beforeunload", () => {
  source?.close();
  world?.dispose();
});
// Discover runs launched by CLI/adapters, including while the selected run is quiet.
setInterval(() => {
  if (!document.hidden)
    refreshRuns().catch(() => connection("Server unavailable"));
}, 5000);
await act(async () => {
  const config = await api("/api/config");
  if (config.enableCodex) {
    const option = $("demo-mode").querySelector('[value="codex"]');
    option.disabled = false;
    option.textContent = "Codex CLI · real agents";
  }
  await refreshRuns();
  const remembered = localStorage.getItem("relay-run");
  if (runs.length)
    await selectRun(
      runs.some((r) => r.id === remembered) ? remembered : runs[0].id,
    );
  else {
    $("empty").hidden = false;
    connection("Local server connected", true);
  }
})();
