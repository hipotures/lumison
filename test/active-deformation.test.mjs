import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_DEFORMATION_CALIBRATION,
  activeDeformationDisplacementAt,
  advanceActiveDeformation,
  canonicalInfluenceToFixed,
  createActiveDeformationState,
  createSpatialInfluence,
  setParameterLock,
  TflEngine,
} from '../packages/tfl-engine/src/index.js';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

const activeInfluence = (overrides = {}) => createSpatialInfluence({
  id: 'active-source',
  position: { x: 0.1, y: -0.15 },
  velocity: { x: 0, y: 0 },
  strength: 1.55,
  engaged: true,
  positionValid: true,
  ...overrides,
});

function settle(configuration, influence, seconds = 1) {
  const state = createActiveDeformationState(configuration);
  for (let index = 0; index < seconds * 120; index++) {
    advanceActiveDeformation(state, influence, 1 / 120);
  }
  return state;
}

test('active press is zero for an inactive influence', () => {
  const state = createActiveDeformationState({ pressEnabled: true });
  advanceActiveDeformation(state, activeInfluence({
    engaged: false,
    strength: 1.55,
  }), 1);
  assert.equal(state.sourceAmplitude, 0);
  assert.equal(state.pressDisplacement, 0);
  assert.equal(state.pressEffectiveStrength, 0);
});

test('active press strength follows canonical active amplitude', () => {
  const half = settle(
    { pressEnabled: true },
    activeInfluence({ strength: ACTIVE_DEFORMATION_CALIBRATION.fullAmplitude / 2 }),
  );
  const full = settle({ pressEnabled: true }, activeInfluence());
  assert.ok(half.pressEffectiveStrength > 0);
  close(full.pressEffectiveStrength / half.pressEffectiveStrength, 2, 1e-6);
  close(full.pressDisplacement, ACTIVE_DEFORMATION_CALIBRATION.maximumPressDisplacement, 1e-8);
});

test('positive and negative press gain explicitly reverse radial displacement', () => {
  const sample = { x: 0.2, y: -0.15 };
  const inward = settle({ pressEnabled: true, pressGain: 1 }, activeInfluence());
  const outward = settle({ pressEnabled: true, pressGain: -1 }, activeInfluence());
  const inwardAtSample = activeDeformationDisplacementAt(inward, sample);
  const outwardAtSample = activeDeformationDisplacementAt(outward, sample);
  assert.ok(inwardAtSample.x < 0);
  assert.ok(outwardAtSample.x > 0);
  close(inwardAtSample.x, -outwardAtSample.x, 1e-8);
  close(inwardAtSample.y, 0);
  close(outwardAtSample.y, 0);
});

test('active drag magnitude uses canonical velocity and increases with speed', () => {
  const slow = settle(
    { dragEnabled: true },
    activeInfluence({ velocity: { x: 0.3, y: 0 } }),
  );
  const fast = settle(
    { dragEnabled: true },
    activeInfluence({ velocity: { x: 1.2, y: 0 } }),
  );
  assert.ok(slow.dragEffectiveStrength > 0);
  assert.ok(fast.dragEffectiveStrength > slow.dragEffectiveStrength);
  assert.ok(fast.dragEffectiveStrength <= ACTIVE_DEFORMATION_CALIBRATION.maximumDragDisplacement);
});

test('active drag vector follows horizontal, vertical and diagonal velocity direction', () => {
  for (const velocity of [
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
  ]) {
    const state = settle({ dragEnabled: true }, activeInfluence({ velocity }));
    const speed = Math.hypot(velocity.x, velocity.y);
    const displacement = state.dragDisplacement;
    const magnitude = Math.hypot(displacement.x, displacement.y);
    close(displacement.x / magnitude, velocity.x / speed, 1e-8);
    close(displacement.y / magnitude, velocity.y / speed, 1e-8);
  }
});

