import test from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/state.js';
import { conversationThreads } from '../src/history.js';
const longText = 'Review the implementation.\n\n' + 'Detailed evidence and command output.\n'.repeat(45) + '<script>literal text</script> END OF FULL MESSAGE';
const events = [
  ['run.created', { id: 'run', title: 'Checker / Worker' }],
  ['agent.registered', { id: 'worker', name: 'Worker', role: 'implementation' }],
  ['agent.registered', { id: 'checker', name: 'Checker', role: 'review' }],
  ['agent.registered', { id: 'planner', name: 'Planner', role: 'coordination' }],
  ['message.sent', { id: 'request', fromAgentId: 'worker', toAgentId: 'checker', conversationId: 'review-1', content: longText, kind: 'task_request', expectsResponse: true }],
  ['message.acknowledged', { messageId: 'request', actorId: 'checker', state: 'processing' }],
  ['message.sent', { id: 'feedback', fromAgentId: 'checker', toAgentId: 'worker', conversationId: 'review-1', replyTo: 'request', content: 'Please add a regression test for empty input.', kind: 'feedback' }],
  ['message.sent', { id: 'separate', fromAgentId: 'worker', toAgentId: 'checker', conversationId: 'review-2', content: 'An independent review.', kind: 'chat' }],
  ['message.sent', { id: 'planning', fromAgentId: 'planner', toAgentId: 'worker', conversationId: 'planning', content: 'Please report progress.', kind: 'chat' }],
  ['message.acknowledged', { messageId: 'request', actorId: 'checker', state: 'answered' }],
].map(([type, payload], index) => ({ id: `e${index}`, type, payload, seq: index + 1, timestamp: index > 7 ? 100 : 5000 + index }));

test('threads include both directions, full multiline content and replies without merging separate conversations', () => {
  const state = project(events), before = JSON.stringify(state);
  const threads = conversationThreads(state);
  assert.deepEqual(threads.map((thread) => thread.id), ['review-1', 'planning', 'review-2']);
  assert.deepEqual(threads[0].participantIds, ['worker', 'checker']);
  assert.deepEqual(threads[0].messages.map((m) => m.id), ['feedback', 'request']);
  assert.equal(threads[0].messages[1].content, longText);
  assert.ok(threads[0].messages[1].content.endsWith('END OF FULL MESSAGE'));
  assert.equal(threads[0].messages[0].replyTo, 'request');
  assert.equal(threads[0].eventSeq, 10); // Latest ACK sorts a thread, even with a skewed timestamp.
  assert.equal(JSON.stringify(state), before);
});

test('participant and route filtering retain both directions and exclude unrelated handoffs', () => {
  const state = project(events);
  assert.deepEqual(conversationThreads(state, { agentId: 'checker' }).map((t) => t.id), ['review-1', 'review-2']);
  assert.deepEqual(conversationThreads(state, { pair: ['checker', 'worker'] }).map((t) => t.id), ['review-1', 'review-2']);
  assert.equal(conversationThreads(state, { pair: ['worker', 'checker'] })[0].messages.length, 2);
  assert.equal(conversationThreads(state, { agentId: 'unknown' }).length, 0);
});

test('search matches complete bodies, participant names, kinds and correlation IDs while keeping thread context', () => {
  const state = project(events);
  for (const query of ['END OF FULL MESSAGE', 'ChEcKeR worker regression', 'review-1', 'request', 'feedback']) {
    const threads = conversationThreads(state, { query });
    assert.equal(threads[0].id, 'review-1');
    assert.equal(threads[0].messages.length, 2);
  }
  assert.equal(conversationThreads(state, { query: 'no such content' }).length, 0);
});

test('rewinding hides future replies, acknowledgements, threads and renamed identities', () => {
  assert.deepEqual(conversationThreads(project(events.slice(0, 4))), []);
  const early = conversationThreads(project(events.slice(0, 5)));
  assert.equal(early.length, 1);
  assert.deepEqual(early[0].messages.map((m) => m.id), ['request']);
  assert.equal(early[0].messages[0].status, 'queued');
  assert.deepEqual(early[0].messages[0].acknowledgements, []);
  assert.equal(conversationThreads(project(events.slice(0, 6)))[0].messages[0].status, 'processing');
  const rename = { seq: 11, timestamp: 500, type: 'agent.renamed', payload: { agentId: 'checker', name: 'Review lead' } };
  assert.equal(conversationThreads(project([...events, rename]), { query: 'Review lead' }).length, 2);
  assert.equal(conversationThreads(project(events), { query: 'Review lead' }).length, 0);
});
