import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySnapshot,
  createState,
  defaultParams,
  factoryResetState,
  PARAM_DEFS,
  resetParameter,
  setParameter,
  setParameterLock,
  smoothState,
  snapshot,
} from '../packages/tfl-engine/src/state.js';
import {
  applyPreset, mutate, PRESET_NAMES, randomize, resetParameters,
} from '../packages/tfl-engine/src/presets.js';
import { adaptiveTick, createAdaptive } from '../packages/tfl-engine/src/perf.js';

test('parameter schema defaults and clamping remain valid', () => {
  assert.deepEqual(createState().target, defaultParams());
  assert.ok(PRESET_NAMES.length >= 6);
  for (const [name, definition] of Object.entries(PARAM_DEFS)) {
    assert.equal(definition.length, 6, `definition shape: ${name}`);
    const [minimum, maximum, , initial] = definition;
    assert.ok(minimum < maximum && initial >= minimum && initial <= maximum, name);
  }
  const state = createState();
  assert.equal(setParameter(state, 'flowSpeed', 1e9), true);
  assert.equal(state.target.flowSpeed, PARAM_DEFS.flowSpeed[1]);
  assert.equal(setParameter(state, 'unknown', 2), false);
});

test('snapshots validate, clamp, round-trip locks, and preserve live locks on import', () => {
  const state = createState();
  assert.equal(applySnapshot(state, null), false);
  assert.equal(applySnapshot(state, { version: 999, params: {} }), false);
  assert.equal(applySnapshot(state, {
    version: 1,
    params: { flowSpeed: 1e9, filmBase: -5, bogus: 3 },
  }), true);
  assert.equal(state.target.flowSpeed, PARAM_DEFS.flowSpeed[1]);
  assert.equal(state.target.filmBase, PARAM_DEFS.filmBase[0]);
  assert.equal('bogus' in snapshot(state).params, false);

  state.target.exposure = 1.17;
  setParameterLock(state, 'exposure', true);
  const restored = createState();
  assert.equal(applySnapshot(restored, snapshot(state)), true);
  assert.equal(restored.locks.exposure, true);

  const imported = snapshot(createState());
  imported.params.exposure = 0.4;
  assert.equal(applySnapshot(state, imported, { preserveLocks: true }), true);
  assert.equal(state.target.exposure, 1.17);
  assert.equal(state.preset, 'Custom');
});

test('presets, mutate, randomize and reset respect locks and bounds', () => {
  const state = createState();
  for (const name of PRESET_NAMES) {
    assert.equal(applyPreset(state, name), true);
    for (const [parameter, value] of Object.entries(state.target)) {
      const [minimum, maximum] = PARAM_DEFS[parameter];
      assert.ok(value >= minimum && value <= maximum, `${name}.${parameter}`);
    }
  }

  state.target.exposure = 1.17;
  setParameterLock(state, 'exposure', true);
  applyPreset(state, 'Deep Violet');
  assert.equal(state.target.exposure, 1.17);
  mutate(state, () => 0.9);
  assert.equal(state.target.exposure, 1.17);
  randomize(state, () => 0.01);
  assert.equal(state.target.exposure, 1.17);
  assert.ok(state.target.ambient >= 0.24);
  for (const [parameter, value] of Object.entries(state.target)) {
    const [minimum, maximum] = PARAM_DEFS[parameter];
    assert.ok(value >= minimum && value <= maximum, `randomize.${parameter}`);
  }

  state.quality = 'Ultra';
  state.msaa = 4;
  state.preset = 'Deep Violet';
  state.target.flowSpeed = 2.2;
  resetParameters(state);
  assert.equal(state.target.exposure, 1.17);
  assert.equal(state.target.flowSpeed, 0.9);
  assert.equal(state.quality, 'Ultra');
  assert.equal(state.msaa, 4);
  state.preset = 'Soap Film';
  assert.equal(resetParameter(state, 'flowSpeed'), true);
  assert.equal(state.preset, 'Soap Film');
  assert.equal(resetParameter(state, 'exposure'), false);
});

test('factory reset clears locks and honors reduced motion', () => {
  const state = createState({ reduceMotion: true });
  state.locks.exposure = true;
  state.target.exposure = 2;
  factoryResetState(state);
  assert.deepEqual(state.locks, {});
  assert.equal(state.target.exposure, PARAM_DEFS.exposure[3]);
  assert.equal(state.target.temporal, 0.35);
});

test('smoothing converges and adaptive scale descends then recovers', () => {
  const state = createState();
  state.target.flowSpeed = 2;
  for (let index = 0; index < 600; index++) smoothState(state, 1 / 60);
  assert.ok(Math.abs(state.current.flowSpeed - 2) < 1e-3);

  const adaptive = createAdaptive();
  const config = { enabled: true, targetFps: 60, manualQuality: 'High', manualScale: 1 };
  let time = 1000;
  let action = null;
  for (let window = 0; window < 3; window++) {
    time += 2600;
    action = adaptiveTick(adaptive, 20, time, config);
  }
  assert.ok(action && action.scale < 1);
  for (let window = 0; window < 40; window++) {
    time += 6000;
    adaptiveTick(adaptive, 20, time, config);
  }
  for (let window = 0; window < 40; window++) {
    time += 6000;
    adaptiveTick(adaptive, 60, time, config);
  }
  assert.equal(adaptive.stepIndex, 0);
});
