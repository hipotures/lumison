import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceMotionWarp,
  createMotionWarpState,
  createSpatialInfluence,
  motionWarpDisplacementAt,
  normalizedViewportToSurface,
  setParameterLock,
  TflEngine,
  updateSurfaceVelocity,
} from '../packages/tfl-engine/src/index.js';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

const movingInfluence = (speed, overrides = {}) => createSpatialInfluence({
  id: 'motion-source',
  position: { x: 0.1, y: -0.15 },
  velocity: { x: speed, y: 0 },
  radius: 0.16,
  positionValid: true,
  ...overrides,
});

function settleAtSpeed(speed, seconds = 1) {
  const state = createMotionWarpState({ enabled: true });
  const influence = movingInfluence(speed);
  for (let index = 0; index < seconds * 120; index++) {
    advanceMotionWarp(state, influence, 1 / 120);
  }
  return state;
}

test('passive warp defaults off and leaves Fixed-compatible influence unchanged', () => {
  let rendered = null;
  const renderHost = {
    backend: 'test',
    hasGpu: () => false,
    render(payload) { rendered = structuredClone(payload); return { aspect: 2 }; },
    consumeBackendChange: () => null,
    diagnostics: () => ({
      backend: 'test', bufferWidth: null, bufferHeight: null, ratio: null, stats: null,
    }),
  };
  const engine = new TflEngine({ renderHost });
  const influence = movingInfluence(1, { strength: 1.2, engaged: true });
  assert.equal(engine.setSpatialInfluence(influence).accepted, true);
  const before = structuredClone(engine.influence);
  engine.advance(0.5);
  engine.render();
  assert.deepEqual(engine.influence, before);
  assert.equal(engine.getMotionWarpConfiguration().enabled, false);
  assert.deepEqual(rendered.motionWarp.displacement, { x: 0, y: 0 });
  assert.equal(rendered.motionWarp.effectiveStrength, 0);
});

test('zero velocity produces no passive displacement or effective strength', () => {
  const engine = new TflEngine();
  assert.equal(engine.setMotionWarp({ enabled: true }).ok, true);
  engine.setSpatialInfluence(movingInfluence(0));
  engine.advance(1);
  assert.deepEqual(engine.diagnostics().motionWarp.displacement, { x: 0, y: 0 });
  assert.equal(engine.diagnostics().motionWarp.effectiveStrength, 0);
});

test('increasing canonical speed increases passive response monotonically until bounded', () => {
  const strengths = [0.1, 0.35, 0.8, 1.4]
    .map((speed) => settleAtSpeed(speed).effectiveStrength);
  for (let index = 1; index < strengths.length; index++) {
    assert.ok(strengths[index] > strengths[index - 1], `${strengths[index]} <= ${strengths[index - 1]}`);
  }
  assert.ok(strengths.at(-1) < 0.041);
  const saturated = settleAtSpeed(10).effectiveStrength;
  assert.ok(saturated <= 0.040001);
});

function simulateMotion(frequency) {
  const warp = createMotionWarpState({ enabled: true });
  const dt = 1 / frequency;
  const physicalVelocity = { x: 0.9, y: -0.3 };
  let priorPosition = { x: 0, y: 0 };
  let velocity = { x: 0, y: 0 };
  for (let index = 1; index <= frequency; index++) {
    const position = {
      x: physicalVelocity.x * index * dt,
      y: physicalVelocity.y * index * dt,
    };
    velocity = updateSurfaceVelocity(velocity, priorPosition, position, dt);
    advanceMotionWarp(warp, createSpatialInfluence({
      position,
      velocity,
      positionValid: true,
    }), dt);
    priorPosition = position;
  }
  return warp;
}

test('equivalent motion is approximately independent of input event frequency', () => {
  const at30 = simulateMotion(30);
  const at120 = simulateMotion(120);
  close(at30.displacement.x, at120.displacement.x, 2e-5);
  close(at30.displacement.y, at120.displacement.y, 2e-5);
  close(at30.effectiveStrength, at120.effectiveStrength, 2e-5);
});

test('passive response decays smoothly after source motion stops', () => {
  const state = settleAtSpeed(1, 0.5);
  const initial = state.effectiveStrength;
  const stopped = movingInfluence(0);
  advanceMotionWarp(state, stopped, 0.1);
  assert.ok(state.effectiveStrength > 0 && state.effectiveStrength < initial);
  const afterFirstStep = state.effectiveStrength;
  advanceMotionWarp(state, stopped, 0.1);
  assert.ok(state.effectiveStrength < afterFirstStep);
  for (let index = 0; index < 20; index++) advanceMotionWarp(state, stopped, 0.1);
  assert.ok(state.effectiveStrength < 1e-6);
});

