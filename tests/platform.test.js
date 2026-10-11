import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { project } from "../src/state.js";
import { runDemo } from "../src/demo.js";
import { createApp } from "../src/server.js";

function fixture(t, path) {
  const s = new Store(path);
  t.after(() => s.close());
  const run = s.createRun({ title: "Test mission" });
  s.registerAgent(run.id, { id: "a", name: "A", role: "arbitrary-new-role" });
  s.registerAgent(run.id, {
    id: "b",
    name: "B",
    role: "review",
    parentId: "a",
  });
  return { s, id: run.id };
}
const message = {
  id: "m1",
  conversationId: "c1",
  fromAgentId: "a",
  toAgentId: "b",
  content: "Please review.",
};

test("new roles and hierarchy are data; replay reconstructs only known agents", (t) => {
  const { s, id } = fixture(t);
  const events = s.events(id);
  const early = project(events.slice(0, 2));
  assert.deepEqual(Object.keys(early.agents), ["a"]);
  assert.equal(early.agents.a.role, "arbitrary-new-role");
  assert.equal(project(events).agents.b.parentId, "a");
  assert.throws(
    () =>
      s.registerAgent(id, {
        id: "c",
        name: "C",
        role: "new",
        parentId: "outside",
      }),
    /Parent/,
  );
});
test("delivery transitions are monotonic and only the recipient can ACK", (t) => {
  const { s, id } = fixture(t);
  s.send(id, message);
  assert.throws(() => s.ack(id, "m1", "processing", "b"), /Invalid/);
  assert.throws(() => s.ack(id, "m1", "delivered", "a"), /recipient/);
  s.ack(id, "m1", "delivered", "b");
  s.ack(id, "m1", "processing", "b");
  assert.throws(() => s.ack(id, "m1", "delivered", "b"), /Invalid/);
  assert.throws(() => s.ack(id, "m1", "answered", "b"), /expects a reply/);
});
test("correlated reply atomically marks original answered and links history", (t) => {
  const { s, id } = fixture(t);
  s.send(id, message);
  const before = s.events(id).length;
  const reply = s.send(id, {
    id: "m2",
    conversationId: "c1",
    fromAgentId: "b",
    toAgentId: "a",
    replyTo: "m1",
    content: "Approved.",
    expectsResponse: false,
  });
  assert.equal(reply.replyTo, "m1");
  assert.equal(s.events(id).length, before + 2);
  assert.equal(s.snapshot(id).messages.m1.status, "answered");
  assert.equal(
    project(s.events(id).slice(0, before)).messages.m1.status,
    "queued",
  );
  assert.deepEqual(s.inbox(id, "b"), []);
});
test("message IDs are idempotent but cannot conceal conflicting content", (t) => {
  const { s, id } = fixture(t);
  s.send(id, message);
  const before = s.events(id).length;
  s.send(id, message);
  assert.equal(s.events(id).length, before);
  assert.throws(
    () => s.send(id, { ...message, content: "Different" }),
    /reused/,
  );
});
test("runs isolate agents, replies and conversations", (t) => {
  const { s, id } = fixture(t);
  s.send(id, message);
  const other = s.createRun();
  s.registerAgent(other.id, { id: "outside", name: "Outside", role: "new" });
  assert.throws(
    () => s.send(id, { ...message, id: "m2", toAgentId: "outside" }),
    /belong/,
  );
  assert.throws(
    () => s.send(other.id, { ...message, replyTo: "m1" }),
    /belong/,
  );
  assert.throws(
    () =>
      s.send(id, {
        ...message,
        id: "m2",
        fromAgentId: "b",
        toAgentId: "a",
        replyTo: "m1",
        conversationId: "wrong",
      }),
    /conversationId/,
  );
  s.registerAgent(id, { id: "c", name: "C", role: "research" });
  assert.throws(
    () => s.send(id, { ...message, id: "m3", toAgentId: "c" }),
    /two participants/,
  );
});
test("failed delivery closes the inbox and terminal runs are immutable", (t) => {
  const { s, id } = fixture(t);
  s.send(id, message);
  s.ack(id, "m1", "failed", "b");
  assert.equal(s.inbox(id, "b").length, 0);
  assert.throws(
    () =>
      s.send(id, {
        ...message,
        id: "m2",
        fromAgentId: "b",
        toAgentId: "a",
        replyTo: "m1",
      }),
    /failed/,
  );
  s.finish(id, "failed", "Delivery failed");
  assert.throws(() => s.send(id, { ...message, id: "m3" }), /read-only/);
});
test("a completed run cannot hide unanswered requests", (t) => {
  const { s, id } = fixture(t);
  s.send(id, message);
  assert.throws(() => s.finish(id), /unanswered/);
  s.finish(id, "cancelled");
  assert.equal(s.snapshot(id).messages.m1.status, "failed");
});
test("tool attribution, result, and artifact versions survive projection", (t) => {
  const { s, id } = fixture(t);
  s.record(id, "tool.started", { id: "t", agentId: "a", name: "check" });
  assert.throws(
    () => s.record(id, "tool.completed", { id: "t", agentId: "b" }),
    /started/,
  );
  s.record(id, "tool.completed", { id: "t", agentId: "a", output: "OK" });
  s.record(id, "artifact.created", {
    agentId: "a",
    name: "Draft",
    content: "v2",
    version: 2,
  });
  const state = s.snapshot(id);
  assert.equal(state.tools[0].status, "completed");
  assert.equal(state.artifacts[0].version, 2);
});
test("deterministic demo exercises reject, revise, accept and closes requests", async (t) => {
  const s = new Store();
  t.after(() => s.close());
  const run = s.createRun({ mode: "deterministic" });
  await runDemo(s, run.id, { delayMs: 0 });
  const state = s.snapshot(run.id);
  assert.equal(state.run.status, "completed");
  assert.equal(Object.keys(state.agents).length, 3);
  assert.equal(
    state.artifacts.filter((a) => a.name === "Announcement draft").length,
    2,
  );
  const feedback = Object.values(state.messages).filter(
    (m) => m.kind === "feedback",
  );
  assert.match(feedback[0].content, /Rejected/);
  assert.match(feedback[1].content, /Accepted/);
  assert.ok(
    Object.values(state.messages).every((m) => m.status === "answered"),
  );
  assert.equal(
    new Set(
      Object.values(state.messages)
        .filter(
          (m) => m.fromAgentId === "verifier" || m.toAgentId === "verifier",
        )
        .map((m) => m.conversationId),
    ).size,
    1,
  );
});
test("adapter failure is visible and replayable, with no silent fixture fallback", async (t) => {
  const s = new Store();
  t.after(() => s.close());
  const run = s.createRun({ mode: "codex" });
  await assert.rejects(
    runDemo(s, run.id, {
      mode: "codex",
      delayMs: 0,
      turn: async () => {
        throw new Error("Adapter offline");
      },
    }),
    /offline/,
  );
  assert.equal(s.snapshot(run.id).run.status, "failed");
  assert.match(s.snapshot(run.id).run.error, /offline/);
});
test("cancellation closes outstanding messages", async (t) => {
  const s = new Store();
  t.after(() => s.close());
  const run = s.createRun();
  const controller = new AbortController();
  const job = runDemo(s, run.id, { delayMs: 100, signal: controller.signal });
  controller.abort();
  await assert.rejects(job);
  assert.equal(s.snapshot(run.id).run.status, "cancelled");
  assert.ok(
    Object.values(s.snapshot(run.id).messages).every(
      (m) => m.status === "failed",
    ),
  );
});
test("SQLite history survives process-equivalent close and reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-db-test-"));
  const path = join(dir, "events.sqlite");
  try {
    const first = new Store(path);
    const run = first.createRun({ title: "Persistent history" });
    first.finish(run.id);
    const events = first.events(run.id);
    first.close();
    const second = new Store(path);
    assert.deepEqual(second.events(run.id), events);
    assert.equal(second.list()[0].status, "completed");
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
async function serverFixture(t, enableCodex = false) {
  const store = new Store();
  const app = createApp({ store, enableCodex });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, data, headers = {}) =>
    fetch(
      base + path,
      data === undefined
        ? { headers }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify(data),
          },
    );
  return { ...app, base, request };
}
test("HTTP supports arbitrary roles and messages; rejects malformed and cross-origin writes", async (t) => {
  const { request } = await serverFixture(t);
  const run = await (
    await request("/api/runs", { title: "HTTP custom" })
  ).json();
  assert.equal(
    (
      await request(`/api/runs/${run.id}/agents`, {
        id: "a",
        name: "Researcher",
        role: "research",
      })
    ).status,
    201,
  );
  await request(`/api/runs/${run.id}/agents`, {
    id: "b",
    name: "Editor",
    role: "edit",
  });
  assert.equal(
    (await request(`/api/runs/${run.id}/messages`, message)).status,
    201,
  );
  assert.equal(
    (await (await request(`/api/runs/${run.id}/agents/b/inbox`)).json()).length,
    1,
  );
  assert.equal(
    (await request("/api/runs", {}, { Origin: "https://evil.example" })).status,
    403,
  );
  assert.equal((await request("/api/runs", { title: "" })).status, 400);
  assert.equal((await request("/api/demo", { mode: "codex" })).status, 403);
});
test("SSE replays missed events after cursor and streams newly committed messages", async (t) => {
  const { store, base } = await serverFixture(t);
  const run = store.createRun();
  store.registerAgent(run.id, { id: "a", name: "A", role: "writer" });
  const cursor = store.events(run.id)[0].seq;
  const controller = new AbortController();
  const response = await fetch(
    `${base}/api/runs/${run.id}/stream?after=${cursor}`,
    { signal: controller.signal },
  );
  const reader = response.body.getReader();
  let output = "";
  const deadline = setTimeout(() => controller.abort(), 2000);
  try {
    output += new TextDecoder().decode((await reader.read()).value);
    assert.match(output, /agent.registered/);
    assert.doesNotMatch(output, /run.created/);
    store.status(run.id, "a", "working", "Checking");
    output += new TextDecoder().decode((await reader.read()).value);
    assert.match(output, /agent.status/);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    await reader.cancel().catch(() => {});
  }
});
test("server restart explicitly terminates an interrupted run", async (t) => {
  const store = new Store();
  const run = store.createRun();
  const app = createApp({ store });
  t.after(() => app.close());
  assert.equal(store.snapshot(run.id).run.status, "failed");
  assert.match(store.snapshot(run.id).run.error, /restarted/);
});

test("run creation commits metadata and first event atomically", (t) => {
  const s = new Store();
  t.after(() => s.close());
  s.db.exec(
    "CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'write failed'); END;",
  );
  assert.throws(() => s.createRun(), /write failed/);
  assert.deepEqual(s.list(), []);
});
test("cancelling a run terminates its recorded in-progress tools", (t) => {
  const { s, id } = fixture(t);
  s.record(id, "tool.started", {
    id: "tool-1",
    agentId: "a",
    name: "Long task",
  });
  assert.throws(() => s.finish(id), /running tools/);
  s.finish(id, "cancelled");
  assert.equal(s.snapshot(id).tools[0].status, "failed");
  assert.equal(project(s.events(id).slice(0, -4)).tools[0].status, "running");
});
