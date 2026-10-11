import { writeFile, mkdir } from "node:fs/promises";
const base = process.env.PLATFORM_URL || "http://localhost:4310";
const runs = await (await fetch(`${base}/api/runs`)).json();
await mkdir("artifacts", { recursive: true });
for (const run of runs) {
  if (
    process.argv.includes("--finish-custom") &&
    run.mode === "custom" &&
    run.status === "running"
  ) {
    const response = await fetch(`${base}/api/runs/${run.id}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    if (!response.ok) throw new Error((await response.json()).error);
  }
  const data = await (await fetch(`${base}/api/runs/${run.id}/export`)).json();
  await writeFile(
    `artifacts/local-${run.id}.json`,
    JSON.stringify(data, null, 2),
  );
  console.log(
    `${run.id} ${data.run.mode} ${data.run.status}: ${data.events.length} events`,
  );
}
