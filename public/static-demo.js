/** Browser-only synthetic demo. Never reads local histories or calls a model/API. */
export class StaticDemo {
  constructor(
    samples,
    project,
    {
      schedule = (fn, ms) => setTimeout(fn, ms),
      cancel = (id) => clearTimeout(id),
      now = Date.now,
    } = {},
  ) {
    this.project = project;
    this.schedule = schedule;
    this.cancel = cancel;
    this.now = now;
    this.runs = new Map(
      samples.map((sample) => [
        sample.events[0].runId,
        structuredClone(sample.events),
      ]),
    );
    this.templates = new Map([...this.runs].map(([id, events]) => [id, structuredClone(events)]));
    this.listeners = new Map();
    this.jobs = new Map();
    this.serial = 0;
  }
  summary(events) {
    const state = this.project(events);
    return {
      ...state.run,
      agentCount: Object.keys(state.agents).length,
      eventCount: events.length,
    };
  }
  async request(path, data) {
    const route = path.split("?")[0];
    if (route === "/api/config" && data === undefined)
      return { enableCodex: false, staticDemo: true };
    if (route === "/api/runs" && data === undefined)
      return [...this.runs.values()].map((e) => this.summary(e)).reverse();
    if (route === "/api/demo/charts" && data !== undefined) {
      if (this.jobs.size >= 3) throw new Error("Three browser demos are already playing. Wait for one to finish.");
      return this.launch("sample-charts");
    }
    if (route === "/api/demo" && data !== undefined) {
      if (data.mode && data.mode !== "deterministic")
        throw new Error(
          "This public demo uses synthetic events. Run Codex agents on your local server.",
        );
      if (this.jobs.size >= 3)
        throw new Error(
          "Three browser demos are already playing. Wait for one to finish.",
        );
      return this.launch();
    }
    const rename = route.match(/^\/api\/runs\/([^/]+)\/agents\/([^/]+)\/rename$/);
    if (rename && data !== undefined) {
      const events = this.runs.get(rename[1]);
      if (!events) throw new Error("Sample run not found.");
      const agentId = decodeURIComponent(rename[2]), agents = this.project(events).agents;
      if (!Object.hasOwn(agents, agentId)) throw new Error("Agent not found.");
      if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 100)
        throw new Error("name must be a non-empty string (max 100 characters).");
      const agent = agents[agentId], name = data.name.trim();
      if (name !== agent.name) {
        const event = { id: `${rename[1]}-rename-${++this.serial}`, runId: rename[1],
          seq: events.at(-1).seq + 1, timestamp: Math.max(this.now(), events.at(-1).timestamp),
          type: "agent.renamed", payload: { agentId, previousName: agent.name, name } };
        events.push(event);
        for (const listener of this.listeners.get(rename[1]) || [])
          listener.onmessage?.({ data: JSON.stringify(event) });
      }
      return { ...agent, name };
    }
    const match = route.match(/^\/api\/runs\/([^/]+)(?:\/(export))?$/);
    if (match && data === undefined) {
      const events = this.runs.get(match[1]);
      if (!events) throw new Error("Sample run not found.");
      return structuredClone({
        ...(match[2] ? { version: 1 } : {}),
        run: this.project(events).run,
        events,
      });
    }
    throw new Error(
      "This action needs the local server. Open API & setup to connect your own agents.",
    );
  }
  launch(templateId = "sample-rewrite") {
    const template = this.templates.get(templateId);
    if (!template) throw new Error("Sample run not found.");
    const id = `browser-demo-${++this.serial}`;
    const start = this.now();
    const offset = template[0].timestamp;
    const all = structuredClone(template).map((e, index) => ({
      ...e,
      runId: id,
      id: `${id}-event-${index}`,
      timestamp: start + e.timestamp - offset,
      payload:
        e.type === "run.created"
          ? { ...e.payload, id, title: templateId === "sample-charts" ? "Trainer + Evaluator · browser HTML demo" : "Rewriter ↔ Verifier · browser demo" }
          : e.payload,
    }));
    const events = all.slice(0, 4);
    this.runs.set(id, events);
    let index = 4;
    const next = () => {
      const event = { ...all[index++], seq: events.at(-1).seq + 1 };
      event.timestamp = Math.max(event.timestamp, events.at(-1).timestamp);
      events.push(event);
      for (const listener of this.listeners.get(id) || [])
        listener.onmessage?.({ data: JSON.stringify(event) });
      if (index < all.length)
        this.jobs.set(
          id,
          this.schedule(next, Math.max(0, all[index].timestamp - this.now())),
        );
      else this.jobs.delete(id);
    };
    this.jobs.set(
      id,
      this.schedule(next, Math.max(0, all[index].timestamp - this.now())),
    );
    return this.summary(events);
  }
  subscribe(id, after = 0) {
    if (!this.runs.has(id)) throw new Error("Sample run not found.");
    const listeners = this.listeners.get(id) || new Set();
    this.listeners.set(id, listeners);
    const backlog = this.runs.get(id).filter((e) => e.seq > after);
    let timer;
    const source = {
      onopen: null,
      onmessage: null,
      onerror: null,
      close: () => {
        if (timer !== undefined) this.cancel(timer);
        listeners.delete(source);
      },
    };
    timer = this.schedule(() => {
      source.onopen?.();
      for (const event of backlog)
        source.onmessage?.({ data: JSON.stringify(event) });
    }, 0);
    listeners.add(source);
    return source;
  }
  close() {
    for (const timer of this.jobs.values()) this.cancel(timer);
    this.jobs.clear();
    for (const listeners of this.listeners.values())
      for (const source of [...listeners]) source.close();
  }
}
