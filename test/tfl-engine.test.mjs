import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeTransientCount,
  addTransientEvent,
  advanceClocks,
  advanceInfluenceDynamics,
  advanceTransientStore,
  applyPreset,
  applySnapshot,
  createClocks,
  createSpatialInfluence,
  createState,
  createTransientStore,
  defaultParams,
  factoryResetState,
  mutate,
  normalizedViewportToSurface,
  PARAM_DEFS,
  PRESET_NAMES,
  randomize,
  resetParameter,
  resetParameters,
  restoreTransientStore,
  SCHEMA_VERSION,
  setParameterLock,
  snapshot,
  snapshotTransientStore,
  smoothState,
  surfaceToNormalizedViewport,
  synchronizeEffectiveParameters,
  TflEngine,
  transactParameters,
  updateSurfaceVelocity,
} from '../packages/tfl-engine/src/index.js';
import { adaptiveTick, createAdaptive } from '../packages/tfl-engine/src/perf.js';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test('parameter schema defaults and explicit state layers start aligned', () => {
  const state = createState();
  assert.deepEqual(state.requested, defaultParams());
  assert.deepEqual(state.target, defaultParams());
  assert.deepEqual(state.current, defaultParams());
  assert.deepEqual(state.effective, defaultParams());
  assert.ok(PRESET_NAMES.length >= 6);
  for (const [name, definition] of Object.entries(PARAM_DEFS)) {
    assert.equal(definition.length, 6, `definition shape: ${name}`);
    const [minimum, maximum, , initial] = definition;
    assert.ok(minimum < maximum && initial >= minimum && initial <= maximum, name);
  }
});

test('parameter transaction reports valid, clamped, unknown and invalid writes', () => {
  const state = createState();
  const report = transactParameters(state, {
    flowSpeed: 1e9,
    exposure: Number.NaN,
    unknown: 2,
  }, { source: 'test' });
  assert.equal(report.ok, false);
  assert.equal(report.changed, true);
  assert.deepEqual(report.accepted.map((entry) => entry.name), ['flowSpeed']);
  assert.equal(report.accepted[0].clamped, true);
  assert.equal(report.accepted[0].value, PARAM_DEFS.flowSpeed[1]);
  assert.deepEqual(report.rejected.map((entry) => entry.reason), [
    'value-must-be-finite-number',
    'unknown-parameter',
  ]);
  assert.equal(state.requested.flowSpeed, PARAM_DEFS.flowSpeed[1]);
  assert.equal(state.target.flowSpeed, PARAM_DEFS.flowSpeed[1]);
  assert.equal(state.current.flowSpeed, PARAM_DEFS.flowSpeed[3]);
  assert.equal(state.preset, 'Custom');
});

test('normal writes and partial transactions strictly respect locks', () => {
  const state = createState();
  transactParameters(state, { exposure: 1.17 }, { transition: 'immediate' });
  assert.equal(setParameterLock(state, 'exposure', true), true);
  const report = transactParameters(state, {
    exposure: 0.4,
    ambient: 0.6,
  }, { source: 'locked-partial' });
  assert.equal(report.ok, true);
  assert.deepEqual(report.accepted.map((entry) => entry.name), ['ambient']);
  assert.deepEqual(report.skipped.map((entry) => entry.name), ['exposure']);
  assert.equal(report.skipped[0].reason, 'locked');
  assert.equal(state.target.exposure, 1.17);
  assert.equal(state.current.exposure, 1.17);
  assert.equal(state.target.ambient, 0.6);
  assert.equal(state.preset, 'Custom');
});

test('presets use the transaction policy and preserve locked values', () => {
  const state = createState();
  for (const name of PRESET_NAMES) {
    const report = applyPreset(state, name);
    assert.equal(report.ok, true);
    assert.equal(report.source, `preset:${name}`);
    for (const [parameter, value] of Object.entries(state.target)) {
      const [minimum, maximum] = PARAM_DEFS[parameter];
      assert.ok(value >= minimum && value <= maximum, `${name}.${parameter}`);
    }
  }
  transactParameters(state, { exposure: 1.17 }, { transition: 'immediate' });
  setParameterLock(state, 'exposure', true);
  const report = applyPreset(state, 'Deep Violet');
  assert.equal(report.skipped.some((entry) => entry.name === 'exposure'), true);
  assert.equal(state.target.exposure, 1.17);
  assert.equal(state.preset, 'Custom');

  const fullyLocked = createState();
  for (const parameter of Object.keys(PARAM_DEFS)) setParameterLock(fullyLocked, parameter, true);
  assert.equal(applyPreset(fullyLocked, 'Oil Slick').changed, false);
  assert.equal(fullyLocked.preset, 'Custom');
  fullyLocked.preset = 'Soap Film';
  mutate(fullyLocked, () => 0.5);
  assert.equal(fullyLocked.preset, 'Custom');
  fullyLocked.preset = 'Soap Film';
  randomize(fullyLocked, () => 0.5);
  assert.equal(fullyLocked.preset, 'Custom');
});

