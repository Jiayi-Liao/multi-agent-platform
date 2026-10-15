import { readFile } from "node:fs/promises";
import { PlatformClient } from "../src/client.js";
import { chartFixtures } from "../src/chart-demo.js";
const baseUrl = process.env.PLATFORM_URL || "http://localhost:4310";
const trainer = new PlatformClient({ baseUrl, agentId: "trainer" });
let run;
try {
  run = await trainer.createRun("Trainer + Evaluator · SDK HTML demo");
  await trainer.register({ name: "Trainer", role: "training" });
  const evaluator = new PlatformClient({ baseUrl, runId: run.id, agentId: "evaluator" });
  await evaluator.register({ name: "Evaluator", role: "evaluation" });
  for (const chart of chartFixtures) {
    const agent = chart.agentId === "trainer" ? trainer : evaluator;
    await agent.status("working", `Submitting ${chart.name}`);
    const html = await readFile(new URL(`../public/demo-charts/${chart.file}`, import.meta.url), "utf8");
    const result = await agent.chart(chart.name, html, { content: chart.content, version: chart.version });
    console.log(`${chart.agentId}: ${result.name} (${result.html.byteLength} bytes)`);
  }
  await trainer.finish();
  console.log(`Run ${run.id} completed. Open ${baseUrl}/#dashboard and select this run.`);
} catch (error) {
  if (run) await trainer.finish("failed").catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
}
