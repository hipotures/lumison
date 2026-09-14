import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COORDINATE_SHEAR_CALIBRATION,
  advanceCoordinateShear,
  coordinateShearDisplacementAt,
  createCoordinateShearState,
  createSpatialInfluence,
  setParameterLock,
  TflEngine,
} from '../packages/tfl-engine/src/index.js';

const RADIUS = 0.19;
const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

const activeInfluence = (overrides = {}) => createSpatialInfluence({
  id: 'shear-source',
  position: { x: 0.1, y: -0.15 },
  velocity: { x: 0, y: 0 },
  strength: 1.55,
  engaged: true,
  positionValid: true,
  ...overrides,
});

function settle(configuration, influence, seconds = 1) {
  const state = createCoordinateShearState(configuration);
  for (let index = 0; index < seconds * 120; index++) {
    advanceCoordinateShear(state, influence, 1 / 120);
  }
  return state;
}

test('zero canonical velocity produces zero coordinate shear', () => {
  const state = settle({ enabled: true }, activeInfluence());
  assert.deepEqual(state.displacement, { x: 0, y: 0 });
  assert.equal(state.effectiveStrength, 0);
  assert.deepEqual(
    coordinateShearDisplacementAt(state, { x: 0.1, y: 0 }, RADIUS),
    { x: 0, y: 0 },
  );
});

test('subnormal velocity cannot create an unstable shear transform', () => {
  const state = createCoordinateShearState({ enabled: true });
  const influence = activeInfluence({
    velocity: { x: Number.MIN_VALUE, y: -Number.MIN_VALUE },
  });
  advanceCoordinateShear(state, influence, 1);
  assert.deepEqual(state.displacement, { x: 0, y: 0 });
  assert.equal(state.effectiveStrength, 0);
});

test('zero shear gain is an exact identity transform', () => {
  const state = settle(
    { enabled: true, gain: 0 },
    activeInfluence({ velocity: { x: 1.2, y: -0.4 } }),
  );
  assert.equal(state.effectiveStrength, 0);
  for (const position of [
    state.position,
    { x: state.position.x + RADIUS, y: state.position.y },
    { x: state.position.x, y: state.position.y + RADIUS },
  ]) {
    assert.deepEqual(coordinateShearDisplacementAt(state, position, RADIUS), { x: 0, y: 0 });
  }
});

test('horizontal, vertical and diagonal drags orient the off-diagonal shear', () => {
  const horizontal = settle(
    { enabled: true },
    activeInfluence({ velocity: { x: 1, y: 0 } }),
  );
  const horizontalOffset = coordinateShearDisplacementAt(horizontal, {
    x: horizontal.position.x,
    y: horizontal.position.y + RADIUS / 2,
  }, RADIUS);
  assert.ok(horizontalOffset.x < 0);
  close(horizontalOffset.y, 0);

  const vertical = settle(
    { enabled: true },
    activeInfluence({ velocity: { x: 0, y: 1 } }),
  );
  const verticalOffset = coordinateShearDisplacementAt(vertical, {
    x: vertical.position.x + RADIUS / 2,
    y: vertical.position.y,
  }, RADIUS);
  close(verticalOffset.x, 0);
  assert.ok(verticalOffset.y < 0);

  const diagonal = settle(
    { enabled: true },
    activeInfluence({ velocity: { x: 1, y: -1 } }),
  );
  close(
    diagonal.displacement.x / diagonal.effectiveStrength,
    Math.SQRT1_2,
    1e-8,
  );
  close(
    diagonal.displacement.y / diagonal.effectiveStrength,
    -Math.SQRT1_2,
    1e-8,
  );
  const diagonalOffset = coordinateShearDisplacementAt(diagonal, {
    x: diagonal.position.x + RADIUS / 3,
    y: diagonal.position.y + RADIUS / 3,
  }, RADIUS);
  assert.notEqual(diagonalOffset.x, 0);
  assert.notEqual(diagonalOffset.y, 0);
  assert.notEqual(Math.sign(diagonalOffset.x), Math.sign(diagonalOffset.y));
});

