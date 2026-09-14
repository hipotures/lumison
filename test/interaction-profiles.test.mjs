import assert from 'node:assert/strict';
import test from 'node:test';
import { TflEngine } from '../packages/tfl-engine/src/index.js';
import {
  applyInteractionProfile,
  INTERACTION_PROFILES,
  markInteractionProfileCustom,
} from '../apps/tfl-lab/src/interaction-profiles.js';
import { createLabState } from '../apps/tfl-lab/src/persistence.js';

function visualState(engine) {
  return {
    requested: structuredClone(engine.state.requested),
    target: structuredClone(engine.state.target),
    current: structuredClone(engine.state.current),
    effective: structuredClone(engine.state.effective),
    preset: engine.state.preset,
    quality: engine.state.quality,
    diag: engine.state.diag,
    msaa: engine.state.msaa,
    adaptive: engine.state.adaptive,
    targetFps: engine.state.targetFps,
    locks: structuredClone(engine.state.locks),
  };
}

test('profiles change interaction configuration only', () => {
  const engine = new TflEngine();
  const labState = createLabState();
  engine.applyPreset('Deep Violet', { transition: 'immediate' });
  engine.setParameter('exposure', 1.17);
  engine.setParameterLock('exposure', true);
  engine.setQuality('Ultra');
  engine.setMsaa(4);
  const before = visualState(engine);

  for (const name of ['Qwen-like', 'Mobile-like', 'Fixed baseline']) {
    const result = applyInteractionProfile(engine, labState, name);
    assert.equal(result.ok, true);
    assert.deepEqual(visualState(engine), before, name);
  }
});

test('Fixed profile reproduces the previous compatibility interaction settings', () => {
  const engine = new TflEngine();
  const labState = createLabState();
  applyInteractionProfile(engine, labState, 'Mobile-like');
  const result = applyInteractionProfile(engine, labState, 'Fixed baseline');
  assert.equal(result.ok, true);
  assert.deepEqual(engine.getMotionWarpConfiguration(), INTERACTION_PROFILES['Fixed baseline'].motionWarp);
  assert.deepEqual(
    engine.getActiveDeformationConfiguration(),
    INTERACTION_PROFILES['Fixed baseline'].activeDeformation,
  );
  assert.deepEqual(
    engine.getCoordinateShearConfiguration(),
    INTERACTION_PROFILES['Fixed baseline'].coordinateShear,
  );
  assert.deepEqual(
    engine.getRippleDisplacementConfiguration(),
    INTERACTION_PROFILES['Fixed baseline'].rippleDisplacement,
  );
  assert.deepEqual(
    engine.getMembraneResponseConfiguration(),
    INTERACTION_PROFILES['Fixed baseline'].membraneResponse,
  );
  assert.equal(labState.interactionProfile, 'Fixed baseline');
});

test('Qwen-like and Mobile-like keep their mechanism identities separate', () => {
  const engine = new TflEngine();
  const labState = createLabState();
  applyInteractionProfile(engine, labState, 'Qwen-like');
  assert.equal(engine.getRippleDisplacementConfiguration().enabled, true);
  assert.equal(engine.getMembraneResponseConfiguration().enabled, false);
  assert.equal(labState.rippleDuringDrag, true);

  applyInteractionProfile(engine, labState, 'Mobile-like');
  assert.equal(engine.getRippleDisplacementConfiguration().enabled, false);
  assert.equal(engine.getMembraneResponseConfiguration().enabled, true);
  assert.equal(engine.getMembraneResponseConfiguration().radius, 0.5);
  assert.equal(labState.membraneWaveDuringDrag, true);
});

test('manual interaction edits select Custom without changing their values', () => {
  const engine = new TflEngine();
  const labState = createLabState();
  applyInteractionProfile(engine, labState, 'Mobile-like');
  const report = engine.setMembraneResponse({ tangentialGain: -0.35 });
  assert.equal(report.changed, true);
  assert.equal(markInteractionProfileCustom(labState), true);
  assert.equal(labState.interactionProfile, 'Custom');
  assert.equal(engine.getMembraneResponseConfiguration().tangentialGain, -0.35);

  const custom = applyInteractionProfile(engine, labState, 'Custom');
  assert.equal(custom.ok, true);
  assert.equal(custom.changed, false);
  assert.equal(engine.getMembraneResponseConfiguration().tangentialGain, -0.35);
});

test('profile application clears only transient interaction events', () => {
  const engine = new TflEngine();
  const labState = createLabState();
  engine.emitTransientEvent({
    type: 'test',
    position: { x: 0, y: 0 },
    radius: 0.2,
    strength: 1,
    lifetime: 2,
  });
  assert.equal(engine.diagnostics().transientEventCount, 1);
  applyInteractionProfile(engine, labState, 'Mobile-like');
  assert.equal(engine.diagnostics().transientEventCount, 0);
});