test('opposite canonical velocity produces the opposite drag vector', () => {
  const forward = settle(
    { dragEnabled: true },
    activeInfluence({ velocity: { x: 0.8, y: -0.4 } }),
  );
  const reverse = settle(
    { dragEnabled: true },
    activeInfluence({ velocity: { x: -0.8, y: 0.4 } }),
  );
  close(forward.dragDisplacement.x, -reverse.dragDisplacement.x, 1e-8);
  close(forward.dragDisplacement.y, -reverse.dragDisplacement.y, 1e-8);
  const sampleOffset = activeDeformationDisplacementAt(forward, forward.position);
  assert.ok(Math.sign(sampleOffset.x) === -Math.sign(forward.dragDisplacement.x));
  assert.ok(Math.sign(sampleOffset.y) === -Math.sign(forward.dragDisplacement.y));
});

test('constant active input produces equivalent response under dt subdivision', () => {
  const influence = activeInfluence({ velocity: { x: 0.9, y: -0.3 } });
  const whole = createActiveDeformationState({ pressEnabled: true, dragEnabled: true });
  const split = createActiveDeformationState({ pressEnabled: true, dragEnabled: true });
  advanceActiveDeformation(whole, influence, 0.5);
  for (let index = 0; index < 60; index++) {
    advanceActiveDeformation(split, influence, 0.5 / 60);
  }
  close(whole.pressDisplacement, split.pressDisplacement);
  close(whole.dragDisplacement.x, split.dragDisplacement.x);
  close(whole.dragDisplacement.y, split.dragDisplacement.y);
});

test('active press and drag decay smoothly after release', () => {
  const state = settle(
    { pressEnabled: true, dragEnabled: true },
    activeInfluence({ velocity: { x: 1, y: 0.2 } }),
    0.4,
  );
  const press = state.pressEffectiveStrength;
  const drag = state.dragEffectiveStrength;
  const released = activeInfluence({ engaged: false, strength: 0, velocity: { x: 0, y: 0 } });
  advanceActiveDeformation(state, released, 0.1);
  assert.ok(state.pressEffectiveStrength > 0 && state.pressEffectiveStrength < press);
  assert.ok(state.dragEffectiveStrength > 0 && state.dragEffectiveStrength < drag);
  for (let index = 0; index < 30; index++) advanceActiveDeformation(state, released, 0.1);
  assert.equal(state.pressEffectiveStrength, 0);
  assert.equal(state.dragEffectiveStrength, 0);
});

test('active radius and gains validate without corrupting rejected settings', () => {
  const engine = new TflEngine();
  const report = engine.setActiveDeformation({
    pressGain: -3,
    dragGain: -0.1,
    radius: Infinity,
    pressEnabled: 'yes',
    legacyFixedEnabled: 1,
    pointerButton: 0,
  });
  assert.equal(report.ok, false);
  assert.equal(report.accepted.length, 0);
  assert.deepEqual(report.rejected.map((entry) => entry.reason), [
    'value-out-of-range',
    'value-out-of-range',
    'value-must-be-finite-number',
    'value-must-be-boolean',
    'value-must-be-boolean',
    'unknown-active-deformation-setting',
  ]);
  assert.deepEqual(engine.getActiveDeformationConfiguration(), {
    legacyFixedEnabled: true,
    pressEnabled: false,
    pressGain: 1,
    dragEnabled: false,
    dragGain: 1,
    radius: 0.19,
  });
});

test('passive, active and legacy Fixed controls remain independent', () => {
  const engine = new TflEngine();
  engine.setMotionWarp({ enabled: true, gain: 1.4, radius: 0.24 });
  engine.setActiveDeformation({
    legacyFixedEnabled: false,
    pressEnabled: true,
    pressGain: -0.75,
    dragEnabled: true,
    dragGain: 1.25,
    radius: 0.31,
  });
  assert.deepEqual(engine.getMotionWarpConfiguration(), {
    enabled: true,
    gain: 1.4,
    radius: 0.24,
  });
  assert.deepEqual(engine.getActiveDeformationConfiguration(), {
    legacyFixedEnabled: false,
    pressEnabled: true,
    pressGain: -0.75,
    dragEnabled: true,
    dragGain: 1.25,
    radius: 0.31,
  });
  engine.setMotionWarp({ enabled: false });
  assert.equal(engine.getActiveDeformationConfiguration().pressEnabled, true);
  engine.setActiveDeformation({ pressEnabled: false, dragEnabled: false });
  assert.equal(engine.getMotionWarpConfiguration().enabled, false);
});

