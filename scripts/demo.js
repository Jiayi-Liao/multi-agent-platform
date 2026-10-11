const base = process.env.PLATFORM_URL || "http://localhost:4310";
const mode = process.argv.includes("--codex") ? "codex" : "deterministic";
try {
  const response = await fetch(`${base}/api/demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  const run = await response.json();
  if (!response.ok) throw new Error(run.error);
  console.log(`Run ${run.id}\nOpen ${base} to follow the team.`);
  let lastSeq = 0;
  while (true) {
    const res = await fetch(`${base}/api/runs/${run.id}`);
    const { run: current, events } = await res.json();
    for (const event of events.filter((e) => e.seq > lastSeq)) {
      if (event.type === "message.sent")
        console.log(
          `${event.payload.fromAgentId} → ${event.payload.toAgentId}: ${event.payload.content}`,
        );
      lastSeq = event.seq;
    }
    if (current.status !== "running") {
      console.log(
        `Run ${current.status}${current.error ? `: ${current.error}` : ""}`,
      );
      if (current.status !== "completed") process.exitCode = 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