test('mutate and randomize are deterministic with supplied RNG and respect locks', () => {
  const a = createState();
  const b = createState();
  for (const state of [a, b]) {
    transactParameters(state, { exposure: 1.17 }, { transition: 'immediate' });
    setParameterLock(state, 'exposure', true);
    mutate(state, () => 0.9);
    randomize(state, () => 0.01);
  }
  assert.deepEqual(a.target, b.target);
  assert.equal(a.target.exposure, 1.17);
  assert.ok(a.target.ambient >= 0.24);
  for (const [parameter, value] of Object.entries(a.target)) {
    const [minimum, maximum] = PARAM_DEFS[parameter];
    assert.ok(value >= minimum && value <= maximum, `randomize.${parameter}`);
  }
});

test('seeded mutate and randomize replay from identical engine state', () => {
  const a = new TflEngine();
  const b = new TflEngine();
  a.applyPreset('Soap Film', { transition: 'immediate' });
  b.applyPreset('Soap Film', { transition: 'immediate' });
  a.mutate();
  b.mutate();
  a.randomize();
  b.randomize();
  assert.deepEqual(a.state.target, b.state.target);
  assert.deepEqual(a.state.sequences, b.state.sequences);
});

test('reset preserves locks, quality and MSAA; factory reset clears locks', () => {
  const state = createState({ reduceMotion: true });
  transactParameters(state, { exposure: 1.17, flowSpeed: 2.2 }, { transition: 'immediate' });
  setParameterLock(state, 'exposure', true);
  state.quality = 'Ultra';
  state.msaa = 4;
  const report = resetParameters(state);
  assert.equal(report.skipped.some((entry) => entry.name === 'exposure'), true);
  assert.equal(state.target.exposure, 1.17);
  assert.equal(state.target.flowSpeed, 0.9);
  assert.equal(state.quality, 'Ultra');
  assert.equal(state.msaa, 4);
  assert.equal(resetParameter(state, 'flowSpeed').changed, true);
  assert.equal(resetParameter(state, 'exposure').changed, false);

  factoryResetState(state);
  assert.deepEqual(state.locks, {});
  assert.equal(state.target.exposure, PARAM_DEFS.exposure[3]);
  assert.equal(state.target.temporal, 0.35);
});

test('requested, target, current and effective retain distinct meanings', () => {
  const state = createState();
  const report = transactParameters(state, { flowSpeed: 2, renderScale: 1.4 });
  assert.equal(report.changed, true);
  assert.equal(state.requested.flowSpeed, 2);
  assert.equal(state.target.flowSpeed, 2);
  assert.equal(state.current.flowSpeed, 1);
  smoothState(state, 1 / 60);
  assert.ok(state.current.flowSpeed > 1 && state.current.flowSpeed < 2);
  synchronizeEffectiveParameters(state, { renderScale: 0.75 });
  assert.equal(state.effective.flowSpeed, state.current.flowSpeed);
  assert.equal(state.requested.renderScale, 1.4);
  assert.equal(state.effective.renderScale, 0.75);
});

