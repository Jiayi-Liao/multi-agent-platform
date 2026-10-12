import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syntheticSamples, buildPages } from "../scripts/build-pages.js";
import { StaticDemo } from "../public/static-demo.js";
import { project } from "../src/state.js";

function timers() {
  let clock = 1000000,
    counter = 0;
  const tasks = new Map();
  return {
    now: () => clock,
    schedule: (fn, ms) => {
      const id = ++counter;
      tasks.set(id, { fn, due: clock + ms });
      return id;
    },
    cancel: (id) => tasks.delete(id),
    advance(ms) {
      const target = clock + ms;
      while (true) {
        const entry = [...tasks]
          .filter(([, task]) => task.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!entry) break;
        tasks.delete(entry[0]);
        clock = entry[1].due;
        entry[1].fn();
      }
      clock = target;
    },
    get count() {
      return tasks.size;
    },
  };
}
test("Pages samples come from synthetic workflows and retain verified reply histories", async () => {
  const samples = await syntheticSamples();
  assert.equal(samples.length, 2);
  const rewrite = project(samples[0].events),
    research = project(samples[1].events);
  assert.equal(rewrite.run.status, "completed");
  assert.equal(Object.keys(rewrite.messages).length, 7);
  assert.equal(
    rewrite.artifacts.filter((a) => a.name === "Announcement draft").length,
    2,
  );
  assert.ok(
    Object.values(rewrite.messages).some((m) =>
      m.content.startsWith("Rejected:"),
    ),
  );
  assert.ok(
    Object.values(rewrite.messages).some((m) =>
      m.content.startsWith("Accepted:"),
    ),
  );
  assert.deepEqual(
    Object.values(research.agents).map((a) => a.role),
    ["planning", "research", "editing"],
  );
  for (const sample of samples) {
    assert.ok(
      sample.events.every(
        (e, i) =>
          e.seq === i + 1 &&
          (i === 0 || e.timestamp > sample.events[i - 1].timestamp),
      ),
    );
    assert.ok(!sample.events.some((e) => e.type === "runtime.activity"));
  }
});
test("browser demos stream only committed events and finish without exposing real runtime actions", async () => {
  const clock = timers();
  const demo = new StaticDemo(await syntheticSamples(), project, clock);
  const run = await demo.request("/api/demo", { mode: "deterministic" });
  assert.equal(run.status, "running");
  assert.equal(run.eventCount, 4);
  const received = [];
  const source = demo.subscribe(run.id, 4);
  let opened = false;
  source.onopen = () => {
    opened = true;
  };
  source.onmessage = (message) => received.push(JSON.parse(message.data));
  clock.advance(0);
  assert.equal(opened, true);
  assert.equal(received.length, 0);
  clock.advance(1800);
  const partial = await demo.request(`/api/runs/${run.id}`);
  assert.equal(Object.keys(project(partial.events).messages).length, 1);
  assert.equal(partial.run.status, "running");
  assert.ok(received.every((e) => e.timestamp <= clock.now()));
  clock.advance(20000);
  const complete = await demo.request(`/api/runs/${run.id}/export`);
  assert.equal(complete.version, 1);
  assert.equal(complete.run.status, "completed");
  assert.equal(Object.keys(project(complete.events).messages).length, 7);
  assert.equal(received.length, complete.events.length - 4);
  assert.equal(project(partial.events).run.status, "running"); // No reference mutation / future state leak.
  await assert.rejects(
    demo.request("/api/demo", { mode: "codex" }),
    /synthetic/,
  );
  await assert.rejects(
    demo.request("/api/runs", { title: "Real work" }),
    /local server/,
  );
  await assert.rejects(
    demo.request(`/api/runs/${run.id}/messages`, { content: "write" }),
    /local server/,
  );
  source.close();
  demo.close();
  assert.equal(clock.count, 0);
});
test("closing a browser demo stops timers and future events", async () => {
  const clock = timers();
  const demo = new StaticDemo(await syntheticSamples(), project, clock);
  const run = await demo.request("/api/demo", {});
  demo.close();
  clock.advance(30000);
  assert.equal((await demo.request(`/api/runs/${run.id}`)).events.length, 4);
  assert.equal(clock.count, 0);
});
test("Pages builds at a repository subpath and publishes only explicit public assets", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "relay-pages-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const destination = join(temp, "site");
  await buildPages(destination);
  const html = await readFile(join(destination, "index.html"), "utf8");
  assert.match(html, /data-mode="demo"/);
  assert.ok(!/(?:src|href)="\/(?!\/)/.test(html));
  for (const name of ["app.js", "world.js", "transport.js"]) {
    const code = await readFile(join(destination, name), "utf8");
    assert.ok(!/from\s+["']\/(?!\/)/.test(code), name);
  }
  const files = await readdir(destination, { recursive: true });
  assert.ok(
    files.includes("api.html") &&
      files.includes("theme.js") &&
      files.includes("theme.css") &&
      files.includes("experience.css") &&
      files.includes("history.js") &&
      files.includes("client.js") &&
      files.includes("vendor/three.core.js"),
  );
  assert.ok(
    !files.some((name) =>
      /\.runtime|sqlite|\.env|\.git\/|dashboard|codex/.test(name),
    ),
  );
  const samples = JSON.parse(
    await readFile(join(destination, "samples.json"), "utf8"),
  );
  assert.equal(samples[0].run.id, "sample-rewrite");
  assert.equal(Object.keys(project(samples[0].events).messages).length, 7);
});

test("a failed stream scheduler leaves no dangling listener that breaks cleanup", async () => {
  const demo = new StaticDemo(await syntheticSamples(), project, {
    schedule: () => {
      throw new Error("Timer unavailable");
    },
  });
  assert.throws(() => demo.subscribe("sample-rewrite"), /Timer unavailable/);
  assert.doesNotThrow(() => demo.close());
  assert.equal(demo.listeners.get("sample-rewrite").size, 0);
});
