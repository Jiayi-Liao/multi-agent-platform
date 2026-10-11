/** Pure projection shared by the live dashboard, replay, and server. */
export function project(events) {
  const state = {
    run: null,
    agents: {},
    messages: {},
    artifacts: [],
    tools: [],
  };
  for (const event of events) {
    const p = event.payload;
    switch (event.type) {
      case "run.created":
        state.run = { ...p, startedAt: event.timestamp, status: "running" };
        break;
      case "run.finished":
        state.run.status = p.status;
        state.run.finishedAt = event.timestamp;
        state.run.error = p.error;
        break;
      case "agent.registered":
        state.agents[p.id] = {
          ...p,
          status: "idle",
          registeredAt: event.timestamp,
        };
        break;
      case "agent.status":
        Object.assign(state.agents[p.agentId], {
          status: p.status,
          activity: p.activity,
          updatedAt: event.timestamp,
        });
        break;
      case "message.sent":
        state.messages[p.id] = {
          ...p,
          status: "queued",
          timestamp: event.timestamp,
          acknowledgements: [],
        };
        break;
      case "message.acknowledged": {
        const m = state.messages[p.messageId];
        m.status = p.state;
        m.acknowledgements.push({ ...p, timestamp: event.timestamp });
        break;
      }
      case "artifact.created":
        state.artifacts.push({ ...p, timestamp: event.timestamp });
        break;
      case "tool.started":
        state.tools.push({
          ...p,
          status: "running",
          timestamp: event.timestamp,
        });
        break;
      case "tool.completed": {
        const tool = state.tools.find((t) => t.id === p.id);
        if (tool)
          Object.assign(tool, p, {
            status: p.error ? "failed" : "completed",
            finishedAt: event.timestamp,
          });
        break;
      }
    }
  }
  return state;
}
export const terminalMessages = new Set(["answered", "failed"]);