test('configuration snapshots are versioned, validated and migrate v1', () => {
  const state = createState();
  assert.equal(applySnapshot(state, null).ok, false);
  assert.equal(applySnapshot(state, { version: 999, parameters: {} }).ok, false);
  const before = { ...state.target };
  assert.equal(applySnapshot(state, {
    version: SCHEMA_VERSION,
    parameters: { target: { flowSpeed: Number.NaN } },
  }).ok, false);
  assert.deepEqual(state.target, before);

  const legacy = {
    version: 1,
    params: { flowSpeed: 1e9, filmBase: -5, bogus: 3 },
    quality: 'High',
    diag: 'Final',
    msaa: 0,
    adaptive: true,
    targetFps: 60,
    locks: { exposure: true },
    preset: 'Custom',
  };
  const migrated = applySnapshot(state, legacy);
  assert.equal(migrated.ok, true);
  assert.equal(migrated.migrated, true);
  assert.equal(state.target.flowSpeed, PARAM_DEFS.flowSpeed[1]);
  assert.equal(state.target.filmBase, PARAM_DEFS.filmBase[0]);
  assert.equal(state.locks.exposure, true);
  assert.equal(snapshot(state).version, SCHEMA_VERSION);
});

test('snapshot import preserves live locks and leaves clocks and pause unchanged', () => {
  const state = createState();
  transactParameters(state, { exposure: 1.17 }, { transition: 'immediate' });
  setParameterLock(state, 'exposure', true);
  state.paused = true;
  state.clocks.animation = 3;
  const source = createState();
  transactParameters(source, { exposure: 0.4, ambient: 0.6 }, { transition: 'immediate' });
  const result = applySnapshot(state, snapshot(source), { preserveLocks: true });
  assert.equal(result.ok, true);
  assert.equal(result.transaction.skipped.some((entry) => entry.name === 'exposure'), true);
  assert.equal(state.target.exposure, 1.17);
  assert.equal(state.target.ambient, 0.6);
  assert.equal(state.preset, 'Custom');
  assert.equal(state.paused, true);
  assert.equal(state.clocks.animation, 3);
});

test('runtime snapshots explicitly include current/effective/clocks and transients', () => {
  const source = new TflEngine({ eventCapacity: 3 });
  source.applyPreset('Soap Film', { transition: 'immediate' });
  source.setSpatialInfluence(createSpatialInfluence({
    id: 'replay',
    position: { x: 0.2, y: -0.1 },
    velocity: { x: 0.5, y: 0.25 },
    radius: 0.16,
    strength: 0.9,
    engaged: true,
    positionValid: true,
  }));
  source.emitTransientEvent({
    type: 'future-ripple',
    position: { x: -0.1, y: 0.2 },
    radius: 0.2,
    strength: 0.7,
    lifetime: 2,
  });
  source.advance(0.25);

  const configuration = source.createSnapshot();
  assert.equal('runtime' in configuration, false);
  const runtime = source.createSnapshot({ includeRuntime: true });
  assert.equal(runtime.runtime.current.flowSpeed, source.state.current.flowSpeed);
  assert.equal(runtime.runtime.effective.renderScale, source.state.effective.renderScale);
  assert.equal(runtime.runtime.clocks.animation, source.state.clocks.animation);
  assert.equal(runtime.runtime.transients.entries.length, 3);

  const restored = new TflEngine({ eventCapacity: 1 });
  const result = restored.restoreSnapshot(runtime, { restoreRuntime: true });
  assert.equal(result.ok, true);
  assert.deepEqual(restored.createSnapshot({ includeRuntime: true }), runtime);

  const invalid = structuredClone(runtime);
  invalid.runtime.current.flowSpeed = Infinity;
  const untouched = restored.createSnapshot({ includeRuntime: true });
  assert.equal(restored.restoreSnapshot(invalid, { restoreRuntime: true }).ok, false);
  assert.deepEqual(restored.createSnapshot({ includeRuntime: true }), untouched);
});

test('canonical coordinates use a centered, y-up, viewport-height space', () => {
  assert.deepEqual(normalizedViewportToSurface(0.5, 0.5, 2), { x: 0, y: 0 });
  assert.deepEqual(normalizedViewportToSurface(0, 0, 2), { x: -1, y: 0.5 });
  assert.deepEqual(normalizedViewportToSurface(1, 1, 2), { x: 1, y: -0.5 });
  assert.deepEqual(normalizedViewportToSurface(0, 0, 0.5), { x: -0.25, y: 0.5 });
  assert.ok(normalizedViewportToSurface(0.5, 0.25, 1).y > 0);
});

test('coordinate conversion round-trips in portrait and landscape', () => {
  for (const aspect of [0.5, 1, 2.4]) {
    for (const point of [[0, 0], [0.2, 0.8], [0.5, 0.5], [1, 1]]) {
      const surface = normalizedViewportToSurface(point[0], point[1], aspect);
      const normalized = surfaceToNormalizedViewport(surface, aspect);
      close(normalized.x, point[0]);
      close(normalized.y, point[1]);
    }
  }
});

