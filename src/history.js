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
    if (!["run.created", "agent.registered", "message.sent", "artifact.created", "run.finished"].includes(e.type)) return [];
    const p = e.payload;
    const label = e.type === "run.created" ? "Mission start"
      : e.type === "run.finished" ? `Run ${p.status}`
      : e.type === "agent.registered" ? `${p.name} joins`
      : e.type === "artifact.created" ? `${p.name} · v${p.version || 1}`
      : p.replyTo ? "Reply recorded" : "New handoff";
    return [{ index, event: e, label }];
  });
}
