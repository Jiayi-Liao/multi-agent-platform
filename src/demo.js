import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { codexTurn } from "./codex.js";

export const original =
  "The new export feature launches on Friday. It supports CSV and JSON. Beta users can try it at no extra cost.";
const flawed = "A new export feature launches soon with CSV support.";
const revised = "Launching Friday: export to CSV or JSON, free for beta users.";

export async function runDemo(
  store,
  runId,
  { mode = "deterministic", delayMs = 650, signal, turn = codexTurn } = {},
) {
  const wait = async () => {
    if (signal?.aborted) throw new Error("Run cancelled.");
    if (delayMs) await delay(delayMs, undefined, { signal });
  };
  const record = (type, p) => {
    if (signal?.aborted) return;
    if (type === "runtime.activity") store.append(runId, [[type, p]]);
    else store.record(runId, type, p);
  };
  const status = (id, value, activity) =>
    store.status(runId, id, value, activity);
  const send = (p) => store.send(runId, p);
  const receive = async (m) => {
    await wait();
    store.ack(runId, m.id, "delivered", m.toAgentId);
    store.ack(runId, m.id, "processing", m.toAgentId);
  };
  const reply = (m, content, kind = "task_result", expectsResponse = false) =>
    send({
      fromAgentId: m.toAgentId,
      toAgentId: m.fromAgentId,
      conversationId: m.conversationId,
      replyTo: m.id,
      content,
      kind,
      expectsResponse,
    });
  const perform = async (kind, agentId, prompt, fixture) => {
    if (mode === "codex")
      return turn({ kind, prompt, agentId, record, signal });
    const id = randomUUID();
    record("tool.started", {
      id,
      agentId,
      name: kind === "rewrite" ? "Rewrite fixture" : "Fact-preservation check",
      input: prompt,
    });
    await wait();
    record("tool.completed", { id, agentId, output: JSON.stringify(fixture) });
    return fixture;
  };
  try {
    store.registerAgent(runId, {
      id: "coordinator",
      name: "Coordinator",
      role: "orchestrator",
    });
    store.registerAgent(runId, {
      id: "rewriter",
      name: "Rewriter",
      role: "writer",
      parentId: "coordinator",
    });
    store.registerAgent(runId, {
      id: "verifier",
      name: "Verifier",
      role: "reviewer",
      parentId: "coordinator",
    });
    status("coordinator", "working", "Assigning the rewrite");
    record("artifact.created", {
      id: randomUUID(),
      agentId: "coordinator",
      name: "Source announcement",
      content: original,
      version: 1,
    });
    let request = send({
      fromAgentId: "coordinator",
      toAgentId: "rewriter",
      kind: "task_request",
      content: `Rewrite this announcement concisely. Source: ${original}`,
    });
    await receive(request);
    status("coordinator", "waiting", "Waiting for a verified rewrite");
    status("rewriter", "working", "Preparing the first draft");
    // Deliberately flawed fixture creates a reproducible reject → revise → accept path.
    record("artifact.created", {
      id: randomUUID(),
      agentId: "rewriter",
      name: "Announcement draft",
      content: flawed,
      version: 1,
    });
    let candidate = flawed;
    const draftResult = reply(request, candidate);
    await receive(draftResult);
    let review = send({
      fromAgentId: "rewriter",
      toAgentId: "verifier",
      kind: "task_request",
      content: `Check that every fact is preserved. Source: ${original}\nDraft: ${candidate}`,
    });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await receive(review);
      status("rewriter", "waiting", "Waiting for verification");
      status("verifier", "working", `Checking draft ${attempt}`);
      const verdict = await perform(
        "verify",
        "verifier",
        `You are a strict verifier. No tools or file access are needed. Compare source and draft. Accept only if Friday launch, both CSV and JSON, beta eligibility, and no extra cost are all preserved. Return structured accepted and feedback.\nSource: ${original}\nDraft: ${candidate}`,
        {
          accepted: attempt > 1,
          feedback:
            attempt === 1
              ? "Rejected: Friday became “soon”; JSON and free beta access are missing."
              : "Accepted: launch day, both formats, and free beta access are preserved.",
        },
      );
      const feedback = reply(
        review,
        verdict.feedback,
        "feedback",
        !verdict.accepted,
      );
      await receive(feedback);
      status(
        "verifier",
        verdict.accepted ? "completed" : "waiting",
        verdict.feedback,
      );
      if (verdict.accepted) {
        const result = send({
          fromAgentId: "rewriter",
          toAgentId: "coordinator",
          kind: "task_result",
          content: `Verified rewrite: ${candidate}`,
          expectsResponse: false,
        });
        await receive(result);
        store.finish(runId);
        return;
      }
      status("rewriter", "working", `Revising draft ${attempt}`);
      const rewrite = await perform(
        "rewrite",
        "rewriter",
        `You are a concise rewriter. No tools or file access are needed. Rewrite the source, preserving ALL facts: Friday launch, CSV AND JSON, beta users, and no extra cost. Follow verifier feedback. Return structured text.\nSource: ${original}\nPrevious draft: ${candidate}\nFeedback: ${verdict.feedback}`,
        { text: revised },
      );
      candidate = rewrite.text;
      record("artifact.created", {
        id: randomUUID(),
        agentId: "rewriter",
        name: "Announcement draft",
        content: candidate,
        version: attempt + 1,
      });
      review = reply(
        feedback,
        `Revised draft: ${candidate}\nSource: ${original}`,
        "task_request",
        true,
      );
    }
    throw new Error("Verification did not pass after three attempts.");
  } catch (error) {
    if (store.snapshot(runId).run.status === "running")
      store.finish(
        runId,
        signal?.aborted ? "cancelled" : "failed",
        signal?.aborted ? "Run cancelled." : error.message,
      );
    throw error;
  }
}
