import test from "node:test";
import assert from "node:assert/strict";
import { agentRecord, checkpoints, newestFirst } from "../src/history.js";
import { project } from "../src/state.js";

const fixture = [
  ["run.created", { id: "r", title: "Arbitrary crew" }],
  ["agent.registered", { id: "astronomer", name: "Astronomer", role: "star-charting" }],
  ["agent.registered", { id: "critic", name: "Critic", role: "review", parentId: "astronomer" }],
  ["message.sent", { id: "m", fromAgentId: "astronomer", toAgentId: "critic", content: "Review this map", conversationId: "c" }],
  ["message.acknowledged", { messageId: "m", actorId: "critic", state: "delivered" }],
  ["message.acknowledged", { messageId: "m", actorId: "critic", state: "processing" }],
  ["tool.started", { id: "t", agentId: "critic", name: "Check coordinates" }],
  ["tool.completed", { id: "t", output: "Valid" }],
  ["artifact.created", { agentId: "critic", name: "Review", content: "Accepted", version: 1 }],
  ["message.sent", { id: "reply", fromAgentId: "critic", toAgentId: "astronomer", content: "Accepted", conversationId: "c", replyTo: "m" }],
  ["run.finished", { status: "completed" }],
].map(([type, payload], i) => ({ id: `e${i}`, seq: i + 1, timestamp: i * 300, type, payload }));

test("agent records preserve both sides of handoffs and every delivery event", () => {
  const state = project(fixture);
  const sender = agentRecord(state, fixture, "astronomer");
  const recipient = agentRecord(state, fixture, "critic");
  assert.deepEqual(sender.sent.map((m) => m.id), ["m"]);
  assert.deepEqual(sender.received.map((m) => m.id), ["reply"]);
  assert.deepEqual(sender.history.map((e) => e.seq), [10, 6, 5, 4, 2]);
  assert.deepEqual(recipient.history.map((e) => e.seq), [10, 9, 8, 7, 6, 5, 4, 3]);
  assert.equal(recipient.tools[0].status, "completed");
  assert.equal(recipient.artifacts[0].content, "Accepted");
});

test("rewinding removes future agents, replies, artifacts and tool results from profiles", () => {
  const visible = fixture.slice(0, 7), state = project(visible);
  const record = agentRecord(state, visible, "critic");
  assert.equal(record.sent.length, 0);
  assert.equal(record.artifacts.length, 0);
  assert.equal(record.tools[0].status, "running");
  assert.equal(record.tools[0].output, undefined);
  assert.ok(record.history.every((e) => e.seq <= 7));
  assert.equal(Object.keys(project(fixture.slice(0, 2)).agents).length, 1);
  assert.equal(agentRecord(project(fixture.slice(0, 2)), fixture.slice(0, 2), "critic").history.length, 0);
});

test("chapter navigation keeps exact indices across repeated timestamps and versions", () => {
  const events = [...fixture, { id: "v2", type: "artifact.created", payload: { name: "Review", version: 2 }, timestamp: fixture.at(-1).timestamp }];
  const chapters = checkpoints(events);
  assert.deepEqual(chapters.map((c) => c.index), [0, 1, 2, 3, 8, 9, 10, 11]);
  assert.equal(chapters.at(-1).label, "Review · v2");
  assert.equal(chapters.at(-1).event.id, "v2");
});

test("newest-first presentation follows commit sequence without changing replay order", () => {
  const events = [...fixture, { id: "v2", seq: 12, type: "artifact.created", payload: { agentId: "critic", name: "Review", content: "Revised", version: 2 }, timestamp: fixture[8].timestamp - 100 }];
  const state = project(events), before = JSON.stringify(events);
  const record = agentRecord(state, events, "critic");
  assert.deepEqual(record.artifacts.map((a) => a.version), [2, 1]);
  assert.equal(record.artifacts[0].timestamp, events.at(-1).timestamp);
  assert.equal(record.artifacts[0].eventSeq, 12);
  assert.deepEqual(record.messages.map((m) => m.id), ["reply", "m"]);
  assert.deepEqual(newestFirst(events).map((e) => e.seq), [...events].reverse().map((e) => e.seq));
  assert.equal(JSON.stringify(events), before);
  assert.deepEqual(state.artifacts.map((a) => a.version), [1, 2]);
  assert.deepEqual(newestFirst([{ seq: 1, timestamp: 10 }, { seq: 2, timestamp: 10 }]).map((e) => e.seq), [2, 1]);
  assert.deepEqual(newestFirst(state.messages.m.acknowledgements).map((a) => a.state), ["processing", "delivered"]);
});

test("tool records sort by their latest committed event and remain cursor-limited", () => {
  const events = [...fixture.slice(0, 7),
    { seq: 8, timestamp: 2100, type: "tool.started", payload: { id: "second", agentId: "critic", name: "Second tool" } },
    { seq: 9, timestamp: 2100, type: "tool.completed", payload: { id: "t", output: "Done" } },
  ];
  assert.deepEqual(agentRecord(project(events), events, "critic").tools.map((t) => t.id), ["t", "second"]);
  const earlier = events.slice(0, 8);
  assert.deepEqual(agentRecord(project(earlier), earlier, "critic").tools.map((t) => t.id), ["second", "t"]);
  assert.equal(agentRecord(project(earlier), earlier, "critic").tools[1].output, undefined);
});
