import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const schemas = {
  rewrite: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  verify: {
    type: "object",
    properties: { accepted: { type: "boolean" }, feedback: { type: "string" } },
    required: ["accepted", "feedback"],
    additionalProperties: false,
  },
};
/** Adapter owns a subprocess, consumes real JSONL, and never runs through a shell. */
export async function codexTurn({
  kind,
  prompt,
  agentId,
  record,
  signal,
  timeoutMs = 180000,
}) {
  const dir = await mkdtemp(join(tmpdir(), "multi-agent-turn-"));
  const schemaPath = join(dir, "response-schema.json");
  await writeFile(schemaPath, JSON.stringify(schemas[kind]));
  const toolId = randomUUID();
  record("tool.started", {
    id: toolId,
    agentId,
    name: "Codex CLI",
    input: prompt,
  });
  try {
    const result = await new Promise((resolve, reject) => {
      const args = [
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-schema",
        schemaPath,
        "--cd",
        dir,
        "-",
      ];
      if (process.env.CODEX_IGNORE_USER_CONFIG === "1")
        args.splice(1, 0, "--ignore-user-config");
      if (process.env.CODEX_MODEL)
        args.splice(1, 0, "--model", process.env.CODEX_MODEL);
      const child = spawn(process.env.CODEX_BIN || "codex", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let buffer = "",
        final = "",
        failure = null,
        lastError = null,
        settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(value);
      };
      let killTimer;
      const stop = (error) => {
        failure = error;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
      };
      const abort = () => stop(new Error("Run cancelled."));
      const timer = setTimeout(
        () => stop(new Error("Codex turn timed out.")),
        timeoutMs,
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const line = (raw) => {
        let e;
        try {
          e = JSON.parse(raw);
        } catch {
          return;
        }
        if (e.type === "item.completed" && e.item?.type === "agent_message")
          final = e.item.text;
        if (e.type === "turn.failed" || e.type === "error") {
          let detail =
            e.error?.message ||
            e.message ||
            "Check CLI login and model availability.";
          try {
            const parsed = JSON.parse(detail);
            detail = parsed.error?.message || parsed.message || detail;
          } catch {}
          detail = String(detail)
            .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]")
            .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
            .slice(0, 600);
          lastError = new Error(`Codex turn failed: ${detail}`);
          if (e.type === "turn.failed") failure = lastError;
        }
        if (
          e.type === "thread.started" ||
          e.type === "turn.completed" ||
          (e.type?.startsWith("item.") && e.item?.type !== "agent_message")
        ) {
          // Runtime activity is attached to this tool, not mistaken for an inter-agent message.
          record("runtime.activity", {
            agentId,
            toolId,
            eventType: e.type,
            itemType: e.item?.type,
            threadId: e.thread_id,
            usage: e.usage,
          });
        }
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.length > 1024 * 1024) {
          stop(new Error("Codex output exceeded the adapter limit."));
          return;
        }
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          line(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
      });
      child.stderr.resume(); // Do not persist credentials or verbose user-config diagnostics.
      child.stdin.on("error", () => {});
      child.on("error", (error) =>
        finish(
          new Error(
            `Cannot start Codex CLI: ${error.code || "unknown error"}.`,
          ),
        ),
      );
      child.on("close", (code) => {
        if (buffer.trim()) line(buffer);
        if (failure) return finish(failure);
        if (code !== 0)
          return finish(
            lastError ||
              new Error(
                `Codex exited with code ${code}. Check codex login status.`,
              ),
          );
        try {
          const value = JSON.parse(final);
          if (
            kind === "rewrite" &&
            (typeof value.text !== "string" || !value.text.trim())
          )
            throw new Error("Missing rewrite text.");
          if (
            kind === "verify" &&
            (typeof value.accepted !== "boolean" ||
              typeof value.feedback !== "string")
          )
            throw new Error("Invalid verifier result.");
          finish(null, value);
        } catch {
          finish(
            new Error("Codex did not return the required structured result."),
          );
        }
      });
      child.stdin.end(prompt);
    });
    record("tool.completed", {
      id: toolId,
      agentId,
      output: JSON.stringify(result),
    });
    return result;
  } catch (error) {
    if (!signal?.aborted)
      record("tool.completed", { id: toolId, agentId, error: error.message });
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