test('default configuration preserves the Phase 3A and legacy Fixed path', () => {
  let rendered = null;
  const renderHost = {
    backend: 'test',
    hasGpu: () => false,
    render(payload) { rendered = structuredClone(payload); return { aspect: 1.5 }; },
    consumeBackendChange: () => null,
    diagnostics: () => ({
      backend: 'test', bufferWidth: null, bufferHeight: null, ratio: null, stats: null,
    }),
  };
  const engine = new TflEngine({ renderHost });
  engine.setSpatialInfluence(activeInfluence({ velocity: { x: 1, y: -0.5 } }));
  engine.advance(0.5);
  engine.render();
  assert.equal(rendered.activeDeformation.legacyFixedEnabled, true);
  assert.equal(rendered.activeDeformation.pressEnabled, false);
  assert.equal(rendered.activeDeformation.dragEnabled, false);
  assert.equal(rendered.activeDeformation.pressDisplacement, 0);
  assert.deepEqual(rendered.activeDeformation.dragDisplacement, { x: 0, y: 0 });

  const fixedEnabled = canonicalInfluenceToFixed(engine.influence, 1.5);
  const fixedDisabled = canonicalInfluenceToFixed(engine.influence, 1.5, { enabled: false });
  assert.ok(fixedEnabled.strength > 0);
  assert.notEqual(fixedEnabled.vx, 0);
  assert.equal(fixedDisabled.strength, 0);
  assert.equal(fixedDisabled.vx, 0);
  assert.equal(fixedDisabled.vy, 0);
});

test('equal active influence and dt sequences replay and restore deterministically', () => {
  const run = () => {
    const engine = new TflEngine();
    engine.setActiveDeformation({
      legacyFixedEnabled: false,
      pressEnabled: true,
      pressGain: 1.2,
      dragEnabled: true,
      dragGain: 1.4,
      radius: 0.23,
    });
    for (const [influence, dt] of [
      [activeInfluence({ strength: 0.9, velocity: { x: 0, y: 0 } }), 1 / 60],
      [activeInfluence({ velocity: { x: 1.1, y: -0.2 } }), 1 / 30],
      [activeInfluence({ velocity: { x: -0.4, y: 0.7 } }), 0.025],
      [activeInfluence({ engaged: false, strength: 0 }), 0.1],
    ]) {
      engine.setSpatialInfluence(influence);
      engine.advance(dt);
    }
    return engine.createSnapshot({ includeRuntime: true });
  };

  const snapshot = run();
  assert.deepEqual(snapshot, run());
  const restored = new TflEngine();
  assert.equal(restored.restoreSnapshot(snapshot, { restoreRuntime: true }).ok, true);
  assert.deepEqual(restored.createSnapshot({ includeRuntime: true }), snapshot);

  const invalid = structuredClone(snapshot);
  invalid.runtime.activeDeformation.dragEffectiveStrength += 0.1;
  const before = restored.createSnapshot({ includeRuntime: true });
  assert.equal(restored.restoreSnapshot(invalid, { restoreRuntime: true }).ok, false);
  assert.deepEqual(restored.createSnapshot({ includeRuntime: true }), before);
});

test('active configuration does not mutate scene parameters, locks or presets', () => {
  const engine = new TflEngine();
  engine.applyPreset('Deep Violet', { transition: 'immediate' });
  engine.setParameter('exposure', 1.17);
  setParameterLock(engine.state, 'exposure', true);
  const parameters = structuredClone(engine.state.target);
  const locks = structuredClone(engine.state.locks);
  const preset = engine.state.preset;

  engine.setActiveDeformation({
    legacyFixedEnabled: false,
    pressEnabled: true,
    dragEnabled: true,
    radius: 0.27,
  });
  engine.setSpatialInfluence(activeInfluence({ velocity: { x: 1, y: 0 } }));
  engine.advance(0.2);
  assert.deepEqual(engine.state.target, parameters);
  assert.deepEqual(engine.state.locks, locks);
  assert.equal(engine.state.preset, preset);

  engine.factoryReset();
  assert.deepEqual(engine.getActiveDeformationConfiguration(), {
    legacyFixedEnabled: true,
    pressEnabled: false,
    pressGain: 1,
    dragEnabled: false,
    dragGain: 1,
    radius: 0.19,
  });
});
