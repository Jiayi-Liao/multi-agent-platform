/** Small runtime-neutral client for writing adapters in Node or another JS runtime. */
export class PlatformClient {
  constructor({ baseUrl = "http://localhost:4310", runId, agentId } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.runId = runId;
    this.agentId = agentId;
  }
  async request(path, data) {
    const res = await fetch(
      this.baseUrl + path,
      data === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          },
    );
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
    return result;
  }
  path(suffix = "") {
    if (!this.runId) throw new Error("runId is required.");
    return `/api/runs/${encodeURIComponent(this.runId)}${suffix}`;
  }
  async createRun(title) {
    const run = await this.request("/api/runs", { title });
    this.runId = run.id;
    return run;
  }
  async register({ id = this.agentId, name, role, parentId } = {}) {
    const agent = await this.request(this.path("/agents"), {
      id,
      name,
      role,
      parentId,
    });
    this.agentId = agent.id;
    return agent;
  }
  send(toAgentId, content, options = {}) {
    return this.request(this.path("/messages"), {
      ...options,
      fromAgentId: this.agentId,
      toAgentId,
      content,
    });
  }
  reply(message, content, options = {}) {
    return this.send(message.fromAgentId, content, {
      ...options,
      conversationId: message.conversationId,
      replyTo: message.id,
      expectsResponse: options.expectsResponse ?? false,
    });
  }
  inbox(limit = 25) {
    return this.request(
      this.path(
        `/agents/${encodeURIComponent(this.agentId)}/inbox?limit=${limit}`,
      ),
    );
  }
  ack(messageId, state) {
    return this.request(
      this.path(`/messages/${encodeURIComponent(messageId)}/ack`),
      { actorId: this.agentId, state },
    );
  }
  status(status, activity = "") {
    return this.request(this.path("/events"), {
      type: "agent.status",
      payload: { agentId: this.agentId, status, activity },
    });
  }
  record(type, payload) {
    return this.request(this.path("/events"), {
      type,
      payload: { ...payload, agentId: this.agentId },
    });
  }
  finish(status = "completed") {
    return this.request(this.path("/finish"), { status });
  }
}