test('opposite drag direction reverses the coordinate transform', () => {
  const velocity = { x: 0.8, y: -0.45 };
  const forward = settle({ enabled: true }, activeInfluence({ velocity }));
  const reverse = settle({ enabled: true }, activeInfluence({
    velocity: { x: -velocity.x, y: -velocity.y },
  }));
  close(forward.displacement.x, -reverse.displacement.x, 1e-8);
  close(forward.displacement.y, -reverse.displacement.y, 1e-8);

  const sample = {
    x: forward.position.x + RADIUS * 0.35,
    y: forward.position.y - RADIUS * 0.4,
  };
  const a = coordinateShearDisplacementAt(forward, sample, RADIUS);
  const b = coordinateShearDisplacementAt(reverse, sample, RADIUS);
  close(a.x, -b.x, 1e-8);
  close(a.y, -b.y, 1e-8);
});

test('Gaussian locality reduces shear outside the interaction radius', () => {
  const state = settle(
    { enabled: true },
    activeInfluence({ velocity: { x: 1, y: 0 } }),
  );
  const inner = coordinateShearDisplacementAt(state, {
    x: state.position.x,
    y: state.position.y + RADIUS / 2,
  }, RADIUS);
  const outer = coordinateShearDisplacementAt(state, {
    x: state.position.x,
    y: state.position.y + RADIUS * 2,
  }, RADIUS);
  assert.ok(Math.abs(inner.x) > Math.abs(outer.x) * 10);
  close(inner.y, 0);
  close(outer.y, 0);
});

test('coordinate shear stays finite at its center and radius edge', () => {
  const state = settle(
    { enabled: true, gain: 2 },
    activeInfluence({ velocity: { x: 10, y: 10 } }),
  );
  const center = coordinateShearDisplacementAt(state, state.position, RADIUS);
  const edge = coordinateShearDisplacementAt(state, {
    x: state.position.x,
    y: state.position.y + RADIUS,
  }, RADIUS);
  assert.deepEqual(center, { x: 0, y: 0 });
  assert.ok(Number.isFinite(edge.x) && Number.isFinite(edge.y));
  assert.ok(Math.hypot(edge.x, edge.y) <= state.effectiveStrength);
  assert.ok(state.effectiveStrength <= COORDINATE_SHEAR_CALIBRATION.maximumDisplacement * 2);
});

test('equal influence and dt sequences evolve deterministically', () => {
  const run = () => {
    const state = createCoordinateShearState({ enabled: true, gain: 1.4 });
    for (const [influence, dt] of [
      [activeInfluence({ velocity: { x: 0.7, y: 0 } }), 1 / 60],
      [activeInfluence({ velocity: { x: 1.1, y: -0.3 } }), 1 / 30],
      [activeInfluence({ velocity: { x: -0.4, y: 0.8 } }), 0.025],
      [activeInfluence({ engaged: false, strength: 0 }), 0.1],
    ]) advanceCoordinateShear(state, influence, dt);
    return state;
  };
  assert.deepEqual(run(), run());
});

test('constant shear input is equivalent under dt subdivision', () => {
  const influence = activeInfluence({ velocity: { x: 0.9, y: -0.3 } });
  const whole = createCoordinateShearState({ enabled: true });
  const split = createCoordinateShearState({ enabled: true });
  advanceCoordinateShear(whole, influence, 0.5);
  for (let index = 0; index < 60; index++) {
    advanceCoordinateShear(split, influence, 0.5 / 60);
  }
  close(whole.displacement.x, split.displacement.x);
  close(whole.displacement.y, split.displacement.y);
});

test('coordinate shear releases smoothly after active motion stops', () => {
  const state = settle(
    { enabled: true },
    activeInfluence({ velocity: { x: 1, y: 0.3 } }),
    0.4,
  );
  const driven = state.effectiveStrength;
  const released = activeInfluence({
    engaged: false,
    strength: 0,
    velocity: { x: 0, y: 0 },
  });
  advanceCoordinateShear(state, released, 0.1);
  assert.ok(state.effectiveStrength > 0 && state.effectiveStrength < driven);
  for (let index = 0; index < 30; index++) {
    advanceCoordinateShear(state, released, 0.1);
  }
  assert.equal(state.effectiveStrength, 0);
  assert.deepEqual(state.displacement, { x: 0, y: 0 });
});

