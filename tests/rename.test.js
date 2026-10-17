import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { project } from "../src/state.js";
import { agentRecord, checkpoints, replayClock } from "../src/history.js";
import { PlatformClient } from "../src/client.js";
import { createApp } from "../src/server.js";
import { StaticDemo } from "../public/static-demo.js";
import { syntheticSamples } from "../scripts/build-pages.js";

function fixture(t) {
  const store = new Store();
  t.after(() => store.close());
  const run = store.createRun();
  store.registerAgent(run.id, { id: "a", name: "A", role: "writing" });
  store.registerAgent(run.id, { id: "b", name: "B", role: "review", parentId: "a" });
  return { store, id: run.id };
}

test("rename preserves identity, hierarchy, routing and HTML ownership; replay retains earlier names", (t) => {
  const { store, id } = fixture(t);
  const chart = store.chart(id, { agentId: "a", name: "Loss", html: "<h1>Loss</h1>" });
  const before = store.events(id);
  const result = store.renameAgent(id, "a", "  主笔 <Lead>  ");
  assert.equal(result.name, "主笔 <Lead>");
  assert.equal(result.id, "a");
  assert.equal(result.role, "writing");
  const events = store.events(id), state = project(events);
  assert.equal(project(before).agents.a.name, "A");
  assert.equal(state.agents.a.name, "主笔 <Lead>");
  assert.equal(state.agents.b.parentId, "a");
  assert.equal(state.artifacts[0].agentId, "a");
  assert.equal(store.chartDocument(id, chart.html.id).source, "<h1>Loss</h1>");
  const msg = store.send(id, { fromAgentId: "b", toAgentId: "a", content: "Review", expectsResponse: false });
  assert.equal(store.inbox(id, "a")[0].id, msg.id);
  const rename = events.at(-1);
  assert.equal(rename.type, "agent.renamed");
  assert.deepEqual(rename.payload, { agentId: "a", previousName: "A", name: "主笔 <Lead>" });
  assert.equal(agentRecord(state, events, "a").history[0].id, rename.id);
  assert.equal(checkpoints(events).at(-1).event.id, rename.id);
  assert.equal(agentRecord(state, events, "b").history.some((e) => e.id === rename.id), false);
});

test("rename validates names and run membership; duplicate display names are allowed and identical retries are no-ops", (t) => {
  const { store, id } = fixture(t), count = store.events(id).length;
  for (const name of [undefined, null, 12, "", "   ", "x".repeat(101)])
    assert.throws(() => store.renameAgent(id, "a", name), /name must/);
  for (const agentId of ["missing", "__proto__", "constructor", "toString"])
    assert.throws(() => store.renameAgent(id, agentId, "New"), (e) => e.status === 404);
  const other = store.createRun();
  store.registerAgent(other.id, { id: "outside", name: "Other", role: "extra" });
  assert.throws(() => store.renameAgent(id, "outside", "New"), (e) => e.status === 404);
  assert.throws(() => store.renameAgent("missing", "a", "New"), (e) => e.status === 404);
  store.renameAgent(id, "a", " A ");
  assert.equal(store.events(id).length, count);
  store.renameAgent(id, "a", "B");
  assert.equal(store.snapshot(id).agents.a.name, store.snapshot(id).agents.b.name);
  assert.equal(store.events(id).length, count + 1);
});

test("completed, failed and cancelled runs allow metadata renames without reopening execution", (t) => {
  const { store, id } = fixture(t);
  for (const status of ["completed", "failed", "cancelled"]) {
    const runId = status === "completed" ? id : store.createRun().id;
    if (runId !== id) store.registerAgent(runId, { id: "a", name: "A", role: "worker" });
    store.finish(runId, status);
    const before = store.snapshot(runId);
    store.renameAgent(runId, "a", "Renamed");
    const after = store.snapshot(runId);
    assert.deepEqual(after.run, before.run);
    assert.equal(after.agents.a.status, before.agents.a.status);
    assert.throws(() => store.status(runId, "a", "working"), /read-only/);
    assert.throws(() => store.chart(runId, { agentId: "a", name: "X", html: "<p>X" }), /read-only/);
  }
});

