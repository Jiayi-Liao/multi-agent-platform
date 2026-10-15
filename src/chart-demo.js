import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export const chartFixtures = [
  { agentId: "trainer", name: "Training loss · first pass", file: "training-loss-first.html", content: "Interactive synthetic loss curve with a step slider and validation toggle.", version: 1 },
  { agentId: "evaluator", name: "Evaluation comparison", file: "evaluation-comparison.html", content: "Interactive synthetic comparison. Switch between Accuracy and F1 score.", version: 1 },
  { agentId: "trainer", name: "Training loss · final pass", file: "training-loss-final.html", content: "Completed synthetic training dashboard. Adjust the step or toggle validation.", version: 2 },
];
export async function runChartDemo(store, runId, { delayMs = 900, signal } = {}) {
  try {
    store.registerAgent(runId, { id: "trainer", name: "Trainer", role: "training" });
    store.registerAgent(runId, { id: "evaluator", name: "Evaluator", role: "evaluation" });
    for (const fixture of chartFixtures) {
      store.status(runId, fixture.agentId, "working", `Preparing ${fixture.name}`);
      await delay(delayMs, undefined, { signal });
      const html = await readFile(new URL(`../public/demo-charts/${fixture.file}`, import.meta.url), "utf8");
      signal?.throwIfAborted();
      store.chart(runId, { ...fixture, html });
      store.status(runId, fixture.agentId, "waiting", "Chart submitted");
    }
    store.finish(runId);
  } catch (error) {
    if (store.snapshot(runId).run.status === "running")
      store.finish(runId, signal?.aborted ? "cancelled" : "failed", signal?.aborted ? "Chart demo cancelled." : "Chart demo failed.");
    throw error;
  }
}
