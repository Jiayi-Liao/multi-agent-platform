import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { Store, DomainError } from "./store.js";
import { runDemo } from "./demo.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = (res, data, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new DomainError("Use application/json.", 415);
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 128000)
      throw new DomainError("Request body too large.", 413);
  }
  try {
    const p = JSON.parse(data);
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error();
    return p;
  } catch {
    throw new DomainError("Invalid JSON object.");
  }
}
export function createApp({
  store = new Store(resolve(root, ".runtime/events.sqlite")),
  enableCodex = process.env.ENABLE_CODEX === "1",
} = {}) {
  const jobs = new Map(),
    streams = new Set();
  // Interrupted runs remain visible and replayable instead of silently pretending to run.
  for (const run of store.list())
    if (run.status === "running")
      store.finish(
        run.id,
        "failed",
        "Server restarted before this run finished.",
      );
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const host = req.headers.host || "";
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
        throw new DomainError("Only localhost requests are allowed.", 403);
      if (
        req.headers.origin &&
        ![`http://${host}`].includes(req.headers.origin)
      )
        throw new DomainError("Cross-origin requests are not allowed.", 403);
      const url = new URL(req.url, `http://${host}`);
      const path = url.pathname;
      if (path === "/api/config" && req.method === "GET")
        return json(res, { enableCodex });
      if (path === "/api/runs") {
        if (req.method === "GET") return json(res, store.list());
        if (req.method === "POST")
          return json(res, store.createRun(await body(req)), 201);
      }
      if (path === "/api/demo" && req.method === "POST") {
        const input = await body(req),
          mode = input.mode || "deterministic";
        if (!["deterministic", "codex"].includes(mode))
          throw new DomainError("Unknown demo mode.");
        if (mode === "codex" && !enableCodex)
          throw new DomainError(
            "Restart with ENABLE_CODEX=1 to enable real Codex runs.",
            403,
          );
        if (jobs.size >= 3)
          throw new DomainError("Three demos are already running.", 429);
        const run = store.createRun({
          title:
            mode === "codex"
              ? "Announcement review · Codex"
              : "Announcement review · demo",
          mode,
        });
        const controller = new AbortController();
        jobs.set(run.id, controller);
        json(res, run, 201);
        runDemo(store, run.id, { mode, signal: controller.signal })
          .catch(() => {})
          .finally(() => jobs.delete(run.id));
        return;
      }
      const match = path.match(/^\/api\/runs\/([^/]+)(?:\/(.*))?$/);
      if (match) {
        const [, id, action = ""] = match;
        store.getRun(id);
        if (req.method === "GET" && action === "")
          return json(res, {
            run: store.snapshot(id).run,
            events: store.events(id),
          });
        if (req.method === "GET" && action === "export") {
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="run-${id}.json"`,
          );
          return json(res, {
            version: 1,
            run: store.snapshot(id).run,
            events: store.events(id),
          });
        }
        if (req.method === "GET" && action === "stream") {
          const cursor = Number(
            req.headers["last-event-id"] || url.searchParams.get("after") || 0,
          );
          if (!Number.isSafeInteger(cursor) || cursor < 0)
            throw new DomainError("Invalid stream cursor.");
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write("retry: 1500\n\n");
          streams.add(res);
          const write = (e) => {
            if (e.runId === id && e.seq > cursor)
              res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
          };
          // Synchronous backlog + subscribe guarantees no gap within the Node event loop.
          for (const e of store.events(id, cursor)) write(e);
          store.on("event", write);
          const heartbeat = setInterval(
            () => res.write(": heartbeat\n\n"),
            15000,
          );
          res.on("close", () => {
            clearInterval(heartbeat);
            store.off("event", write);
            streams.delete(res);
          });
          return;
        }
        if (req.method === "GET" && /^agents\/[^/]+\/inbox$/.test(action)) {
          const agentId = decodeURIComponent(action.split("/")[1]);
          const limit = Number(url.searchParams.get("limit") || 25);
          if (!Number.isInteger(limit) || limit < 1 || limit > 100)
            throw new DomainError("limit must be 1–100.");
          return json(res, store.inbox(id, agentId, limit));
        }
        if (req.method === "POST") {
          const input = await body(req);
          if (action === "agents")
            return json(res, store.registerAgent(id, input), 201);
          if (action === "messages")
            return json(res, store.send(id, input), 201);
          if (/^messages\/[^/]+\/ack$/.test(action))
            return json(
              res,
              store.ack(
                id,
                decodeURIComponent(action.split("/")[1]),
                input.state,
                input.actorId,
              ),
            );
          if (action === "events") {
            if (input.type === "agent.status")
              return json(
                res,
                store.status(
                  id,
                  input.payload?.agentId,
                  input.payload?.status,
                  input.payload?.activity,
                ),
              );
            if (!input.payload || typeof input.payload !== "object")
              throw new DomainError("payload is required.");
            return json(res, store.record(id, input.type, input.payload), 201);
          }
          if (action === "finish") {
            store.finish(id, input.status, input.error);
            return json(res, store.snapshot(id).run);
          }
          if (action === "cancel") {
            store.active(id);
            jobs.get(id)?.abort();
            store.finish(id, "cancelled", "Cancelled by the operator.");
            return json(res, store.snapshot(id).run);
          }
        }
      }
      if (req.method === "GET") {
        const files = {
          "/": ["public/index.html", "text/html"],
          "/app.js": ["public/app.js", "text/javascript"],
          "/world.js": ["public/world.js", "text/javascript"],
          "/world-state.js": ["src/world-state.js", "text/javascript"],
          "/vendor/three.module.js": [
            "node_modules/three/build/three.module.js",
            "text/javascript",
          ],
          "/vendor/three.core.js": [
            "node_modules/three/build/three.core.js",
            "text/javascript",
          ],
          "/style.css": ["public/style.css", "text/css"],
          "/state.js": ["src/state.js", "text/javascript"],
          "/favicon.svg": ["public/favicon.svg", "image/svg+xml"],
        };
        const entry = files[path];
        if (entry) {
          res.writeHead(200, { "Content-Type": entry[1] });
          res.end(await readFile(join(root, entry[0])));
          return;
        }
      }
      json(res, { error: "Not found." }, 404);
    } catch (error) {
      if (!res.headersSent)
        json(
          res,
          {
            error:
              error instanceof DomainError
                ? error.message
                : "Unexpected server error.",
          },
          error.status || 500,
        );
      else res.end();
    }
  });
  return {
    server,
    store,
    async close() {
      for (const [id, controller] of jobs) {
        controller.abort();
        if (store.snapshot(id).run.status === "running")
          store.finish(id, "cancelled", "Server stopped.");
      }
      for (const res of streams) res.end();
      await new Promise((resolveClose) => server.close(resolveClose));
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createApp();
  const port = Number(process.env.PORT || 4310);
  app.server.listen(port, "127.0.0.1", () =>
    console.log(`Multi-Agent Platform → http://localhost:${port}`),
  );
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    app.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
