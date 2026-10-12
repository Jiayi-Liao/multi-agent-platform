import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.js";
import { runDemo } from "../src/demo.js";
import { project } from "../src/state.js";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function syntheticSamples() {
  const store = new Store(":memory:");
  try {
    const rewrite = store.createRun({
      title: "Rewriter ↔ Verifier · sample",
      mode: "deterministic",
    });
    await runDemo(store, rewrite.id, { delayMs: 0 });
    const research = store.createRun({
      title: "Planner → Researcher → Editor · sample",
    });
    store.registerAgent(research.id, {
      id: "planner",
      name: "Planner",
      role: "planning",
    });
    store.registerAgent(research.id, {
      id: "researcher",
      name: "Researcher",
      role: "research",
      parentId: "planner",
    });
    store.registerAgent(research.id, {
      id: "editor",
      name: "Editor",
      role: "editing",
      parentId: "planner",
    });
    store.status(
      research.id,
      "planner",
      "working",
      "Planning a short research brief",
    );
    const task = store.send(research.id, {
      fromAgentId: "planner",
      toAgentId: "researcher",
      content: "Find three ways to visualize long-running agent workflows.",
    });
    store.ack(research.id, task.id, "delivered", "researcher");
    store.ack(research.id, task.id, "processing", "researcher");
    store.status(
      research.id,
      "researcher",
      "working",
      "Comparing diagrams, timelines and spatial views",
    );
    const result = store.send(research.id, {
      fromAgentId: "researcher",
      toAgentId: "planner",
      conversationId: task.conversationId,
      replyTo: task.id,
      content:
        "Use a role graph for structure, swimlanes for concurrency, and a 3D outpost for activity.",
      expectsResponse: false,
    });
    store.ack(research.id, result.id, "delivered", "planner");
    store.ack(research.id, result.id, "answered", "planner");
    const edit = store.send(research.id, {
      fromAgentId: "planner",
      toAgentId: "editor",
      content: "Turn these findings into a short brief.",
    });
    store.ack(research.id, edit.id, "delivered", "editor");
    store.ack(research.id, edit.id, "processing", "editor");
    store.status(research.id, "editor", "working", "Writing the brief");
    store.record(research.id, "artifact.created", {
      agentId: "editor",
      name: "Visualization brief",
      content:
        "Show structure in a graph, concurrency in a timeline, and activity in an interactive outpost. Preserve every handoff for replay.",
      version: 1,
    });
    const brief = store.send(research.id, {
      fromAgentId: "editor",
      toAgentId: "planner",
      conversationId: edit.conversationId,
      replyTo: edit.id,
      content: "The visualization brief is ready.",
      expectsResponse: false,
    });
    store.ack(research.id, brief.id, "delivered", "planner");
    store.ack(research.id, brief.id, "answered", "planner");
    store.finish(research.id);
    return [rewrite, research].map((run, index) => {
      const id = index ? "sample-research" : "sample-rewrite";
      const events = store.events(run.id).map((e, i) => ({
        ...e,
        seq: i + 1,
        id: `${id}-event-${i}`,
        runId: id,
        timestamp: Date.UTC(2026, 9, 12) + i * 300,
        payload: e.type === "run.created" ? { ...e.payload, id } : e.payload,
      }));
      return { run: project(events).run, events };
    });
  } finally {
    store.close();
  }
}
export async function buildPages(destination = join(root, "dist")) {
  // Only this build's known output may be replaced; never copy the workspace or runtime database.
  await rm(destination, { recursive: true, force: true });
  await mkdir(join(destination, "vendor"), { recursive: true });
  const files = {
    "index.html": "public/index.html",
    "app.js": "public/app.js",
    "world.js": "public/world.js",
    "transport.js": "public/transport.js",
    "static-demo.js": "public/static-demo.js",
    "style.css": "public/style.css",
    "theme.css": "public/theme.css",
    "experience.css": "public/experience.css",
    "history.js": "src/history.js",
    "theme.js": "public/theme.js",
    "favicon.svg": "public/favicon.svg",
    "state.js": "src/state.js",
    "world-state.js": "src/world-state.js",
    "client.js": "src/client.js",
    "api.html": "public/api.html",
    "api.css": "public/api.css",
  };
  for (const [name, source] of Object.entries(files)) {
    let text = await readFile(join(root, source), "utf8");
    if (name === "index.html")
      text = text.replace(
        '<html lang="en">',
        '<html lang="en" data-mode="demo">',
      );
    if (name.endsWith(".html"))
      text = text.replace(/(href|src)="\/(?!\/)/g, '$1="./');
    if (name.endsWith(".js"))
      text = text.replace(/(from\s+["'])\/(?!\/)/g, "$1./");
    await writeFile(join(destination, name), text);
  }
  for (const name of ["three.module.js", "three.core.js"])
    await copyFile(
      join(root, "node_modules/three/build", name),
      join(destination, "vendor", name),
    );
  await copyFile(join(root, "LICENSE"), join(destination, "LICENSE"));
  await copyFile(
    join(root, "node_modules/three/LICENSE"),
    join(destination, "vendor/THREE-LICENSE"),
  );
  await writeFile(
    join(destination, "samples.json"),
    JSON.stringify(await syntheticSamples(), null, 2),
  );
  await writeFile(join(destination, ".nojekyll"), "");
  console.log(`GitHub Pages build → ${destination}`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildPages();
