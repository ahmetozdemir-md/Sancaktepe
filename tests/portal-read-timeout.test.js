import test from 'node:test';
import assert from 'node:assert/strict';
import { withPortalReadTimeout } from '../src/portalReadTimeout.js';

test('a stalled auth/session or network read times out and permits another attempt', async () => {
  let signal;
  await assert.rejects(withPortalReadTimeout(s => { signal = s; return new Promise(() => {}); }, 10), /zaman aşımına/);
  assert.equal(signal.aborted, true);
  assert.equal(await withPortalReadTimeout(async () => 'fresh snapshot', 100), 'fresh snapshot');
});
test('successful reads and access errors retain their result without aborting', async () => {
  let signal;
  assert.deepEqual(await withPortalReadTimeout(async s => { signal = s; return { updatedAt: 'revision' }; }), { updatedAt: 'revision' });
  assert.equal(signal.aborted, false);
  const accessError = new Error('Access denied');
  await assert.rejects(withPortalReadTimeout(() => { throw accessError; }), error => error === accessError);
});
test('a response arriving after timeout cannot become the read result', async () => {
  let resolve;
  const read = withPortalReadTimeout(() => new Promise(done => { resolve = done; }), 10);
  await assert.rejects(read, /zaman aşımına/);
  resolve('stale snapshot');
  await assert.rejects(read, /zaman aşımına/);
});
