import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeDeformationDisplacementAt,
  configureNormalEvaluation,
  coordinateShearDisplacementAt,
  createMembraneWaveEvent,
  createNormalEvaluationState,
  createRippleDisplacementEvent,
  createSpatialInfluence,
  membraneContinuousDisplacementAt,
  membraneWaveDisplacementSum,
  motionWarpDisplacementAt,
  NORMAL_EVALUATION_DEFAULTS,
  NORMAL_EVALUATION_MODES,
  normalEvaluationConfiguration,
  normalEvaluationRenderState,
  normalSamplingCoordinates,
  rippleDisplacementAt,
  stableNormalFromGradient,
  TflEngine,
} from '../packages/tfl-engine/src/index.js';

const close = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test('Legacy Fixed is the deterministic default and invalid modes are rejected', () => {
  const state = createNormalEvaluationState();
  assert.deepEqual(normalEvaluationConfiguration(state), NORMAL_EVALUATION_DEFAULTS);
  assert.equal(normalEvaluationRenderState(state, 'High').shaderMode, 0);
  assert.equal(normalEvaluationRenderState(state, 'High').legacyExplicitTilt, true);

  const changed = configureNormalEvaluation(state, {
    mode: NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY,
  });
  assert.equal(changed.ok, true);
  assert.equal(changed.changed, true);
  assert.equal(normalEvaluationRenderState(state, 'Low').shaderMode, 1);
  assert.equal(normalEvaluationRenderState(state, 'Low').normalHeightSamples, 3);

  const invalid = configureNormalEvaluation(state, { mode: 'Approximate Magic' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.rejected[0].reason, 'invalid-normal-evaluation-mode');
  assert.equal(state.configuration.mode, NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY);
});

test('zero displacement produces equivalent center and neighbor coordinates', () => {
  const input = {
    center: { x: 0.3, y: -0.2 },
    epsilon: 0.0045,
    displacementAt: () => ({ x: 0, y: 0 }),
  };
  const legacy = normalSamplingCoordinates({
    ...input,
    mode: NORMAL_EVALUATION_MODES.LEGACY_FIXED,
  });
  const displaced = normalSamplingCoordinates({
    ...input,
    mode: NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY,
  });
  assert.deepEqual(displaced, legacy);
  assert.deepEqual(displaced.center, input.center);
  close(displaced.xPositive.x, input.center.x + input.epsilon);
  close(displaced.yNegative.y, input.center.y - input.epsilon);
});

test('Displaced Geometry evaluates every neighbor from the same local field', () => {
  const calls = [];
  const localDisplacement = (position) => {
    calls.push({ ...position });
    return {
      x: 0.12 * position.y * position.y,
      y: -0.08 * position.x * position.y,
    };
  };
  const options = {
    center: { x: 0.25, y: -0.15 },
    epsilon: 0.01,
    displacementAt: localDisplacement,
  };
  const displaced = normalSamplingCoordinates({
    ...options,
    mode: NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY,
  });
  assert.equal(calls.length, 5);
  assert.deepEqual(calls, [
    { x: 0.25, y: -0.15 },
    { x: 0.26, y: -0.15 },
    { x: 0.24, y: -0.15 },
    { x: 0.25, y: -0.13999999999999999 },
    { x: 0.25, y: -0.16 },
  ]);

  calls.length = 0;
  const legacy = normalSamplingCoordinates({
    ...options,
    mode: NORMAL_EVALUATION_MODES.LEGACY_FIXED,
  });
  assert.equal(calls.length, 1);
  assert.notDeepEqual(displaced.xPositive, legacy.xPositive);
  assert.notDeepEqual(displaced.yPositive, legacy.yPositive);
  assert.deepEqual(
    normalSamplingCoordinates({
      ...options,
      mode: NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY,
    }),
    displaced,
  );
});

test('extreme validated interaction state keeps sample coordinates and normals finite', () => {
  const engine = new TflEngine();
  assert.equal(engine.setMotionWarp({ enabled: true, gain: 2, radius: 0.03 }).ok, true);
  assert.equal(engine.setActiveDeformation({
    pressEnabled: true,
    pressGain: -2,
    dragEnabled: true,
    dragGain: 2,
    radius: 0.03,
  }).ok, true);
  assert.equal(engine.setCoordinateShear({ enabled: true, gain: 2 }).ok, true);
  assert.equal(engine.setRippleDisplacement({ enabled: true, gain: 2 }).ok, true);
  assert.equal(engine.setMembraneResponse({
    enabled: true,
    radialGain: 2,
    tangentialGain: -2,
    radius: 0.12,
    waveEnabled: true,
    waveGain: 2,
  }).ok, true);
  engine.setSpatialInfluence(createSpatialInfluence({
    position: { x: 0, y: 0 },
    velocity: { x: 3, y: -3 },
    strength: 1.55,
    engaged: true,
    positionValid: true,
  }));
  engine.emitTransientEvent(createRippleDisplacementEvent({
    origin: { x: 0.01, y: -0.01 },
    amplitude: 2,
    wavelength: 0.04,
    displacementGain: 2,
  }));
  engine.emitTransientEvent(createMembraneWaveEvent({
    origin: { x: -0.01, y: 0.01 },
    amplitude: 2,
    wavelength: 0.08,
    displacementGain: 2,
  }));
  engine.advance(0.1);
  const diagnostic = engine.diagnostics();
  const displacementAt = (position) => {
    const components = [
      motionWarpDisplacementAt(engine.motionWarp, position),
      activeDeformationDisplacementAt(engine.activeDeformation, position),
      coordinateShearDisplacementAt(engine.coordinateShear, position),
      rippleDisplacementAt(diagnostic.rippleDisplacement, position),
      membraneContinuousDisplacementAt(engine.membraneResponse, position),
      membraneWaveDisplacementSum(diagnostic.membraneResponse, position),
    ];
    return components.reduce((sum, value) => ({
      x: sum.x + value.x,
      y: sum.y + value.y,
    }), { x: 0, y: 0 });
  };
  const samples = normalSamplingCoordinates({
    center: { x: 1e-6, y: -1e-6 },
    epsilon: 0.0045,
    mode: NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY,
    displacementAt,
  });
  for (const point of Object.values(samples)) {
    assert.ok(Number.isFinite(point.x));
    assert.ok(Number.isFinite(point.y));
  }
  for (const gradient of [[1e300, -1e300], [Infinity, 2], [0, 0]]) {
    const normal = stableNormalFromGradient(gradient[0], gradient[1], 2);
    assert.ok(Object.values(normal).every(Number.isFinite));
    close(Math.hypot(normal.x, normal.y, normal.z), 1, 1e-12);
  }
});

test('engine snapshots validate and preserve normal mode independently of locks and profiles', () => {
  const source = new TflEngine();
  source.setParameterLock('exposure', true);
  assert.equal(source.setNormalEvaluation({
    mode: NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY,
  }).ok, true);
  source.reset();
  assert.equal(
    source.getNormalEvaluationConfiguration().mode,
    NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY,
  );
  const saved = source.createSnapshot();
  assert.deepEqual(saved.rendering.normalEvaluation, {
    mode: NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY,
  });

  const restored = new TflEngine();
  assert.equal(restored.restoreSnapshot(saved).ok, true);
  assert.deepEqual(restored.getNormalEvaluationConfiguration(), saved.rendering.normalEvaluation);
  assert.equal(restored.state.locks.exposure, true);

  const invalid = structuredClone(saved);
  invalid.rendering.normalEvaluation.mode = 'invalid';
  const before = restored.createSnapshot();
  assert.equal(restored.restoreSnapshot(invalid).ok, false);
  assert.deepEqual(restored.createSnapshot(), before);

  const prePhase3F = structuredClone(saved);
  delete prePhase3F.rendering;
  assert.equal(restored.restoreSnapshot(prePhase3F).ok, true);
  assert.deepEqual(restored.getNormalEvaluationConfiguration(), NORMAL_EVALUATION_DEFAULTS);

  restored.factoryReset();
  assert.deepEqual(restored.getNormalEvaluationConfiguration(), NORMAL_EVALUATION_DEFAULTS);
});

test('renderer payload and diagnostics expose the selected normal policy', () => {
  let rendered = null;
  const renderHost = {
    backend: 'test',
    hasGpu: () => true,
    render(payload) { rendered = structuredClone(payload); return { aspect: 1.5 }; },
    diagnostics: () => ({ backend: 'test', capabilities: { displacedGeometryNormals: true } }),
    consumeBackendChange: () => null,
  };
  const engine = new TflEngine({ renderHost });
  engine.setNormalEvaluation({ mode: NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY });
  engine.render();
  assert.equal(rendered.normalEvaluation.shaderMode, 1);
  assert.equal(rendered.normalEvaluation.legacyExplicitTilt, false);
  assert.equal(engine.diagnostics().normalEvaluation.mode, 'Displaced Geometry');
});
