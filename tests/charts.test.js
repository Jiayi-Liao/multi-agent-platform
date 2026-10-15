import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { project } from "../src/state.js";
import { newestFirst } from "../src/history.js";
import { createApp } from "../src/server.js";
import { PlatformClient } from "../src/client.js";
import { runChartDemo } from "../src/chart-demo.js";
import { MAX_HTML_BYTES, CHART_CSP } from "../src/chart-documents.js";

const trainerHtml = await readFile(new URL("../public/demo-charts/training-loss-first.html", import.meta.url), "utf8");
const evaluatorHtml = await readFile(new URL("../public/demo-charts/evaluation-comparison.html", import.meta.url), "utf8");
function fixture(path = ":memory:") {
  const store = new Store(path), run = store.createRun({ title: "Agent HTML gallery" });
  store.registerAgent(run.id, { id: "trainer", name: "Trainer", role: "anything" });
  store.registerAgent(run.id, { id: "evaluator", name: "Evaluator", role: "evaluation" });
  return { store, id: run.id };
}
const upload = (agentId, name = "Dashboard", html = trainerHtml) => ({ agentId, name, html });

test("HTML submission validates source, size, title, version and registered owner", () => {
  const { store, id } = fixture();
  try {
    for (const html of [undefined, null, 123, "", "   "]) assert.throws(() => store.chart(id, { ...upload("trainer"), html }), /HTML document string/);
    assert.throws(() => store.chart(id, upload("trainer", "Chart", "界".repeat(MAX_HTML_BYTES / 3 + 1))), (e) => e.status === 413);
    assert.throws(() => store.chart(id, upload("missing")), /Agent not found/);
    assert.throws(() => store.chart(id, upload("constructor")), /Agent not found/);
    assert.throws(() => store.chart(id, upload("trainer", "")), /chart name/);
    assert.throws(() => store.chart(id, { ...upload("trainer"), version: 0 }), /version/);
    const result = store.chart(id, upload("trainer"));
    assert.equal(result.html.byteLength, Buffer.byteLength(trainerHtml));
    assert.equal(store.chartDocument(id, result.id).source, trainerHtml);
    assert.equal(JSON.stringify(store.events(id)).includes("<script>"), false);
  } finally { store.close(); }
});

test("HTML charts retain ownership, source and cursor visibility through restart", async () => {
  const folder = await mkdtemp(join(tmpdir(), "relay-html-")), path = join(folder, "history.sqlite");
  let store;
  try {
    const f = fixture(path); store = f.store;
    const a = store.chart(f.id, upload("trainer", "First"));
    const early = store.events(f.id);
    const b = store.chart(f.id, upload("evaluator", "Comparison", evaluatorHtml));
    store.chart(f.id, { ...upload("trainer", "Latest"), version: 2 });
    assert.deepEqual(newestFirst(store.snapshot(f.id).artifacts.filter((a) => a.agentId === "trainer")).map((a) => a.name), ["Latest", "First"]);
    assert.deepEqual(project(early).artifacts.map((a) => a.id), [a.id]);
    assert.throws(() => store.record(f.id, "artifact.created", { agentId: "trainer", name: "Forge", content: "x", html: { id: a.id } }), /charts endpoint/);
    store.record(f.id, "artifact.created", { agentId: "trainer", name: "Text still works", content: "Text" });
    store.finish(f.id);
    assert.throws(() => store.chart(f.id, upload("trainer")), /read-only/);
    store.close(); store = new Store(path);
    assert.equal(store.snapshot(f.id).artifacts.length, 4);
    assert.equal(store.chartDocument(f.id, a.id).source, trainerHtml);
    assert.equal(store.chartDocument(f.id, b.id).source, evaluatorHtml);
    const other = store.createRun({ title: "Other" });
    assert.throws(() => store.chartDocument(other.id, a.id), /not found/);
  } finally { store?.close(); await rm(folder, { recursive: true, force: true }); }
});

test("HTML file and artifact event commit atomically without orphan documents", () => {
  const { store, id } = fixture();
  try {
    const before = store.events(id).length;
    store.db.exec(`CREATE TRIGGER fail_chart BEFORE INSERT ON events WHEN NEW.type='artifact.created' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`);
    assert.throws(() => store.chart(id, upload("trainer")), /simulated failure/);
    assert.equal(store.events(id).length, before);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM chart_documents").get().n, 0);
  } finally { store.close(); }
});

