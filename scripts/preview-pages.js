import { CHART_CSP } from "../src/chart-documents.js";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const prefix = "/multi-agent-platform/";
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      return res.end("Static preview: no HTTP API backend.");
    }
    if (url.pathname === "/" || url.pathname === prefix.slice(0, -1)) {
      res.writeHead(302, { Location: prefix });
      return res.end();
    }
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404);
      return res.end("Not found.");
    }
    const path = resolve(
      root,
      decodeURIComponent(url.pathname.slice(prefix.length)) || "index.html",
    );
    if (!path.startsWith(resolve(root) + sep)) {
      res.writeHead(404);
      return res.end("Not found.");
    }
    const data = await readFile(path);
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "text/plain",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        url.pathname.includes("/demo-charts/") ? CHART_CSP : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end("Not found. Run npm run build:pages first.");
  }
});
const port = Number(process.env.PAGES_PREVIEW_PORT || 4311);
server.listen(port, "127.0.0.1", () =>
  console.log(`Pages preview → http://localhost:${port}${prefix}`),
);
