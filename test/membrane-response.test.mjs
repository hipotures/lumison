import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceMembraneResponse,
  createMembraneResponseState,
  createMembraneWaveEvent,
  createSpatialInfluence,
  MEMBRANE_RESPONSE_CALIBRATION,
  membraneContinuousDisplacementAt,
  membraneResponseRenderState,
  membraneWaveDisplacementAt,
  membraneWaveRecoveryEnvelope,
  TflEngine,
} from '../packages/tfl-engine/src/index.js';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

const influence = (overrides = {}) => createSpatialInfluence({
  id: 'membrane-source',
  position: { x: 0.1, y: -0.1 },
  velocity: { x: 0.9, y: 0.2 },
  strength: 1.55,
  engaged: true,
  positionValid: true,
  ...overrides,
});

function settle(configuration, source = influence(), seconds = 1) {
  const state = createMembraneResponseState(configuration);
  for (let index = 0; index < seconds * 120; index++) {
    advanceMembraneResponse(state, source, 1 / 120);
  }
  return state;
}

test('broad radial displacement has a smooth finite falloff', () => {
  const state = settle({
    enabled: true,
    radialGain: 1,
    tangentialGain: 0,
    radius: 0.5,
  });
  const inner = membraneContinuousDisplacementAt(state, {
    x: state.position.x + 0.15,
    y: state.position.y,
  });
  const edge = membraneContinuousDisplacementAt(state, {
    x: state.position.x + 0.5,
    y: state.position.y,
  });
  const outer = membraneContinuousDisplacementAt(state, {
    x: state.position.x + 1,
    y: state.position.y,
  });
  assert.ok(inner.x > edge.x && edge.x > outer.x && outer.x > 0);
  close(inner.y, 0);
  close(edge.y, 0);
  assert.ok(inner.x <= MEMBRANE_RESPONSE_CALIBRATION.maximumRadialDisplacement);
});

test('tangential displacement uses an explicit counter-clockwise sign', () => {
  const positive = settle({ enabled: true, radialGain: 0, tangentialGain: 1 });
  const negative = settle({ enabled: true, radialGain: 0, tangentialGain: -1 });
  const sample = { x: positive.position.x + 0.2, y: positive.position.y };
  const ccw = membraneContinuousDisplacementAt(positive, sample);
  const clockwise = membraneContinuousDisplacementAt(negative, sample);
  close(ccw.x, 0);
  assert.ok(ccw.y > 0);
  close(clockwise.x, 0);
  assert.ok(clockwise.y < 0);
  close(ccw.y, -clockwise.y, 1e-8);
});

test('zero motion produces no tangential drive while radial press remains available', () => {
  const state = settle(
    { enabled: true, radialGain: 1, tangentialGain: 1 },
    influence({ velocity: { x: 0, y: 0 } }),
  );
  assert.ok(state.radialDisplacement > 0);
  assert.equal(state.tangentialDisplacement, 0);
});

test('continuous response recovers smoothly and is dt-subdivision independent', () => {
  const driven = settle({ enabled: true }, influence(), 0.5);
  const before = driven.effectiveStrength;
  const released = influence({
    engaged: false,
    strength: 0,
    velocity: { x: 0, y: 0 },
  });
  advanceMembraneResponse(driven, released, 0.2);
  assert.ok(driven.effectiveStrength > 0 && driven.effectiveStrength < before);

  const whole = createMembraneResponseState({ enabled: true });
  const split = createMembraneResponseState({ enabled: true });
  advanceMembraneResponse(whole, influence(), 0.75);
  for (let index = 0; index < 90; index++) {
    advanceMembraneResponse(split, influence(), 0.75 / 90);
  }
  close(whole.radialDisplacement, split.radialDisplacement);
  close(whole.tangentialDisplacement, split.tangentialDisplacement);

  for (let index = 0; index < 60; index++) advanceMembraneResponse(driven, released, 0.1);
  assert.equal(driven.effectiveStrength, 0);
});

test('membrane wave recovery envelope is analytic and monotonic', () => {
  assert.equal(membraneWaveRecoveryEnvelope(0, 4), 1);
  assert.equal(membraneWaveRecoveryEnvelope(2, 4), 0.25);
  assert.equal(membraneWaveRecoveryEnvelope(4, 4), 0);
  assert.equal(membraneWaveRecoveryEnvelope(5, 4), 0);
  assert.equal(membraneWaveRecoveryEnvelope(Number.NaN, 4), 0);
});

