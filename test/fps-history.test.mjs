import assert from 'node:assert/strict';
import test from 'node:test';
import { createFpsHistory, FPS_HISTORY_CAPACITY } from '../apps/tfl-lab/src/fps-history.js';

test('FPS history samples once per second from presented frames', () => {
  const history = createFpsHistory();
  assert.equal(history.frame(0), false);
  for (let frame = 1; frame < 60; frame++) {
    assert.equal(history.frame(frame * 1000 / 60), false);
  }
  assert.equal(history.frame(1000), true);
  assert.deepEqual(history.samples, [60]);
  assert.equal(history.frame(1010), false);
});

test('FPS history retains only the latest 120 samples in chronological order', () => {
  const history = createFpsHistory();
  history.frame(0);
  for (let second = 1; second <= 125; second++) {
    for (let frame = 1; frame <= second; frame++) {
      history.frame((second - 1) * 1000 + frame * 1000 / second);
    }
  }
  assert.equal(history.samples.length, FPS_HISTORY_CAPACITY);
  assert.equal(history.samples[0], 6);
  assert.equal(history.samples.at(-1), 125);
});

test('delayed frames do not fabricate samples and suspension preserves history', () => {
  const history = createFpsHistory();
  history.frame(0);
  assert.equal(history.frame(2500), true);
  assert.deepEqual(history.samples, [0.4]);
  history.suspend();
  assert.equal(history.frame(10000), false);
  assert.equal(history.frame(NaN), false);
  assert.equal(history.frame(11000), true);
  assert.deepEqual(history.samples, [0.4, 1]);
});