test('coordinates depend on logical viewport ratio, not drawing-buffer scale', () => {
  const fromLogicalSize = (px, py, width, height) => (
    normalizedViewportToSurface(px / width, py / height, width / height)
  );
  const css = fromLogicalSize(600, 150, 1200, 600);
  const doubledBuffer = fromLogicalSize(1200, 300, 2400, 1200);
  assert.deepEqual(css, doubledBuffer);
});

test('equal physical x/y movement has aspect-independent canonical direction', () => {
  const landscapeA = normalizedViewportToSurface(0.5, 0.5, 2);
  const landscapeB = normalizedViewportToSurface(0.55, 0.4, 2);
  const portraitA = normalizedViewportToSurface(0.5, 0.5, 0.5);
  const portraitB = normalizedViewportToSurface(0.7, 0.4, 0.5);
  close(landscapeB.x - landscapeA.x, 0.1);
  close(landscapeB.y - landscapeA.y, 0.1);
  close(portraitB.x - portraitA.x, 0.1);
  close(portraitB.y - portraitA.y, 0.1);
});

function simulateVelocity(frequency, duration = 0.5, speed = { x: 1.2, y: -0.4 }) {
  const dt = 1 / frequency;
  let velocity = { x: 0, y: 0 };
  let previous = { x: 0, y: 0 };
  for (let index = 1; index <= Math.round(duration * frequency); index++) {
    const current = { x: speed.x * index * dt, y: speed.y * index * dt };
    velocity = updateSurfaceVelocity(velocity, previous, current, dt);
    previous = current;
  }
  return velocity;
}

test('velocity estimation is time-based and event-frequency independent', () => {
  const at30 = simulateVelocity(30);
  const at120 = simulateVelocity(120);
  close(at30.x, at120.x, 1e-10);
  close(at30.y, at120.y, 1e-10);
  close(at30.x, 1.2, 1e-6);
  close(at30.y, -0.4, 1e-6);
});

test('velocity smoothing, clamp and zero-dt protection are explicit', () => {
  const smoothed = updateSurfaceVelocity({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.05, y: 0 }, 1 / 60);
  close(smoothed.x, 3 * 0.42);
  const clamped = updateSurfaceVelocity(
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 3, y: 4 },
    1,
    { responseRate: 1e9, minimumDt: 1, maximumDt: 1, maximumSpeed: 2 },
  );
  close(clamped.x, 1.2);
  close(clamped.y, 1.6);
  assert.deepEqual(
    updateSurfaceVelocity({ x: 0.3, y: -0.2 }, { x: 0, y: 0 }, { x: 1, y: 1 }, 0),
    { x: 0.3, y: -0.2 },
  );
  const tiny = updateSurfaceVelocity(
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    1e-12,
    { maximumSpeed: 3 },
  );
  assert.ok(Number.isFinite(tiny.x) && Math.hypot(tiny.x, tiny.y) <= 3);
});

test('continuous influence release is deterministic and independent of engine pause', () => {
  const influence = createSpatialInfluence({
    velocity: { x: 1, y: -0.5 },
    strength: 0.9,
    engaged: false,
  });
  const a = structuredClone(influence);
  const b = structuredClone(influence);
  advanceInfluenceDynamics(a, 0.2, { targetStrength: 0 });
  advanceInfluenceDynamics(b, 0.1, { targetStrength: 0 });
  advanceInfluenceDynamics(b, 0.1, { targetStrength: 0 });
  close(a.velocity.x, b.velocity.x);
  close(a.velocity.y, b.velocity.y);
  assert.ok(a.strength < influence.strength);
  assert.ok(a.velocity.x < influence.velocity.x);
});

test('clocks advance deterministically, pause, resume and subdivide equivalently', () => {
  const parameters = { temporal: 0.8, flowSpeed: 1.25, lightMotion: 0.3 };
  const whole = createClocks();
  const split = createClocks();
  advanceClocks(whole, 1, parameters);
  for (let index = 0; index < 10; index++) advanceClocks(split, 0.1, parameters);
  for (const name of Object.keys(whole)) close(whole[name], split[name]);
  const paused = { ...whole };
  advanceClocks(whole, 2, parameters, { paused: true });
  assert.deepEqual(whole, paused);
  advanceClocks(whole, 0.5, parameters);
  close(whole.animation, paused.animation + 0.4);
  close(whole.events, paused.events + 0.5);
});

