import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForWebGLCompletion } from '../packages/tfl-engine/src/benchmark-sync.js';

function fixture(statuses = [2, 3]) {
  const calls = [];
  const fence = {};
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, TIMEOUT_EXPIRED: 2,
    CONDITION_SATISFIED: 3, ALREADY_SIGNALED: 4, WAIT_FAILED: 5,
    isContextLost: () => false,
    fenceSync(condition, flags) {
      assert.equal(condition, 1);
      assert.equal(flags, 0);
      calls.push('fence');
      return fence;
    },
    flush() { calls.push('flush'); },
    clientWaitSync(sync, flags, timeout) {
      assert.equal(sync, fence);
      assert.equal(flags, 0);
      assert.equal(timeout, 0);
      calls.push('poll');
      return statuses.shift() ?? 2;
    },
    deleteSync(sync) { assert.equal(sync, fence); calls.push('delete'); },
    finish() { assert.fail('Blocking finish must never be called'); },
  };
  let clock = 0;
  const options = {
    now: () => clock,
    yieldToBrowser: async () => { clock++; calls.push('yield'); },
  };
  return { gl, calls, options };
}

test('WebGL completion flushes, yields and polls until the fence signals', async () => {
  const { gl, calls, options } = fixture();
  await waitForWebGLCompletion(gl, options);
  assert.deepEqual(calls, ['fence', 'flush', 'yield', 'poll', 'yield', 'poll', 'delete']);
});

test('already signaled fences still yield and are deleted', async () => {
  const { gl, calls, options } = fixture([4]);
  await waitForWebGLCompletion(gl, options);
  assert.deepEqual(calls, ['fence', 'flush', 'yield', 'poll', 'delete']);
});

test('cancellation, timeout and wait failure clean up the fence', async () => {
  for (const mode of ['cancel', 'timeout', 'failure', 'lost']) {
    const { gl, calls, options } = fixture([mode === 'failure' ? 5 : 2]);
    const controller = new AbortController();
    const yieldTask = options.yieldToBrowser;
    options.yieldToBrowser = async () => {
      await yieldTask();
      if (mode === 'cancel') controller.abort();
      if (mode === 'lost') gl.isContextLost = () => true;
    };
    await assert.rejects(waitForWebGLCompletion(gl, {
      ...options, signal: controller.signal, timeoutMs: 2,
    }), mode === 'cancel' ? { name: 'AbortError' }
      : mode === 'timeout' ? /timed out/ : mode === 'lost' ? /context lost/ : /wait failed/);
    assert.equal(calls.at(-1), 'delete');
  }
});

test('missing fence aborts without reporting completion', async () => {
  const { gl, options } = fixture();
  gl.fenceSync = () => null;
  await assert.rejects(waitForWebGLCompletion(gl, options), /fence unavailable/);
});
