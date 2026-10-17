/** UI ordering follows committed event sequence, including equal/skewed timestamps. */
export function newestFirst(items) {
  return items.map((item, index) => ({ item, index })).sort((a, b) =>
    (b.item.eventSeq ?? b.item.seq ?? b.index) - (a.item.eventSeq ?? a.item.seq ?? a.index)
  ).map(({ item }) => item);
}

/** Derive a crew member's record from a projected, cursor-limited history. */
export function agentRecord(state, events, agentId) {
  const messages = newestFirst(Object.values(state.messages).filter(
    (m) => m.fromAgentId === agentId || m.toAgentId === agentId,
  ));
  const messageIds = new Set(messages.map((m) => m.id));
  const tools = newestFirst(state.tools.filter((t) => t.agentId === agentId));
  const toolIds = new Set(tools.map((t) => t.id));
  return {
    sent: messages.filter((m) => m.fromAgentId === agentId),
    received: messages.filter((m) => m.toAgentId === agentId),
    messages,
    tools,
    artifacts: newestFirst(state.artifacts.filter((a) => a.agentId === agentId)),
    history: newestFirst(events.filter((e) => {
      const p = e.payload;
      if (e.type === "message.sent") return messageIds.has(p.id);
      if (e.type === "message.acknowledged") return messageIds.has(p.messageId);
      if (e.type.startsWith("tool.")) return p.agentId === agentId || toolIds.has(p.id);
      return p.agentId === agentId || (e.type === "agent.registered" && p.id === agentId);
    })),
  };
}

/** Navigation landmarks only. They never project future state into the world. */
export function checkpoints(events) {
  return events.flatMap((e, index) => {
    if (!["run.created", "agent.registered", "agent.renamed", "message.sent", "artifact.created", "run.finished"].includes(e.type)) return [];
    const p = e.payload;
    const label = e.type === "run.created" ? "Mission start"
      : e.type === "run.finished" ? `Run ${p.status}`
      : e.type === "agent.registered" ? `${p.name} joins`
      : e.type === "agent.renamed" ? `${p.previousName} → ${p.name}`
      : e.type === "artifact.created" ? `${p.name} · v${p.version || 1}`
      : p.replyTo ? "Reply recorded" : "New handoff";
    return [{ index, event: e, label }];
  });
}

/** Skip idle gaps between post-execution metadata changes during playback. */
export function replayClock(events, cursor, time) {
  const end = events.findIndex((event) => event.type === "run.finished");
  if (end >= 0 && events[end].timestamp <= time && cursor + 1 < events.length)
    return Math.max(time, events[Math.max(end + 1, cursor + 1)]?.timestamp ?? time);
  return time;
}

/** Full, cursor-limited conversations. Both directions belong to the same thread. */
export function conversationThreads(state, { agentId = null, pair = null, query = "" } = {}) {
  const groups = new Map();
  for (const message of Object.values(state.messages)) {
    let thread = groups.get(message.conversationId);
    if (!thread) {
      thread = { id: message.conversationId, participantIds: [], messages: [], eventSeq: 0, timestamp: message.timestamp };
      groups.set(thread.id, thread);
    }
    thread.messages.push(message);
    for (const id of [message.fromAgentId, message.toAgentId])
      if (!thread.participantIds.includes(id)) thread.participantIds.push(id);
    for (const event of [message, ...message.acknowledgements]) {
      if (event.eventSeq >= thread.eventSeq) {
        thread.eventSeq = event.eventSeq;
        thread.timestamp = event.timestamp;
      }
    }
  }
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return newestFirst([...groups.values()].filter((thread) => {
    if (agentId && !thread.participantIds.includes(agentId)) return false;
    if (pair && !pair.every((id) => thread.participantIds.includes(id))) return false;
    const text = [thread.id, ...thread.participantIds.flatMap((id) => [id, state.agents[id]?.name, state.agents[id]?.role]),
      ...thread.messages.flatMap((m) => [m.id, m.replyTo, m.kind, m.content])].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  })).map((thread) => ({ ...thread, messages: newestFirst(thread.messages) }));
}
