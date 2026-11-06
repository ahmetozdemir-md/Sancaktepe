import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerBridge, createPlannerFetch, PLANNER_CHANNEL } from '../public/nobet-planlayici/online-bridge.js';

function fixture(options) {
  const listeners = new Set(), sent = [];
  const parent = { postMessage: (...args) => sent.push(args) };
  const target = {
    parent, location: { origin: 'https://portal.example' }, crypto: { randomUUID: () => 'request' },
    addEventListener: (event, callback) => listeners.add(callback),
    removeEventListener: (event, callback) => listeners.delete(callback),
  };
  const bridge = createPlannerBridge(target, options);
  const answer = (message, event = {}) => {
    for (const listener of listeners) listener({ origin: target.location.origin, source: parent, data: message, ...event });
  };
  const reply = (call, value = {}) => answer({ channel: PLANNER_CHANNEL, type: 'response', id: call.id, ok: true, data: value });
  return { target, parent, bridge, sent, answer, reply, listeners };
}

test('bridge targets the exact portal origin and rejects spoofed origin, source, channel and unmatched IDs', async () => {
  const f = fixture();
  const pending = f.bridge.request('load');
  assert.equal(f.sent[0][1], 'https://portal.example');
  const call = f.sent[0][0];
  assert.equal(call.action, 'load');
  let resolved = false;
  void pending.then(() => { resolved = true; });
  const message = { channel: PLANNER_CHANNEL, type: 'response', id: call.id, ok: true, data: { revision: 1 } };
  f.answer(message, { origin: 'https://evil.example' });
  f.answer(message, { source: {} });
  f.answer({ ...message, channel: 'wrong' });
  f.answer({ ...message, id: 'unmatched' });
  f.answer({ ...message, ok: 'true' });
  await Promise.resolve();
  assert.equal(resolved, false);
  f.reply(call, { revision: 2 });
  assert.deepEqual(await pending, { revision: 2 });
  f.bridge.destroy();
});

test('concurrent replies retain request identity and save payload revision without merging state', async () => {
  const f = fixture();
  const load = f.bridge.request('load');
  const snapshot = { state: { assignments: [{ id: 'a' }] }, revision: 7 };
  const save = f.bridge.request('save', snapshot);
  assert.notEqual(f.sent[0][0].id, f.sent[1][0].id);
  assert.deepEqual(f.sent[1][0].payload, snapshot);
  f.reply(f.sent[1][0], { revision: 8 });
  f.reply(f.sent[0][0], { state: snapshot.state, revision: 7 });
  assert.deepEqual(await save, { revision: 8 });
  assert.equal((await load).revision, 7);
  f.bridge.destroy();
});

test('conflict and access errors preserve status for existing save safeguards', async () => {
  const f = fixture();
  const fetch = createPlannerFetch(f.bridge);
  const pending = fetch('/api/state', { method: 'PUT', body: JSON.stringify({ revision: 5, state: {} }) });
  const call = f.sent[0][0];
  f.answer({ channel: PLANNER_CHANNEL, type: 'response', id: call.id, ok: false, status: 409, error: 'Yeni kayıt var' });
  const response = await pending;
  assert.equal(response.ok, false);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'Yeni kayıt var' });
  f.bridge.destroy();
});

test('timeout cleans pending calls; a late reply cannot satisfy a later request', async () => {
  const f = fixture({ timeoutMs: 5 });
  const pending = f.bridge.request('load');
  await assert.rejects(pending, error => error.status === 504);
  const later = f.bridge.request('load', {}, { timeoutMs: 1000 });
  f.reply(f.sent[0][0], { revision: 1 });
  f.reply(f.sent[1][0], { revision: 2 });
  assert.deepEqual(await later, { revision: 2 });
  f.bridge.destroy();
});

test('standalone planner cannot access storage or silently fall back to the local API', async () => {
  const f = fixture();
  f.target.parent = f.target;
  await assert.rejects(f.bridge.request('load'), /Asistan sistemindeki/);
  await assert.rejects(f.bridge.request('delete-everything'), /Desteklenmeyen/);
  assert.equal(f.sent.length, 0);
  f.bridge.destroy();
});

test('backup paths are explicitly routed and arbitrary URLs never become portal actions', async () => {
  const calls = [];
  const fetch = createPlannerFetch({ request: async (...args) => { calls.push(args); return { state: {} }; } });
  await fetch('/api/backups');
  await fetch('/api/backups/backup%2Fkey');
  assert.deepEqual(calls, [['backups', {}], ['backup', { id: 'backup/key' }]]);
  await assert.rejects(fetch('https://evil.example/api/state'), /Desteklenmeyen/);
  await assert.rejects(fetch('/api/state', { method: 'DELETE' }), /Desteklenmeyen/);
});

test('destroy rejects pending actions and removes the listener', async () => {
  const f = fixture();
  const pending = f.bridge.request('save');
  f.bridge.destroy();
  await assert.rejects(pending, /kapatıldı/);
  assert.equal(f.listeners.size, 0);
});

test('status notifications disclose only dirty/busy/month and suppress unchanged repeated status', () => {
  const f = fixture();
  f.bridge.notifyStatus({ dirty: true, busy: true, month: '2026-11', state: { secret: 'never sent' } });
  f.bridge.notifyStatus({ dirty: true, busy: true, month: '2026-11' });
  f.bridge.notifyStatus({ dirty: false, busy: false, month: '2026-11' });
  assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent[0], [{ channel: PLANNER_CHANNEL, type: 'status', dirty: true, busy: true, month: '2026-11' }, 'https://portal.example']);
  assert.deepEqual(f.sent[1][0], { channel: PLANNER_CHANNEL, type: 'status', dirty: false, busy: false, month: '2026-11' });
  f.bridge.destroy();
});
