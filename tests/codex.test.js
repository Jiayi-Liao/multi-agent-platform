import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexTurn } from "../src/codex.js";

async function fakeCli(t, code) {
  const dir = await mkdtemp(join(tmpdir(), "relay-cli-test-"));
  const bin = join(dir, "codex");
  await writeFile(bin, `#!${process.execPath}\n${code}`);
  await chmod(bin, 0o755);
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = bin;
  t.after(async () => {
    if (previous === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const events = [];
  return { events, record: (type, payload) => events.push({ type, payload }) };
}
test("Codex adapter consumes real JSONL framing, structured result and usage", async (t) => {
  const { events, record } = await fakeCli(
    t,
    `process.stdin.resume(); process.stdin.on('end', () => {\nconsole.log(JSON.stringify({type:'thread.started',thread_id:'thread-1'}));\nconsole.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({text:'Rewritten'})}}));\nprocess.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:3}}));\n});`,
  );
  const result = await codexTurn({
    kind: "rewrite",
    agentId: "writer",
    prompt: "Rewrite",
    record,
  });
  assert.deepEqual(result, { text: "Rewritten" });
  assert.equal(events[0].type, "tool.started");
  assert.equal(events.at(-1).type, "tool.completed");
  assert.equal(
    events.find((e) => e.payload.usage)?.payload.usage.output_tokens,
    3,
  );
});
test("Codex malformed final output fails visibly", async (t) => {
  const { record, events } = await fakeCli(
    t,
    `console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'not json'}}));`,
  );
  await assert.rejects(
    codexTurn({ kind: "verify", agentId: "v", prompt: "Verify", record }),
    /structured result/,
  );
  assert.ok(events.at(-1).payload.error);
});
test("Codex failure explains provider error and redacts bearer secrets", async (t) => {
  const { record, events } = await fakeCli(
    t,
    `console.log(JSON.stringify({type:'turn.failed',error:{message:'Model unavailable Bearer secret-value'}})); process.exitCode=1;`,
  );
  await assert.rejects(
    codexTurn({ kind: "verify", agentId: "v", prompt: "Verify", record }),
    /Model unavailable/,
  );
  assert.doesNotMatch(JSON.stringify(events), /secret-value/);
});
test("Codex timeout terminates the owned subprocess", async (t) => {
  const { record } = await fakeCli(t, "setInterval(() => {}, 1000);");
  await assert.rejects(
    codexTurn({
      kind: "verify",
      agentId: "v",
      prompt: "Verify",
      record,
      timeoutMs: 80,
    }),
    /timed out/,
  );
});
test("Codex cancellation does not write tool output after cancellation", async (t) => {
  const { record, events } = await fakeCli(t, "setInterval(() => {}, 1000);");
  const controller = new AbortController();
  const promise = codexTurn({
    kind: "verify",
    agentId: "v",
    prompt: "Verify",
    record,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 80);
  await assert.rejects(promise, /cancelled/);
  assert.equal(events.filter((e) => e.type === "tool.completed").length, 0);
});
test("non-terminal runtime error does not mask a recovered successful turn", async (t) => {
  const { record } = await fakeCli(
    t,
    `console.log(JSON.stringify({type:'error',message:'Reconnecting'})); console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({text:'Recovered'})}})); console.log(JSON.stringify({type:'turn.completed'}));`,
  );
  assert.deepEqual(
    await codexTurn({
      kind: "rewrite",
      agentId: "a",
      prompt: "Rewrite",
      record,
    }),
    { text: "Recovered" },
  );
});