test("two SDK agents submit HTML over HTTP; content is scoped and sandboxed even when opened directly", async (t) => {
  const app = createApp({ store: new Store() });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  const trainer = new PlatformClient({ baseUrl, agentId: "trainer" });
  const run = await trainer.createRun("SDK HTML dashboards");
  await trainer.register({ name: "Trainer", role: "training" });
  const evaluator = new PlatformClient({ baseUrl, runId: run.id, agentId: "evaluator" });
  await evaluator.register({ name: "Evaluator", role: "evaluation" });
  const stream = await fetch(`${baseUrl}/api/runs/${run.id}/stream?after=0`), reader = stream.body.getReader();
  t.after(() => reader.cancel());
  const first = await trainer.chart("Loss", trainerHtml);
  const second = await evaluator.chart("Comparison", evaluatorHtml);
  await trainer.chart("Loss latest", trainerHtml, { version: 2 });
  assert.equal(first.agentId, "trainer"); assert.equal(second.agentId, "evaluator");
  let streamText = "";
  while (!streamText.includes(first.html.id)) streamText += new TextDecoder().decode((await reader.read()).value);
  assert.match(streamText, /artifact.created/);
  const unicodeHtml = "<!doctype html><p>训练看板：你好</p>";
  const encoded = Buffer.from(JSON.stringify(upload("trainer", "Unicode", unicodeHtml)));
  const split = encoded.indexOf(Buffer.from("看板")) + 1;
  const body = new ReadableStream({ async start(controller) {
    controller.enqueue(encoded.subarray(0, split));
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.enqueue(encoded.subarray(split)); controller.close();
  }});
  const unicodeResponse = await fetch(`${baseUrl}/api/runs/${run.id}/charts`, { method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half" });
  assert.equal(unicodeResponse.status, 201);
  const unicodeChart = await unicodeResponse.json();
  assert.equal(app.store.chartDocument(run.id, unicodeChart.id).source, unicodeHtml);
  const url = `${baseUrl}/api/runs/${run.id}/charts/${first.html.id}/html`;
  const response = await fetch(url);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), CHART_CSP);
  assert.match(CHART_CSP, /sandbox allow-scripts;/);
  assert.ok(!CHART_CSP.includes("allow-same-origin"));
  assert.match(CHART_CSP, /connect-src 'none'/);
  assert.equal(await response.text(), trainerHtml);
  assert.match((await fetch(url + "?download=1")).headers.get("content-disposition"), /^attachment;.*\.html/);
  const other = await new PlatformClient({ baseUrl }).createRun("Other run");
  assert.equal((await fetch(url.replace(run.id, other.id))).status, 404);
  const requestUrl = `${baseUrl}/api/runs/${run.id}/charts`;
  const post = (body, headers = {}) => fetch(requestUrl, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ ...upload("trainer"), html: null })).status, 400);
  assert.equal((await post(upload("trainer"), { Origin: "https://example.com" })).status, 403);
  assert.equal((await post(upload("trainer", "Too large", "x".repeat(MAX_HTML_BYTES + 1)))).status, 413);
  await trainer.finish();
  await assert.rejects(evaluator.chart("After finish", evaluatorHtml), /read-only/);
  assert.equal((await fetch(url)).status, 200);
  const exported = await (await fetch(`${baseUrl}/api/runs/${run.id}/export`)).json();
  assert.equal(exported.events.filter((e) => e.payload.html).length, 4);
  assert.equal(JSON.stringify(exported).includes("<script>"), false);
});

test("two-agent HTML demo has distinct interactive documents and cancels cleanly", async () => {
  const store = new Store();
  try {
    const run = store.createRun({ title: "HTML demo", mode: "deterministic" });
    await runChartDemo(store, run.id, { delayMs: 0 });
    const state = store.snapshot(run.id);
    assert.equal(state.run.status, "completed");
    assert.deepEqual(Object.keys(state.agents), ["trainer", "evaluator"]);
    assert.deepEqual(state.artifacts.map((a) => a.agentId), ["trainer", "evaluator", "trainer"]);
    assert.match(store.chartDocument(run.id, state.artifacts[0].id).source, /id="step"/);
    assert.match(store.chartDocument(run.id, state.artifacts[1].id).source, /F1 score/);
    const cancelled = store.createRun({ title: "Cancel", mode: "deterministic" }), controller = new AbortController();
    const pending = runChartDemo(store, cancelled.id, { delayMs: 1000, signal: controller.signal });
    controller.abort(); await assert.rejects(pending);
    assert.equal(store.snapshot(cancelled.id).run.status, "cancelled");
    assert.equal(store.snapshot(cancelled.id).artifacts.length, 0);
  } finally { store.close(); }
});