test('animation pause freezes clocks but does not freeze passive release', () => {
  const engine = new TflEngine();
  engine.setMotionWarp({ enabled: true });
  engine.setSpatialInfluence(movingInfluence(1));
  engine.advance(0.25);
  const driven = engine.diagnostics().motionWarp.effectiveStrength;
  engine.setSpatialInfluence(movingInfluence(0));
  engine.setPaused(true);
  const clock = engine.state.clocks.animation;
  engine.advance(0.25);
  assert.equal(engine.state.clocks.animation, clock);
  assert.ok(engine.diagnostics().motionWarp.effectiveStrength < driven);
});

test('Gaussian radius uses aspect-independent canonical surface distances', () => {
  const landscapeCenter = normalizedViewportToSurface(0.5, 0.5, 2);
  const landscapeSample = normalizedViewportToSurface(0.55, 0.5, 2);
  const portraitCenter = normalizedViewportToSurface(0.5, 0.5, 0.5);
  const portraitSample = normalizedViewportToSurface(0.7, 0.5, 0.5);
  close(landscapeSample.x - landscapeCenter.x, 0.1);
  close(portraitSample.x - portraitCenter.x, 0.1);

  const landscape = settleAtSpeed(1);
  landscape.position = landscapeCenter;
  const portrait = structuredClone(landscape);
  portrait.position = portraitCenter;
  const a = motionWarpDisplacementAt(landscape, landscapeSample);
  const b = motionWarpDisplacementAt(portrait, portraitSample);
  close(a.x, b.x);
  close(a.y, b.y);
});

test('motion-warp gain and radius reject invalid values without corrupting configuration', () => {
  const engine = new TflEngine();
  const baseline = engine.getMotionWarpConfiguration();
  const report = engine.setMotionWarp({
    gain: -0.1,
    radius: Infinity,
    enabled: 'yes',
    pointerGain: 1,
  });
  assert.equal(report.ok, false);
  assert.equal(report.accepted.length, 0);
  assert.deepEqual(report.rejected.map((entry) => entry.reason), [
    'value-out-of-range',
    'value-must-be-finite-number',
    'enabled-must-be-boolean',
    'unknown-motion-warp-setting',
  ]);
  assert.deepEqual(engine.getMotionWarpConfiguration(), baseline);
});

test('motion-warp configuration remains separate from parameters and locks', () => {
  const engine = new TflEngine();
  engine.setParameter('exposure', 1.17);
  setParameterLock(engine.state, 'exposure', true);
  const parameters = structuredClone(engine.state.target);
  const locks = structuredClone(engine.state.locks);
  engine.setMotionWarp({ enabled: true, gain: 1.5, radius: 0.25 });
  engine.setSpatialInfluence(movingInfluence(0.8));
  engine.advance(0.2);
  assert.deepEqual(engine.state.target, parameters);
  assert.deepEqual(engine.state.locks, locks);
  assert.equal(engine.state.target.exposure, 1.17);
  engine.factoryReset();
  assert.deepEqual(engine.getMotionWarpConfiguration(), {
    enabled: false,
    gain: 1,
    radius: 0.19,
  });
});

test('equal influence and dt sequences reproduce motion-warp runtime state', () => {
  const run = () => {
    const engine = new TflEngine();
    engine.setMotionWarp({ enabled: true, gain: 1.25, radius: 0.22 });
    for (const [velocity, dt] of [
      [{ x: 0.4, y: 0.1 }, 1 / 60],
      [{ x: 1.1, y: -0.2 }, 1 / 30],
      [{ x: 0, y: 0 }, 0.1],
      [{ x: -0.3, y: 0.7 }, 0.025],
    ]) {
      engine.setSpatialInfluence(movingInfluence(0, { velocity }));
      engine.advance(dt);
    }
    return engine.createSnapshot({ includeRuntime: true });
  };
  assert.deepEqual(run(), run());

  const snapshot = run();
  const restored = new TflEngine();
  assert.equal(restored.restoreSnapshot(snapshot, { restoreRuntime: true }).ok, true);
  assert.deepEqual(restored.createSnapshot({ includeRuntime: true }), snapshot);

  const invalid = structuredClone(snapshot);
  invalid.runtime.motionWarp.effectiveStrength += 0.1;
  const before = restored.createSnapshot({ includeRuntime: true });
  assert.equal(restored.restoreSnapshot(invalid, { restoreRuntime: true }).ok, false);
  assert.deepEqual(restored.createSnapshot({ includeRuntime: true }), before);
});
