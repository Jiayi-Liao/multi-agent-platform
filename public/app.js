import { project, terminalMessages } from "/state.js";
import { agentRecord, checkpoints, newestFirst } from "/history.js";
import { AgentWorld } from "/world.js";
import { createTransport } from "/transport.js";
const { t, locale, formatTimestamp } = window.RelayI18n;
// Capture authored UI before any runtime content can enter the DOM.
await window.RelayI18n.ready;
const transport = await createTransport(project);
const staticDemo = transport.staticDemo;
let codexEnabled = false;
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
const api = (path, data) => transport.request(path, data);
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
const name = (id) => state.agents[id]?.name || id || t("System");
function connection(text, ok = false) {
  connected = ok;
  $("connection").textContent = t(text);
  $("connection").dataset.copy = text;
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
            `<button class="run-item ${r.id === runId ? "selected" : ""}" data-run="${esc(r.id)}"><strong>${esc(r.title)}</strong><small><span>${esc(t(r.status).toUpperCase())} · ${t("{0} agents", r.agentCount)}</span><span>${new Date(r.startedAt).toLocaleDateString(locale(), { month: "short", day: "numeric" })}</span></small></button>`,
        )
        .join("")
    : `<div class="sidebar-empty">${t("No runs yet.")}<br>${t("Your history will appear here.")}</div>`;
}
async function selectRun(id) {
  const token = ++generation;
  source?.close();
  source = null;
  playing = false;
  selection = null;
  agentFilter = null;
  edgeFilter = null;
  profileTab = "history";
  $("agent-search").value = "";
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
  source = transport.subscribe(id, events.at(-1)?.seq || 0);
  source.onopen = () => {
    if (token === generation) {
      connection(
        staticDemo
          ? "Browser demo · synthetic events"
          : "Event stream connected",
        true,
      );
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
  $("empty").hidden = !!runId || page === "dashboard";
  $("workspace").hidden = !runId || page === "dashboard";
  if (!runId) return;
  state = project(visibleEvents());
  const run = state.run;
  $("run-title").textContent = run.title;
  $("run-id").textContent = run.id.slice(0, 8);
  $("run-badge").textContent = t(run.status).toUpperCase();
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
  $("stat-events").textContent = t("{0} recorded events", cursor + 1);
  $("view-mode").textContent = live
    ? staticDemo
      ? t("● DEMO")
      : t("● LIVE")
    : t("◷ REPLAY");
  $("view-mode").className = `live-tag ${live ? "" : "replay"}`;
  $("replay-label").textContent = live
    ? staticDemo
      ? t("Following synthetic events")
      : t("Following live events")
    : playing
      ? t("Playing recorded history")
      : t("Paused in history");
  $("scrubber").max = Math.max(0, events.length - 1);
  $("scrubber").value = cursor;
  $("cursor-label").textContent = t("EVENT {0} / {1}", cursor + 1, events.length);
  $("duration-label").textContent = duration(lastTime() - firstTime());
  $("play").textContent = playing ? "Ⅱ" : "▶";
  $("play").setAttribute(
    "aria-label",
    playing ? t("Pause replay") : t("Play replay"),
  );
  $("cancel").hidden = staticDemo || !live || run.status !== "running";
  $("finish").hidden =
    !live || run.status !== "running" || run.mode !== "custom";
  $("finish").disabled =
    messages.some(
      (m) => m.expectsResponse && !terminalMessages.has(m.status),
    ) || state.tools.some((t) => t.status === "running");
  $("add-agent").disabled = staticDemo || !live || run.status !== "running";
  $("crew-add").hidden = $("add-agent").disabled;
  $("context-state").textContent = live ? t(staticDemo ? "SYNTHETIC DEMO" : "FOLLOWING LIVE EVENTS") : t("HISTORY / EVENT {0}", cursor + 1);
  if (page !== "agents" && page !== "dashboard") renderGraph();
  renderMission();
  renderReplay();
  renderTimeline();
  renderInspector();
  if (page === "agents") renderAgents();
}
let page = ["overview", "replay", "agents", "dashboard"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
let profileTab = "history";
const pageCopy = {
  dashboard: ["Dashboard", "AGENT CHART GALLERY / DESIGN IN PROGRESS", 'Your agents.<br /><em>Their charts.</em>', "A planned space for finding and viewing the charts created by each agent.", "FIND AN AGENT. SEE ITS CHARTS."],
  overview: ["Overview", "MISSION CONTROL / MULTI-AGENT WORKSPACE", 'Small agents.<br /><em>Big picture.</em>', "A living world for your crew. Follow the handoffs, understand the work, and replay every turn.", "YOUR MISSION, AT A GLANCE"],
  replay: ["Replay studio", "REPLAY STUDIO / EVERY TURN, PRESERVED", 'Go back.<br /><em>See how it happened.</em>', "Step through the story. Each moment restores the crew, messages, and artifacts exactly as they were.", "ONE EVENT AT A TIME"],
  agents: ["Agent crew", "CREW DIRECTORY / ANY ROLE, ONE MISSION", 'Meet the minds.<br /><em>Trace the work.</em>', "Explore each agent’s activity, conversations, tools, and output—all in one continuous record.", "THE PEOPLE BEHIND THE PACKETS"],
};
function setPage(next) {
  const changed = page !== next;
  page = pageCopy[next] ? next : "overview";
  document.body.dataset.page = page;
  if (changed) window.scrollTo({ top: 0 });
  if (page === "agents" || page === "dashboard") playing = false;
  const copy = pageCopy[page];
  $("breadcrumb-view").textContent = t(copy[0]);
  $("page-eyebrow").textContent = t(copy[1]);
  $("page-title").innerHTML = t(copy[2]);
  $("page-description").textContent = t(copy[3]);
  $("context-label").textContent = t(copy[4]);
  document.querySelectorAll("[data-page-link]").forEach((link) => {
    if (link.dataset.pageLink === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  $("agent-page").hidden = page !== "agents";
  $("dashboard-page").hidden = page !== "dashboard";
  document.querySelector(".heading-actions").hidden = page === "dashboard";
  $("empty").hidden = !!runId || page === "dashboard";
  document.querySelector(".workspace-grid").hidden = page === "agents";
  render();
}
window.addEventListener("hashchange", () => {
  const next = location.hash.slice(1);
  if (pageCopy[next]) setPage(next);
});
setPage(page);
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
    if (page !== "replay") { location.hash = "replay"; setPage("replay"); }
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
function eventInfo(e, context = state) {
  const name = (id) => context.agents[id]?.name || id || t("System");
  const p = e.payload;
  if (e.type === "message.sent")
    return {
      title: `${name(p.fromAgentId)} → ${name(p.toAgentId)}`,
      text: p.content,
      kind: "message",
      symbol: "↗",
      agentId: p.fromAgentId,
      status: context.messages[p.id]?.status,
    };
  if (e.type === "message.acknowledged") {
    const m = context.messages[p.messageId];
    return {
      title: `${name(p.actorId)} · ${t(p.state)}`,
      text: m?.content || "",
      kind: "message",
      symbol: "✓",
      agentId: p.actorId,
    };
  }
  if (e.type === "agent.registered")
    return {
      title: t("{0} joined", p.name),
      text: `${t("Role")}: ${p.role}${p.parentId ? ` · ${t("Parent")}: ${name(p.parentId)}` : ""}`,
      kind: "agent",
      symbol: "+",
      agentId: p.id,
    };
  if (e.type === "agent.status")
    return {
      title: `${name(p.agentId)} · ${t(p.status)}`,
      text: p.activity,
      kind: "agent",
      symbol: "○",
      agentId: p.agentId,
    };
  if (e.type.startsWith("tool."))
    return {
      title: `${name(p.agentId)} · ${e.type === "tool.started" ? p.name : t("Tool finished")}`,
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
    title: e.type === "run.created" ? t("Run started") : t("Run {0}", t(p.status)),
    text: p.error || context.run.title,
    kind: "run",
    symbol: "◎",
  };
}
function renderTimeline() {
  const visible = visibleEvents(),
    journal = page === "replay" ? events : visible,
    recorded = page === "replay" ? project(events) : state,
    positions = new Map(events.map((e, i) => [e.id, i])),
    query = $("search").value.toLowerCase(),
    kind = $("event-kind").value;
  const filtered = newestFirst(journal).filter((e) => {
    const info = eventInfo(e, recorded),
      p = e.payload;
    const m =
      e.type === "message.acknowledged"
        ? recorded.messages[p.messageId]
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
          const future = positions.get(e.id) > cursor;
          const info = eventInfo(e, future ? recorded : state);
          return `<button class="event-row ${selection?.eventId === e.id ? "selected" : ""} ${future ? "future-event" : ""} ${events[cursor]?.id === e.id ? "current-event" : ""}" data-event="${esc(e.id)}" aria-label="${esc(`${duration(e.timestamp - firstTime())}. ${info.title}. ${t(info.kind)} ${t("event")}`)}" ${page === "replay" ? `data-seek="${positions.get(e.id)}"` : ""}><time class="event-time" title="${esc(formatTimestamp(e.timestamp))}">${duration(e.timestamp - firstTime())}</time><span class="event-symbol ${info.kind}">${info.symbol}</span><div class="event-main"><header>${esc(info.title)}<small>${esc(t(future ? "ahead" : info.status || info.kind))}</small></header><p>${esc(info.text || "")}</p></div></button>`;
        })
        .join("")
    : `<p class="no-events">${t("No events match this view.")}</p>`;
}
function robot(id, large = false) {
  return `<span class="bot-avatar ${large ? "large" : ""}" style="--crew-color:${color(id)}" aria-hidden="true"><svg viewBox="0 0 80 80" fill="none"><path d="M40 12v9m-5-12h10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><rect x="16" y="24" width="48" height="35" rx="11" fill="currentColor"/><rect x="22" y="31" width="36" height="20" rx="7" fill="#24392e"/><circle cx="32" cy="41" r="4" fill="#edf4d9"/><circle cx="48" cy="41" r="4" fill="#edf4d9"/><path d="M28 63h24M12 37v9m56-9v9" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg></span>`;
}
function artifactTime(item) {
  const date = new Date(item.timestamp);
  const valid = Number.isFinite(date.getTime());
  return `<div class="artifact-time"><time ${valid ? `datetime="${date.toISOString()}" title="${date.toISOString()}"` : ""}>${esc(formatTimestamp(item.timestamp))}</time><span>${duration(item.timestamp - firstTime())} · #${item.eventSeq ?? "—"}</span></div>`;
}
function chapterLabel({ event: e }) {
  const p = e.payload;
  return e.type === "run.created" ? t("Mission start")
    : e.type === "run.finished" ? t("Run {0}", t(p.status))
    : e.type === "agent.registered" ? t("{0} joins", p.name)
    : e.type === "artifact.created" ? `${p.name} · v${p.version || 1}`
    : t(p.replyTo ? "Reply recorded" : "New handoff");
}
function renderMission() {
  const artifact = newestFirst(state.artifacts)[0];
  const current = events[cursor], info = current && eventInfo(current);
  $("mission-summary").innerHTML = artifact
    ? `<h3>${esc(artifact.name)} <span>v${artifact.version || 1}</span></h3><p>${esc(artifact.content)}</p><span class="brief-meta">${t("OUTPUT BY")} ${esc(name(artifact.agentId))}</span>${artifactTime(artifact)}`
    : `<h3>${esc(info?.title || t("Waiting for the first handoff"))}</h3><p>${esc(info?.text || t("Your crew’s activity will appear as the mission unfolds."))}</p>`;
  $("crew-strip").innerHTML = Object.values(state.agents).map((a) => `<button data-profile-agent="${esc(a.id)}" class="crew-chip">${robot(a.id)}<span><strong>${esc(a.name)}</strong><small>${esc(a.role)}</small></span><span class="crew-dot ${esc(a.status)}" title="${esc(t(a.status))}"></span></button>`).join("");
}
function renderReplay() {
  const event = events[cursor];
  if (!event) return;
  const info = eventInfo(event);
  $("replay-moment").innerHTML = `<div class="moment-time"><strong>${duration(event.timestamp - firstTime())}</strong><span>${t("EVENT {0} / {1}", String(cursor + 1).padStart(2, "0"), events.length)}</span></div><div class="moment-story"><span class="eyebrow">${esc(t(info.kind).toUpperCase())} / ${playing ? t("PLAYING") : live ? t("LATEST STATE") : t("PAUSED")}</span><h4>${esc(info.title)}</h4><p>${esc(info.text || t("The mission is taking shape."))}</p></div><span class="moment-symbol" aria-hidden="true">${info.symbol}</span>`;
  $("checkpoints").innerHTML = checkpoints(events).reverse().map((c) => `<button data-seek="${c.index}" class="checkpoint ${c.index <= cursor ? "visited" : ""} ${c.index === cursor ? "active" : ""}" ${c.index === cursor ? 'aria-current="step"' : ""}><span>${duration(c.event.timestamp - firstTime())}</span><strong>${esc(chapterLabel(c))}</strong><small>#${c.index + 1}</small></button>`).join("");
}
function renderAgents() {
  const agents = Object.values(state.agents), query = $("agent-search").value.trim().toLowerCase();
  $("directory-count").textContent = t("{0} agents at this point", agents.length);
  const agent = state.agents[selection?.agentId] || agents[0];
  $("agent-directory").innerHTML = agents.filter((a) => `${a.name} ${a.role}`.toLowerCase().includes(query)).map((a) => `<button class="crew-card ${a.id === agent?.id ? "selected" : ""}" data-profile-agent="${esc(a.id)}" aria-pressed="${a.id === agent?.id}">${robot(a.id)}<span><strong>${esc(a.name)}</strong><small>${esc(a.role)}</small></span><span class="crew-dot ${esc(a.status)}" title="${esc(t(a.status))}"></span></button>`).join("") || `<p class="no-events">${t("No agents match this view.")}</p>`;
  const el = $("agent-profile");
  if (el.contains(document.activeElement) && document.activeElement.matches("input,textarea,select")) return;
  if (!agent) { el.innerHTML = `<div class="profile-empty"><span>◎</span><h3>${t("The crew hasn’t arrived yet.")}</h3><p>${t("Move forward in replay to see agents join this mission.")}</p><a href="#replay" data-page-link="replay">${t("Open replay studio ↗")}</a></div>`; return; }
  const a = agent, record = agentRecord(state, visibleEvents(), a.id);
  const positions = new Map(events.map((e, i) => [e.id, i]));
  const sends = new Map(events.flatMap((e, i) => e.type === "message.sent" ? [[e.payload.id, i]] : []));
  const metrics = [[record.sent.length, "SENT"], [record.received.length, "RECEIVED"], [record.artifacts.length, "ARTIFACTS"], [record.tools.length, "TOOLS"]];
  const tabs = [["history", "History", record.history.length], ["messages", "Messages", record.messages.length], ["artifacts", "Artifacts", record.artifacts.length], ["tools", "Tools", record.tools.length]];
  let content;
  if (profileTab === "messages") content = record.messages.map((m) => `<button class="profile-message" data-seek="${sends.get(m.id)}"><header><strong>${esc(name(m.fromAgentId))} <span>→</span> ${esc(name(m.toAgentId))}</strong><span class="detail-tag">${esc(t(m.status))}</span></header><p>${esc(m.content)}</p><small>${duration(m.timestamp - firstTime())} · ${t(m.fromAgentId === a.id ? "OUTGOING" : "INCOMING")} · ${t("Open in replay ↗")}</small></button>`).join("");
  else if (profileTab === "artifacts") content = record.artifacts.map((x) => `<div class="profile-output"><span class="eyebrow">${t("ARTIFACT / VERSION {0}", x.version || 1)}</span><h3>${esc(x.name)}</h3><p>${esc(x.content)}</p>${artifactTime(x)}</div>`).join("");
  else if (profileTab === "tools") content = record.tools.map((tool) => `<div class="profile-output"><span class="eyebrow">${t("TOOL")} / ${esc(t(tool.status).toUpperCase())}</span><h3>${esc(tool.name)}</h3>${artifactTime({ ...tool, timestamp: tool.finishedAt ?? tool.timestamp })}<div class="detail-label">${t("Input")}</div><pre>${esc(tool.input || t("No input recorded"))}</pre><div class="detail-label">${t("Output")}</div><pre>${esc(tool.error || tool.output || t("No output at this point"))}</pre></div>`).join("");
  else content = record.history.map((e) => { const info = eventInfo(e); return `<button class="profile-history-row" data-seek="${positions.get(e.id)}"><time>${duration(e.timestamp - firstTime())}</time><span class="history-dot ${info.kind}"></span><span><strong>${esc(info.title)}</strong><p>${esc(info.text || "")}</p></span><small>#${e.seq} ↗</small></button>`; }).join("");
  el.innerHTML = `<div class="profile-cover"><span class="eyebrow">${t("CREWMATE /")} ${esc(a.role.toUpperCase())}</span><span class="profile-number">${String(agents.indexOf(a) + 1).padStart(2, "0")}</span></div><div class="profile-identity">${robot(a.id, true)}<div><h2>${esc(a.name)}</h2><span class="profile-status"><i class="crew-dot ${esc(a.status)}"></i>${esc(t(a.status))} · ${esc(a.role)}</span></div><button class="quiet" data-seek="${events.findIndex((e) => e.type === "agent.registered" && e.payload.id === a.id)}">${t("First appearance \u2197")}</button></div><div class="profile-activity"><span class="eyebrow">${t("CURRENT ACTIVITY")}</span><p>${esc(a.activity || t("Ready for the next handoff."))}</p><div class="profile-meta"><span>${t("Parent")} <strong>${esc(a.parentId ? name(a.parentId) : t("Root agent"))}</strong></span><span class="mono">${esc(a.id)}</span></div></div><div class="profile-metrics">${metrics.map(([n, label]) => `<div><strong>${String(n).padStart(2, "0")}</strong><span>${t(label)}</span></div>`).join("")}</div><nav class="profile-tabs" aria-label="${t("Agent records")}">${tabs.map(([id, label, count]) => `<button data-profile-tab="${id}" aria-label="${t(label)} (${count})" aria-pressed="${profileTab === id}">${t(label)}<span>${count}</span></button>`).join("")}</nav><div class="profile-records">${content || `<div class="profile-empty"><h3>${t("No {0} at this point.", t(profileTab))}</h3><p>${t("This view follows the replay clock. New records appear as the mission progresses.")}</p></div>`}</div>${compose(a.id)}`;
}

function compose(agentId, original = null) {
  if (staticDemo || !live || state.run.status !== "running") return "";
  const peers = Object.values(state.agents).filter((a) => a.id !== agentId);
  if (!peers.length)
    return `<p class="inspector-intro">${t("Add another agent to exchange messages.")}</p>`;
  return `<form class="message-compose" id="message-form" data-to="${esc(agentId)}" ${original ? `data-reply="${esc(original.id)}"` : ""}><div class="eyebrow">${original ? t("REPLY IN THIS CONVERSATION") : t("SEND A MESSAGE")}</div>${original ? `<div class="detail-meta">${esc(name(agentId))} → ${esc(name(original.fromAgentId))}</div>` : `<label>${t("From")}<select name="from">${peers.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}</select></label>`}<label>${t("Message")}<textarea name="content" required maxlength="32000" placeholder="${original ? t("Respond to this message…") : t("Assign work or share context…")}"></textarea></label>${original ? "" : `<label><input type="checkbox" name="expectsResponse" checked> ${t("Expect a reply")}</label>`}<button class="primary">${original ? t("Send reply") : t("Send message")} ↗</button></form>`;
}
function renderInspector() {
  if (
    $("inspector-content").contains(document.activeElement) &&
    ["TEXTAREA", "INPUT", "SELECT"].includes(document.activeElement.tagName)
  )
    return;
  const el = $("inspector-content");
  if (page === "agents") { el.innerHTML = ""; return; }
  if (selection?.agentId && state.agents[selection.agentId]) {
    const a = state.agents[selection.agentId];
    const history = agentRecord(state, visibleEvents(), a.id).history;
    el.innerHTML = `<div class="eyebrow">${t("AGENT DETAILS")}</div><h4>${esc(a.name)}</h4><span class="detail-tag">${esc(a.role)} · ${esc(t(a.status))}</span><div class="detail-label">${t("Current activity")}</div><div class="detail-body">${esc(a.activity || t("Ready for work"))}</div><div class="detail-label">${t("Identity")}</div><div class="detail-meta">${esc(a.id)}<br>${t("Parent:")} ${esc(a.parentId ? name(a.parentId) : t("Root agent"))}</div><a class="profile-link" href="#agents" data-profile-agent="${esc(a.id)}">${t("Open full agent profile \u2197")}</a><div class="detail-label">${t("Agent history · {0} events", history.length)}</div>${history.map((e) => `<button class="conversation-button" data-event="${esc(e.id)}">${esc(eventInfo(e).title)}<br><span class="muted">${esc((eventInfo(e).text || "").slice(0, 140))}</span></button>`).join("")}${compose(a.id)}`;
    return;
  }
  const event = visibleEvents().find((e) => e.id === selection?.eventId);
  if (!event) {
    el.innerHTML = `<div class="inspector-intro"><span class="big-arrow">↖</span>${t("Select an agent to explore its history.")}<br>${t("Select a message to follow its conversation.")}<br>${t("Move through playback to inspect an earlier state.")}</div><div class="detail-label">${t("Run summary")}</div><div class="detail-meta">${esc(state.run.mode)} ${t("runtime")}<br>${events.length} ${staticDemo ? t("synthetic events in browser") : t("events saved locally")}<br>${connected ? (staticDemo ? t("Synthetic browser stream connected") : t("Live event stream connected")) : t("Connecting to event stream")}</div>${state.run.error ? `<div class="detail-label">${t("Run stopped")}</div><div class="detail-body">${esc(state.run.error)}</div>` : ""}<div class="detail-label">${t("Artifacts at this point")}</div>${newestFirst(state.artifacts).map((a) => `<div class="artifact-card"><strong>${esc(a.name)} · v${a.version || 1}</strong>${artifactTime(a)}<p>${esc(a.content)}</p></div>`).join("")}`;
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
    const thread = newestFirst(Object.values(state.messages)).filter(
      (x) => x.conversationId === m.conversationId,
    );
    const canAck =
      !staticDemo &&
      live &&
      state.run.status === "running" &&
      !terminalMessages.has(m.status);
    el.innerHTML = `<div class="eyebrow">${t("COMMUNICATION")}</div><h4>${esc(name(m.fromAgentId))} → ${esc(name(m.toAgentId))}</h4><span class="detail-tag">${esc(m.kind)} · ${esc(t(m.status))}</span><div class="detail-label">${t("Message")}</div><div class="detail-body">${esc(m.content)}</div><div class="detail-label">${t("Correlation")}</div><div class="detail-meta">${t("Message:")} ${esc(m.id)}<br>${t("Conversation:")} ${esc(m.conversationId)}<br>${t("Reply to:")} ${esc(m.replyTo || t("Conversation start"))}</div><div class="detail-label">${t("Delivery history")}</div>${newestFirst([{ state: "queued", timestamp: m.timestamp, eventSeq: m.eventSeq }, ...m.acknowledgements]).map((a) => `<div class="ack-row"><span>${esc(t(a.state))}</span><span>${duration(a.timestamp - firstTime())}</span></div>`).join("")}${canAck ? `<div class="detail-label">${t("Recipient actions")}</div>${m.status === "queued" ? `<button class="quiet" data-ack="delivered" data-message="${esc(m.id)}">${t("Mark delivered")}</button>` : ""}${m.status === "delivered" ? `<button class="quiet" data-ack="processing" data-message="${esc(m.id)}">${t("Mark processing")}</button>` : ""}${!m.expectsResponse && m.status !== "queued" ? `<button class="quiet" data-ack="answered" data-message="${esc(m.id)}">${t("Mark handled")}</button>` : ""}<button class="quiet danger" data-ack="failed" data-message="${esc(m.id)}">${t("Mark failed")}</button>` : ""}<div class="detail-label">${t("Conversation · {0} messages", thread.length)}</div>${thread.map((x) => `<button class="conversation-button" data-message-event="${esc(x.id)}"><strong>${esc(name(x.fromAgentId))} → ${esc(name(x.toAgentId))}</strong><br>${esc(x.content.slice(0, 200))}</button>`).join("")}${m.status !== "failed" ? compose(m.toAgentId, m) : ""}`;
    return;
  }
  const info = eventInfo(event);
  el.innerHTML = `<div class="eyebrow">${esc(t(info.kind).toUpperCase())} ${t("EVENT")}</div><h4>${esc(info.title)}</h4><div class="detail-meta">${artifactTime({ timestamp: event.timestamp, eventSeq: event.seq })}</div><div class="detail-label">${t("Recorded content")}</div><div class="detail-body">${esc(info.text || "")}</div><div class="detail-label">${t("Event payload")}</div><pre class="detail-meta">${esc(JSON.stringify(p, null, 2))}</pre>`;
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
    if (page !== "replay") { location.hash = "replay"; setPage("replay"); }
    renderTimeline();
  }
});
document.addEventListener(
  "click",
  act(async (e) => {
    const pageLink = e.target.closest("[data-page-link]");
    if (pageLink) {
      e.preventDefault();
      if (location.hash === pageLink.hash) setPage(pageLink.dataset.pageLink);
      else location.hash = pageLink.dataset.pageLink;
    }
    const profile = e.target.closest("[data-profile-agent]");
    if (profile) {
      selection = { agentId: profile.dataset.profileAgent };
      profileTab = "history";
      if (page === "agents") render();
      else { location.hash = "agents"; setPage("agents"); }
    }
    const tab = e.target.closest("[data-profile-tab]");
    if (tab) { profileTab = tab.dataset.profileTab; renderAgents(); }
    const seekButton = e.target.closest("[data-seek]");
    if (seekButton) {
      selection = { eventId: events[Number(seekButton.dataset.seek)]?.id };
      if (page !== "replay") { location.hash = "replay"; setPage("replay"); }
      seek(Number(seekButton.dataset.seek));
      $("replay-moment").scrollIntoView({ block: "center" });
    }
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
$("agent-search").addEventListener("input", renderAgents);
$("search").addEventListener("input", renderTimeline);
document.addEventListener("keydown", (e) => {
  if (page !== "replay" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest("input, textarea, select, [contenteditable]")) return;
  if (e.code === "Space" && !e.target.closest("button")) { e.preventDefault(); $("play").click(); }
  if (e.key === "ArrowLeft") { e.preventDefault(); seek(cursor - 1); }
  if (e.key === "ArrowRight") { e.preventDefault(); seek(cursor + 1); }
});
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
    toast(t("Demo launched. Watch the team work."));
  } finally {
    $("start-demo").disabled = false;
  }
}
$("start-demo").onclick = act(launchDemo);
$("empty-demo").onclick = act(launchDemo);
$("new-run").onclick = () =>
  staticDemo
    ? window.location.assign("./api.html#setup")
    : $("run-dialog").showModal();
$("run-form").onsubmit = act(async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const run = await api("/api/runs", { title: form.get("title") });
  $("run-dialog").close();
  e.target.reset();
  await refreshRuns();
  await selectRun(run.id);
});
$("crew-add").onclick = () => $("add-agent").click();
$("add-agent").onclick = () => {
  $("parent-select").innerHTML =
    `<option value="">${t("Root agent")}</option>` +
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
    toast(t("Message recorded and queued for the recipient."));
  }),
);
$("export").onclick = act(async () => {
  if (!staticDemo) {
    window.location.href = `/api/runs/${runId}/export`;
    return;
  }
  const data = await api(`/api/runs/${runId}/export`);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `synthetic-run-${runId}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("finish").onclick = act(async () => {
  await api(`/api/runs/${runId}/finish`, { status: "completed" });
  toast(t("Run complete. Its history is ready for replay."));
});
$("cancel").onclick = act(async () => {
  await api(`/api/runs/${runId}/cancel`, {});
  toast(t("Run stopped. Its history is preserved."));
});
window.addEventListener("beforeunload", () => {
  source?.close();
  world?.dispose();
  transport.close();
});
// Discover runs launched by CLI/adapters, including while the selected run is quiet.
setInterval(() => {
  if (!document.hidden)
    refreshRuns().catch(() => connection("Server unavailable"));
}, 5000);
function applyModeCopy() {
  document.querySelector(".plan-footer a").href = locale() === "zh-CN" ? "https://github.com/Jiayi-Liao/multi-agent-platform/blob/main/artifacts/dashboard-plan.zh-CN.md" : "https://github.com/Jiayi-Liao/multi-agent-platform/blob/main/artifacts/dashboard-plan.md";

  const codex = $("demo-mode").querySelector('[value="codex"]');
  if (codexEnabled && codex) codex.textContent = t("Codex CLI · real agents");
  if (staticDemo) {
    $("new-run").textContent = t("API & local setup ↗");
    $("demo-mode").querySelector('[value="codex"]')?.remove();
    $("demo-mode").querySelector("option").textContent =
      t("Synthetic browser demo");
    document.querySelector(".workspace-label span").textContent = t("DEMO");
    document.querySelector(".key-hint").textContent = t("PUBLIC PREVIEW");
    document.querySelector(".sidebar-footer small").textContent =
      t("Synthetic samples · browser memory");
    document.querySelector(
      ".page-footer",
    ).firstElementChild.nextElementSibling.textContent =
      t("Demo events stay in your browser. Run real agents locally.");
    $("pages-note").hidden = false;
    $("go-live").textContent = t("Follow demo ↗");
  }
}
window.addEventListener("relay:languagechange", () => {
  applyModeCopy();
  connection($("connection").dataset.copy || "Connecting", connected);
  renderRuns();
  setPage(page);
});
await act(async () => {
  applyModeCopy();
  const config = await api("/api/config");
  codexEnabled = config.enableCodex;
  if (config.enableCodex) {
    const option = $("demo-mode").querySelector('[value="codex"]');
    option.disabled = false;
    option.textContent = t("Codex CLI · real agents");
  }
  await refreshRuns();
  const remembered = localStorage.getItem("relay-run");
  if (runs.length)
    await selectRun(
      runs.some((r) => r.id === remembered)
        ? remembered
        : staticDemo
          ? "sample-rewrite"
          : runs[0].id,
    );
  else {
    $("empty").hidden = page === "dashboard";
    connection("Local server connected", true);
  }
})();