test("name changes survive SQLite restart and preserve the append-only history", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-rename-")), file = join(dir, "events.sqlite");
  let store;
  try {
    store = new Store(file);
    const run = store.createRun();
    store.registerAgent(run.id, { id: "a", name: "A", role: "writer" });
    store.finish(run.id);
    store.renameAgent(run.id, "a", "First");
    store.renameAgent(run.id, "a", "Second");
    const before = store.events(run.id);
    store.close();
    store = new Store(file);
    assert.deepEqual(store.events(run.id), before);
    assert.equal(store.snapshot(run.id).agents.a.name, "Second");
    assert.equal(project(before.slice(0, -1)).agents.a.name, "First");
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("HTTP and SDK rename encoded agent IDs and stream committed events, including after finish", async (t) => {
  const app = createApp({ store: new Store() });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  const client = new PlatformClient({ baseUrl, agentId: "writer / 中文" });
  const run = await client.createRun("Rename integration");
  await client.register({ name: "Writer", role: "writing" });
  await client.finish();
  const last = app.store.events(run.id).at(-1).seq;
  const stream = await fetch(`${baseUrl}/api/runs/${run.id}/stream?after=${last}`);
  const reader = stream.body.getReader();
  t.after(() => reader.cancel());
  assert.equal((await client.rename("Writing lead")).id, client.agentId);
  let text = "";
  while (!text.includes("agent.renamed")) text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /Writing lead/);
  const exported = await client.request(client.path("/export"));
  assert.equal(project(exported.events).agents[client.agentId].name, "Writing lead");
  assert.equal(exported.run.status, "completed");
  const invalid = await fetch(baseUrl + client.path(`/agents/${encodeURIComponent(client.agentId)}/rename`), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: " " }),
  });
  assert.equal(invalid.status, 400);
  const missing = await fetch(baseUrl + client.path("/agents/missing/rename"), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "X" }),
  });
  assert.equal(missing.status, 404);
});

test("browser demo renames stream with unique ordered sequences during playback and never alter templates", async () => {
  const scheduled = [], samples = await syntheticSamples();
  const demo = new StaticDemo(samples, project, {
    now: () => 1000000, schedule: (fn) => { scheduled.push(fn); return scheduled.length; }, cancel: () => {},
  });
  const run = await demo.request("/api/demo/charts", {}), received = [];
  const source = demo.subscribe(run.id, 4);
  source.onmessage = (event) => received.push(JSON.parse(event.data));
  const rename = (runId, name, agentId = "trainer") => demo.request(`/api/runs/${runId}/agents/${agentId}/rename`, { name });
  await rename(run.id, "训练师");
  await rename(run.id, "训练师"); // retry does not duplicate an event
  while (scheduled.length) scheduled.shift()();
  const result = await demo.request(`/api/runs/${run.id}`);
  assert.equal(result.run.status, "completed");
  assert.equal(project(result.events).agents.trainer.name, "训练师");
  assert.equal(result.events.filter((e) => e.type === "agent.renamed").length, 1);
  assert.ok(result.events.every((e, index) => e.seq === index + 1));
  assert.ok(result.events.every((e, index) => !index || e.timestamp >= result.events[index - 1].timestamp));
  assert.equal(new Set(received.map((e) => e.seq)).size, received.length);
  await rename(run.id, "Different");
  const another = await demo.request("/api/demo/charts", {});
  assert.equal(project((await demo.request(`/api/runs/${another.id}`)).events).agents.trainer.name, "Trainer");
  for (const name of [null, " ", "x".repeat(101)]) await assert.rejects(rename(run.id, name), /name must/);
  await assert.rejects(rename(run.id, "X", "__proto__"), /not found/);
  const reloaded = new StaticDemo(samples, project, { schedule: () => 0, cancel: () => {} });
  assert.deepEqual(await reloaded.request("/api/runs"), []);
  const fresh = await reloaded.request("/api/demo/charts", {});
  assert.equal(project((await reloaded.request(`/api/runs/${fresh.id}`)).events).agents.trainer.name, "Trainer");
  reloaded.close(); demo.close();
});

test("replay skips long post-run rename gaps, while ordinary execution timing is preserved", () => {
  const events = [
    { type: "run.created", timestamp: 0 }, { type: "message.sent", timestamp: 1000 },
    { type: "run.finished", timestamp: 2000 }, { type: "agent.renamed", timestamp: 86400000 },
    { type: "agent.renamed", timestamp: 172800000 },
  ];
  assert.equal(replayClock(events, 0, 500), 500);
  assert.equal(replayClock(events, 1, 1500), 1500);
  assert.equal(replayClock(events, 1, 2050), 86400000);
  assert.equal(replayClock(events, 3, 86400001), 172800000);
  assert.equal(replayClock(events, 4, 172800001), 172800001);
  assert.equal(replayClock(events.slice(0, 2), 0, 100), 100);
});