test('transient store uses inactive slots first and evicts oldest allocation', () => {
  const store = createTransientStore(2);
  const event = (type, lifetime = 2) => ({
    type,
    position: { x: 0, y: 0 },
    radius: 0.2,
    strength: 1,
    lifetime,
  });
  assert.equal(addTransientEvent(store, event('invalid', 0)).accepted, false);
  assert.equal(activeTransientCount(store), 0);
  assert.equal(addTransientEvent(store, event('a')).slot, 0);
  assert.equal(addTransientEvent(store, event('b')).slot, 1);
  const third = addTransientEvent(store, event('c', 0.5));
  assert.equal(third.slot, 0);
  assert.equal(third.evicted.type, 'a');
  assert.equal(activeTransientCount(store), 2);
  advanceTransientStore(store, 0.5);
  assert.equal(store.entries[0].active, false);
  assert.equal(activeTransientCount(store), 1);
  assert.equal(addTransientEvent(store, event('d')).slot, 0);
});

test('transient aging has deterministic lifetime and pause policy', () => {
  const make = () => {
    const store = createTransientStore(2);
    addTransientEvent(store, {
      type: 'test',
      position: { x: 0.1, y: -0.2 },
      radius: 0.3,
      strength: 0.8,
      lifetime: 1,
    });
    return store;
  };
  const a = make();
  const b = make();
  advanceTransientStore(a, 0.25);
  advanceTransientStore(a, 0.75);
  advanceTransientStore(b, 1);
  assert.deepEqual(a, b);
  const paused = make();
  advanceTransientStore(paused, 2, { paused: true });
  assert.equal(paused.entries[0].age, 0);
  const restored = restoreTransientStore(snapshotTransientStore(paused));
  assert.deepEqual(restored, paused);
});

test('same state, seed, dt, transactions, influence and events replay identically', () => {
  const run = () => {
    const engine = new TflEngine({ eventCapacity: 4 });
    engine.applyPreset('Soap Film', { transition: 'immediate' });
    engine.setParameters({ flowSpeed: 1.25, exposure: 1.1 }, { source: 'replay' });
    engine.mutate();
    engine.setSpatialInfluence(createSpatialInfluence({
      id: 'source-a',
      position: { x: 0.1, y: 0.2 },
      velocity: { x: 0.5, y: -0.25 },
      radius: 0.16,
      strength: 0.9,
      engaged: true,
      positionValid: true,
    }));
    engine.emitTransientEvent({
      type: 'future',
      position: { x: -0.2, y: 0.1 },
      radius: 0.1,
      strength: 0.5,
      lifetime: 3,
    });
    for (const dt of [1 / 60, 1 / 30, 0.01, 0.025]) engine.advance(dt);
    return engine.createSnapshot({ includeRuntime: true });
  };
  assert.deepEqual(run(), run());
});

test('engine pause freezes clocks/events while parameter smoothing remains compatible', () => {
  const engine = new TflEngine();
  engine.setParameters({ flowSpeed: 2 });
  engine.emitTransientEvent({
    position: { x: 0, y: 0 },
    radius: 0.1,
    strength: 1,
    lifetime: 2,
  });
  engine.setPaused(true);
  engine.advance(0.5);
  assert.equal(engine.state.clocks.animation, 0);
  assert.equal(engine.events.entries[0].age, 0);
  assert.ok(engine.state.current.flowSpeed > 1);
  engine.setPaused(false);
  engine.advance(0.25);
  assert.ok(engine.state.clocks.animation > 0);
  assert.equal(engine.events.entries[0].age, 0.25);
});

test('source-neutral public API imports and runs without DOM globals', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const api = await import('../packages/tfl-engine/src/index.js');
  assert.equal(typeof api.TflEngine, 'function');
  const engine = new api.TflEngine();
  assert.equal(engine.backend, 'unattached');
  assert.equal(engine.advance(1 / 60), true);
  assert.equal(engine.setSpatialInfluence({ bad: true }).accepted, false);
});

test('smoothing converges and adaptive scale descends then recovers', () => {
  const state = createState();
  transactParameters(state, { flowSpeed: 2 });
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