test('membrane wave age is time-based and origin remains stable', () => {
  const origin = { x: -0.2, y: 0.15 };
  const descriptor = createMembraneWaveEvent({ origin });
  const whole = new TflEngine();
  const split = new TflEngine();
  for (const engine of [whole, split]) {
    engine.setMembraneResponse({ enabled: true, waveEnabled: true });
    engine.emitTransientEvent(descriptor);
  }
  whole.advance(0.75);
  for (let index = 0; index < 90; index++) split.advance(0.75 / 90);
  const a = membraneResponseRenderState(whole.membraneResponse, whole.events);
  const b = membraneResponseRenderState(split.membraneResponse, split.events);
  close(a.events[0].age, b.events[0].age);
  assert.deepEqual(a.events[0].position, origin);

  whole.setSpatialInfluence(influence({ position: { x: 0.7, y: -0.3 } }));
  whole.advance(0.2);
  const moved = membraneResponseRenderState(whole.membraneResponse, whole.events);
  assert.deepEqual(moved.events[0].position, origin);
  const sample = { x: origin.x + 0.19, y: origin.y };
  const offset = membraneWaveDisplacementAt(moved.events[0], sample, moved);
  assert.ok(Number.isFinite(offset.x) && Number.isFinite(offset.y));
});

test('pause freezes membrane wave age while continuous recovery remains explicit', () => {
  const engine = new TflEngine();
  engine.setMembraneResponse({ enabled: true, waveEnabled: true });
  engine.emitTransientEvent(createMembraneWaveEvent({ origin: { x: 0, y: 0 } }));
  engine.setSpatialInfluence(influence());
  engine.advance(0.2);
  engine.setSpatialInfluence(influence({ engaged: false, strength: 0 }));
  engine.setPaused(true);
  const age = engine.events.entries[0].age;
  const strength = engine.membraneResponse.effectiveStrength;
  engine.advance(0.25);
  assert.equal(engine.events.entries[0].age, age);
  assert.ok(engine.membraneResponse.effectiveStrength < strength);
});

test('membrane configuration and wave descriptors reject invalid values', () => {
  const engine = new TflEngine();
  const report = engine.setMembraneResponse({
    enabled: 'yes',
    radialGain: 3,
    tangentialGain: -3,
    radius: 0,
    waveEnabled: 1,
    waveGain: Infinity,
    mouseButton: 0,
  });
  assert.equal(report.ok, false);
  assert.equal(report.accepted.length, 0);
  assert.equal(report.rejected.length, 7);
  assert.throws(() => createMembraneWaveEvent({
    origin: { x: 0, y: 0 },
    width: 0,
  }), /membrane-width-out-of-range/);
});

test('default membrane payload is an exact disabled Phase 3D compatibility state', () => {
  let rendered = null;
  const renderHost = {
    backend: 'test',
    hasGpu: () => false,
    render(payload) { rendered = structuredClone(payload); return { aspect: 1 }; },
    consumeBackendChange: () => null,
    diagnostics: () => ({
      backend: 'test', bufferWidth: null, bufferHeight: null, ratio: null, stats: null,
    }),
  };
  const engine = new TflEngine({ renderHost });
  engine.setSpatialInfluence(influence());
  engine.advance(0.5);
  engine.render();
  assert.equal(rendered.membraneResponse.enabled, false);
  assert.equal(rendered.membraneResponse.effectiveStrength, 0);
  assert.equal(rendered.membraneResponse.activeWaveCount, 0);
});

test('equal membrane influence, event and dt sequences replay identically', () => {
  const run = () => {
    const engine = new TflEngine();
    engine.setMembraneResponse({
      enabled: true,
      radialGain: 0.8,
      tangentialGain: -0.6,
      radius: 0.52,
      waveEnabled: true,
      waveGain: 1.1,
    });
    engine.setSpatialInfluence(influence());
    engine.emitTransientEvent(createMembraneWaveEvent({ origin: { x: 0.1, y: -0.1 } }));
    for (const dt of [1 / 60, 1 / 30, 0.025, 0.1]) engine.advance(dt);
    return engine.createSnapshot({ includeRuntime: true });
  };
  assert.deepEqual(run(), run());
});
