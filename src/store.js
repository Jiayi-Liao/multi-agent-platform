import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { MAX_HTML_BYTES } from "./chart-documents.js";
import { project, terminalMessages } from "./state.js";

export class DomainError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const requireValue = (ok, message, status) => {
  if (!ok) throw new DomainError(message, status);
};
export function textField(value, name, max = 5000) {
  requireValue(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    `${name} must be a non-empty string (max ${max} characters).`,
  );
  return value.trim();
}
export class Store extends EventEmitter {
  constructor(path = ":memory:") {
    super();
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id), type TEXT NOT NULL, timestamp INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_run_seq ON events(run_id,seq);
      CREATE TABLE IF NOT EXISTS chart_documents (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), agent_id TEXT NOT NULL, source TEXT NOT NULL);`);
  }
  close() {
    this.db.close();
  }
  events(runId, after = 0) {
    this.getRun(runId);
    return this.db
      .prepare("SELECT * FROM events WHERE run_id=? AND seq>? ORDER BY seq")
      .all(runId, after)
      .map((row) => ({
        seq: row.seq,
        id: row.id,
        runId: row.run_id,
        type: row.type,
        timestamp: row.timestamp,
        payload: JSON.parse(row.payload),
      }));
  }
  getRun(id) {
    const run = this.db.prepare("SELECT * FROM runs WHERE id=?").get(id);
    requireValue(run, "Run not found.", 404);
    return run;
  }
  snapshot(id) {
    return project(this.events(id));
  }
  active(id) {
    const s = this.snapshot(id);
    requireValue(
      s.run.status === "running",
      "This run has finished and is read-only.",
      409,
    );
    return s;
  }
  list() {
    return this.db
      .prepare("SELECT id FROM runs ORDER BY created_at DESC, rowid DESC")
      .all()
      .map(({ id }) => {
        const events = this.events(id);
        const state = project(events);
        return {
          ...state.run,
          eventCount: events.length,
          agentCount: Object.keys(state.agents).length,
        };
      });
  }
  append(runId, entries, before = null) {
    const written = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      before?.();
      for (const [type, payload] of entries) {
        const event = {
          id: randomUUID(),
          runId,
          type,
          timestamp: Date.now(),
          payload,
        };
        const result = this.db
          .prepare(
            "INSERT INTO events(id,run_id,type,timestamp,payload) VALUES(?,?,?,?,?)",
          )
          .run(event.id, runId, type, event.timestamp, JSON.stringify(payload));
        event.seq = Number(result.lastInsertRowid);
        written.push(event);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    for (const event of written) this.emit("event", event);
    return written;
  }
  createRun({ title = "Untitled run", mode = "custom" } = {}) {
    title = textField(title, "title", 140);
    requireValue(
      ["custom", "deterministic", "codex"].includes(mode),
      "Unknown run mode.",
    );
    const id = randomUUID();
    this.append(id, [["run.created", { id, title, mode }]], () =>
      this.db
        .prepare("INSERT INTO runs VALUES(?,?,?,?)")
        .run(id, title, mode, Date.now()),
    );
    return this.snapshot(id).run;
  }
  registerAgent(runId, input) {
    const s = this.active(runId);
    const id = textField(input.id || randomUUID(), "id", 100);
    requireValue(!s.agents[id], "Agent ID already exists.", 409);
    if (input.parentId)
      requireValue(
        s.agents[input.parentId],
        "Parent agent must belong to this run.",
      );
    const p = {
      id,
      name: textField(input.name, "name", 100),
      role: textField(input.role, "role", 100),
      parentId: input.parentId || null,
    };
    this.append(runId, [["agent.registered", p]]);
    return p;
  }
  // Display names are editable after execution ends; identity and execution remain immutable.
  renameAgent(runId, agentId, name) {
    const state = this.snapshot(runId);
    requireValue(Object.hasOwn(state.agents, agentId), "Agent not found.", 404);
    name = textField(name, "name", 100);
    const agent = state.agents[agentId];
    if (agent.name !== name)
      this.append(runId, [["agent.renamed", { agentId, previousName: agent.name, name }]]);
    return { ...agent, name };
  }
  status(runId, agentId, status, activity = "") {
    const s = this.active(runId);
    requireValue(s.agents[agentId], "Agent not found.", 404);
    requireValue(
      ["idle", "working", "waiting", "completed", "failed"].includes(status),
      "Unknown agent status.",
    );
    requireValue(
      typeof activity === "string" && activity.length <= 1000,
      "Invalid activity.",
    );
    return this.append(runId, [
      ["agent.status", { agentId, status, activity }],
    ])[0];
  }
  send(runId, input) {
    const s = this.active(runId);
    const id = textField(input.id || randomUUID(), "message id", 100);
    const body = {
      id,
      conversationId: input.conversationId || randomUUID(),
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      replyTo: input.replyTo || null,
      content: textField(input.content, "content", 32000),
      kind: input.kind || "chat",
      expectsResponse: input.expectsResponse ?? true,
    };
    textField(body.conversationId, "conversationId", 100);
    requireValue(
      typeof body.expectsResponse === "boolean",
      "expectsResponse must be a boolean.",
    );
    requireValue(
      ["chat", "task_request", "task_result", "feedback", "error"].includes(
        body.kind,
      ),
      "Unknown message kind.",
    );
    requireValue(
      s.agents[body.fromAgentId] && s.agents[body.toAgentId],
      "Sender and recipient must belong to this run.",
    );
    requireValue(
      body.fromAgentId !== body.toAgentId,
      "Sender and recipient must differ.",
    );
    if (s.messages[id]) {
      const original = s.messages[id];
      requireValue(
        Object.keys(body).every(
          (k) => JSON.stringify(original[k]) === JSON.stringify(body[k]),
        ),
        "Message ID reused with different content.",
        409,
      );
      return original;
    }
    const entries = [["message.sent", body]];
    if (body.replyTo) {
      const original = s.messages[body.replyTo];
      requireValue(original, "Reply target must belong to this run.");
      requireValue(
        original.conversationId === body.conversationId,
        "Reply must use the original conversationId.",
      );
      requireValue(
        original.toAgentId === body.fromAgentId &&
          original.fromAgentId === body.toAgentId,
        "Reply must reverse the original sender and recipient.",
      );
      requireValue(
        original.status !== "failed",
        "Cannot reply to a failed message.",
        409,
      );
      if (original.status !== "answered")
        entries.push([
          "message.acknowledged",
          {
            messageId: original.id,
            state: "answered",
            actorId: body.fromAgentId,
          },
        ]);
    } else {
      const thread = Object.values(s.messages).find(
        (m) => m.conversationId === body.conversationId,
      );
      if (thread)
        requireValue(
          new Set([thread.fromAgentId, thread.toAgentId]).has(
            body.fromAgentId,
          ) &&
            new Set([thread.fromAgentId, thread.toAgentId]).has(body.toAgentId),
          "Conversation is scoped to its original two participants.",
        );
    }
    this.append(runId, entries);
    return this.snapshot(runId).messages[id];
  }
  ack(runId, messageId, state, actorId) {
    const s = this.active(runId);
    const m = s.messages[messageId];
    requireValue(m, "Message not found.", 404);
    requireValue(
      actorId === m.toAgentId,
      "Only the recipient can acknowledge this message.",
      403,
    );
    const transitions = {
      queued: ["delivered", "failed"],
      delivered: ["processing", "answered", "failed"],
      processing: ["answered", "failed"],
    };
    requireValue(
      ["delivered", "processing", "answered", "failed"].includes(state),
      "Unknown acknowledgement state.",
    );
    if (m.status === state) return m;
    requireValue(
      transitions[m.status]?.includes(state),
      `Invalid acknowledgement transition: ${m.status} → ${state}.`,
      409,
    );
    requireValue(
      state !== "answered" || !m.expectsResponse,
      "This message expects a reply; send a correlated reply to mark it answered.",
      409,
    );
    this.append(runId, [
      ["message.acknowledged", { messageId, state, actorId }],
    ]);
    return this.snapshot(runId).messages[messageId];
  }
  inbox(runId, agentId, limit = 25) {
    const s = this.snapshot(runId);
    requireValue(s.agents[agentId], "Agent not found.", 404);
    return Object.values(s.messages)
      .filter((m) => m.toAgentId === agentId && !terminalMessages.has(m.status))
      .slice(0, limit);
  }
  chart(runId, { agentId, name, html, content = "", version = 1 }) {
    const state = this.active(runId);
    requireValue(Object.hasOwn(state.agents, agentId), "Agent not found.", 404);
    name = textField(name, "chart name", 140);
    requireValue(typeof html === "string" && html.trim().length > 0, "html must be a non-empty HTML document string.");
    requireValue(Buffer.byteLength(html) <= MAX_HTML_BYTES, "HTML documents must be at most 2 MiB.", 413);
    requireValue(typeof content === "string" && content.length <= 2000, "Chart description must be at most 2000 characters.");
    requireValue(Number.isInteger(version) && version >= 1, "Invalid artifact version.");
    const id = randomUUID();
    const payload = { id, agentId, name, content, version, html: { id, byteLength: Buffer.byteLength(html) } };
    // The document and its artifact event either both commit or neither commits.
    const [event] = this.append(runId, [["artifact.created", payload]], () =>
      this.db.prepare("INSERT INTO chart_documents VALUES(?,?,?,?)").run(id, runId, agentId, html),
    );
    return { ...payload, timestamp: event.timestamp, eventSeq: event.seq };
  }
  chartDocument(runId, documentId) {
    this.getRun(runId);
    const document = this.db.prepare("SELECT * FROM chart_documents WHERE run_id=? AND id=?").get(runId, documentId);
    requireValue(document, "HTML chart not found.", 404);
    return document;
  }
  record(runId, type, p) {
    const s = this.active(runId);
    requireValue(
      ["artifact.created", "tool.started", "tool.completed"].includes(type),
      "Unsupported event type.",
    );
    requireValue(s.agents[p.agentId], "Agent not found.", 404);
    if (type === "artifact.created") {
      requireValue(p.html === undefined, "Submit HTML attachments through the charts endpoint.");
      textField(p.name, "artifact name", 140);
      textField(p.content, "artifact content", 32000);
      requireValue(
        p.version === undefined ||
          (Number.isInteger(p.version) && p.version >= 1),
        "Invalid artifact version.",
      );
    } else {
      textField(p.id, "tool id", 100);
      if (type === "tool.started") {
        textField(p.name, "tool name", 140);
        requireValue(
          !s.tools.some((t) => t.id === p.id),
          "Tool ID already exists.",
          409,
        );
      } else
        requireValue(
          s.tools.some(
            (t) =>
              t.id === p.id &&
              t.agentId === p.agentId &&
              t.status === "running",
          ),
          "Tool must be started by this agent before completion.",
          409,
        );
    }
    return this.append(runId, [[type, p]])[0];
  }
  finish(runId, status = "completed", error = null) {
    const s = this.active(runId);
    requireValue(
      ["completed", "failed", "cancelled"].includes(status),
      "Unknown terminal run status.",
    );
    requireValue(
      error === null || (typeof error === "string" && error.length <= 1000),
      "error must be a string of at most 1000 characters.",
    );
    const pending = Object.values(s.messages).filter(
      (m) => !terminalMessages.has(m.status),
    );
    const workingTools = s.tools.filter((t) => t.status === "running");
    requireValue(
      status !== "completed" || workingTools.length === 0,
      "Cannot complete a run with running tools.",
      409,
    );
    requireValue(
      status !== "completed" || !pending.some((m) => m.expectsResponse),
      "Cannot complete a run with unanswered requests.",
      409,
    );
    const entries = pending.map((m) => [
      "message.acknowledged",
      {
        messageId: m.id,
        state: status === "completed" ? "answered" : "failed",
        actorId: m.toAgentId,
      },
    ]);
    for (const tool of workingTools)
      entries.push([
        "tool.completed",
        { id: tool.id, agentId: tool.agentId, error: error || `Run ${status}` },
      ]);
    for (const agent of Object.values(s.agents))
      entries.push([
        "agent.status",
        {
          agentId: agent.id,
          status: status === "completed" ? "completed" : "failed",
          activity: status === "completed" ? "Run complete" : error || status,
        },
      ]);
    entries.push(["run.finished", { status, error }]);
    this.append(runId, entries);
  }
}