test('shear validation rejects bad settings without corrupting configuration', () => {
  const engine = new TflEngine();
  const report = engine.setCoordinateShear({
    enabled: 'yes',
    gain: 3,
    radius: 0.4,
  });
  assert.equal(report.ok, false);
  assert.equal(report.accepted.length, 0);
  assert.deepEqual(report.rejected.map((entry) => entry.reason), [
    'value-must-be-boolean',
    'value-out-of-range',
    'unknown-coordinate-shear-setting',
  ]);
  assert.deepEqual(engine.getCoordinateShearConfiguration(), {
    enabled: false,
    gain: 1,
  });
});

test('passive, press, translation, shear responses configure independently', () => {
  const engine = new TflEngine();
  engine.setMotionWarp({ enabled: true, gain: 1.3 });
  engine.setActiveDeformation({
    pressEnabled: true,
    pressGain: -0.8,
    dragEnabled: false,
    dragGain: 1.2,
    radius: 0.27,
  });
  engine.setCoordinateShear({ enabled: true, gain: 1.6 });

  assert.equal(engine.getMotionWarpConfiguration().enabled, true);
  assert.deepEqual(engine.getActiveDeformationConfiguration(), {
    pressEnabled: true,
    pressGain: -0.8,
    dragEnabled: false,
    dragGain: 1.2,
    radius: 0.27,
  });
  assert.deepEqual(engine.getCoordinateShearConfiguration(), {
    enabled: true,
    gain: 1.6,
  });

  engine.setCoordinateShear({ enabled: false });
  assert.equal(engine.getMotionWarpConfiguration().enabled, true);
  assert.equal(engine.getActiveDeformationConfiguration().pressEnabled, true);
  assert.equal(engine.getActiveDeformationConfiguration().dragEnabled, false);
});

test('coordinate shear defaults off in the Phase 3B-compatible render payload', () => {
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
  assert.deepEqual(rendered.coordinateShear, {
    enabled: false,
    gain: 1,
    radius: 0.19,
    position: { x: 0.1, y: -0.15 },
    positionValid: true,
    active: true,
    sourceVelocity: { x: 1, y: -0.5 },
    sourceSpeed: Math.hypot(1, -0.5),
    sourceAmplitude: 1,
    displacement: { x: 0, y: 0 },
    effectiveStrength: 0,
  });
});

test('shear snapshots replay runtime and preserve parameters, locks and presets', () => {
  const engine = new TflEngine();
  engine.applyPreset('Deep Violet', { transition: 'immediate' });
  engine.setParameter('exposure', 1.17);
  setParameterLock(engine.state, 'exposure', true);
  const parameters = structuredClone(engine.state.target);
  const locks = structuredClone(engine.state.locks);
  const preset = engine.state.preset;

  engine.setCoordinateShear({ enabled: true, gain: 1.45 });
  engine.setSpatialInfluence(activeInfluence({ velocity: { x: 1, y: -0.25 } }));
  engine.advance(0.2);
  assert.deepEqual(engine.state.target, parameters);
  assert.deepEqual(engine.state.locks, locks);
  assert.equal(engine.state.preset, preset);

  const snapshot = engine.createSnapshot({ includeRuntime: true });
  const restored = new TflEngine();
  assert.equal(restored.restoreSnapshot(snapshot, { restoreRuntime: true }).ok, true);
  assert.deepEqual(restored.createSnapshot({ includeRuntime: true }), snapshot);

  const invalid = structuredClone(snapshot);
  invalid.runtime.coordinateShear.effectiveStrength += 0.01;
  const before = restored.createSnapshot({ includeRuntime: true });
  assert.equal(restored.restoreSnapshot(invalid, { restoreRuntime: true }).ok, false);
  assert.deepEqual(restored.createSnapshot({ includeRuntime: true }), before);

  restored.factoryReset();
  assert.deepEqual(restored.getCoordinateShearConfiguration(), {
    enabled: false,
    gain: 1,
  });
});
