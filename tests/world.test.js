import test from "node:test";
import assert from "node:assert/strict";
import { agentSlots, packetProgress } from "../src/world-state.js";
import { createApp } from "../src/server.js";
import { Store } from "../src/store.js";

test("arbitrary roles get unique stable slots when a crew grows", () => {
  const agents = Array.from({ length: 80 }, (_, i) => ({
    id: `agent-${i}`,
    role: `future-role-${i}`,
  }));
  const early = agentSlots(agents.slice(0, 3)),
    later = agentSlots(agents);
  for (const [id, position] of early) assert.deepEqual(later.get(id), position);
  assert.equal(
    new Set(
      [...later.values()].map((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`),
    ).size,
    agents.length,
  );
  assert.deepEqual([...agentSlots([])], []);
});

test("recorded send packets never appear before a send and expire without implying delivery", () => {
  assert.equal(packetProgress(1000, 999), null);
  assert.equal(packetProgress(1000, 1000), 0);
  assert.equal(packetProgress(1000, 1900), 0.5);
  assert.equal(packetProgress(1000, 2800), null);
  // Rewinding uses exactly the same visual state; there is no wall-clock or ACK dependence.
  assert.equal(packetProgress(1000, 1900), 0.5);
});

test("the local server delivers all Three.js modules under the self-only CSP", async (t) => {
  const app = createApp({ store: new Store(":memory:") });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  for (const path of [
    "/world.js",
    "/theme.js",
    "/theme.css",
    "/experience.css",
    "/history.js",
    "/gallery.js",
    "/i18n.js",
    "/dashboard-plan.md",
    "/dashboard-plan.zh-CN.md",
    "/world-state.js",
    "/vendor/three.module.js",
    "/vendor/three.core.js",
  ]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(
      res.headers.get("content-type"),
      path.endsWith(".css") ? /css/ : path.endsWith(".md") ? /markdown/ : /javascript/,
    );
    assert.match(
      res.headers.get("content-security-policy"),
      /script-src 'self'/,
    );
    assert.ok((await res.text()).length > 200);
  }
  assert.equal((await fetch(base + "/vendor/package.json")).status, 404);
});
