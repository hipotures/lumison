import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PARAM_SCHEMA, surfaceToNormalizedViewport } from '../packages/tfl-engine/src/index.js';
import { MUSICAL_FIELD_V1 } from '../apps/lumison/src/visual/mapping-profiles.js';
import { defaultTuning, serializeTuning, parseTuning, disableAllTuning, soloTuning, TUNING_SCHEMA, getTuningValue } from '../apps/lumison/src/visual/visual-tuning.js';
import {
  mapNoteToNormalizedPosition,
  MusicalVisualMapper,
} from '../apps/lumison/src/visual/musical-visual-mapper.js';

const baseline = {
  flowSpeed: 0.9,
  turbulence: 0.8,
  fineDetail: 0.9,
  warp: 1,
  filmBase: 430,
  lightMotion: 0.3,
};

function features(overrides = {}) {
  return {
    position: 1,
    energy01: 0.5,
    density01: 0.4,
    soundingPolyphony: 2,
    register01: 0.5,
    span01: 0.3,
    pitchMotion01: 0.2,
    sustain01: 0,
    ...overrides,
  };
}

class FakeEngine {
  constructor() {
    this.parameterCalls = [];
    this.influences = [];
    this.events = [];
    this.clearTransientCount = 0;
    this.clearInfluenceCount = 0;
    this.motion = [];
    this.active = [];
    this.shear = [];
    this.ripple = [];
    this.membrane = [];
  }

  setParameters(changes, options) {
    this.parameterCalls.push({ changes: { ...changes }, options });
    return { ok: true, accepted: Object.entries(changes) };
  }

  setSpatialInfluence(influence) {
    this.influences.push(structuredClone(influence));
    return { accepted: true };
  }

  clearSpatialInfluence() { this.clearInfluenceCount += 1; }
  setMotionWarp(value) { this.motion.push({ ...value }); }
  setActiveDeformation(value) { this.active.push({ ...value }); }
  setCoordinateShear(value) { this.shear.push({ ...value }); }
  setRippleDisplacement(value) { this.ripple.push({ ...value }); }
  setMembraneResponse(value) { this.membrane.push({ ...value }); }
  clearTransientEvents() { this.clearTransientCount += 1; this.events.length = 0; }
  emitTransientEvent(event) { this.events.push(structuredClone(event)); return { accepted: true }; }
}

function mapper(options = {}) {
  const engine = new FakeEngine();
  return {
    engine,
    mapper: new MusicalVisualMapper({ engine, baseline, aspect: 16 / 9, ...options }),
  };
}

test('low and high notes map monotonically across the inset viewport surface', () => {
  const low = mapNoteToNormalizedPosition({ note: 21, velocity: 0.5 });
  const high = mapNoteToNormalizedPosition({ note: 108, velocity: 0.5 });
  assert.equal(low.x, MUSICAL_FIELD_V1.transient.horizontalMargin);
  assert.ok(Math.abs(high.x - (1 - MUSICAL_FIELD_V1.transient.horizontalMargin)) < 1e-12);
  assert.ok(low.x < high.x);

  const { engine, mapper: visual } = mapper();
  visual.emitEvent({ type: 'note-on', note: 21, velocity: 0.5 }, features());
  visual.emitEvent({ type: 'note-on', note: 108, velocity: 0.5 }, features());
  const normalized = engine.events.map((event) => surfaceToNormalizedViewport(
    event.position,
    16 / 9,
  ));
  assert.ok(normalized.every((point) => point.x >= 0 && point.x <= 1
    && point.y >= 0 && point.y <= 1));
  assert.ok(normalized[0].x < normalized[1].x);
});

test('stronger Note On velocity emits a stronger ripple', () => {
  const { engine, mapper: visual } = mapper();
  visual.emitEvent({ type: 'note-on', note: 60, velocity: 0.2 }, features());
  visual.emitEvent({ type: 'note-on', note: 60, velocity: 0.9 }, features());
  assert.ok(engine.events[0].strength < engine.events[1].strength);
});

test('dense chord attacks each emit one transient without mapper-side loss', () => {
  const { engine, mapper: visual } = mapper();
  for (let note = 48; note < 58; note += 1) {
    visual.emitEvent({ type: 'note-on', note, velocity: 0.75 }, features());
  }
  assert.equal(engine.events.length, 10);
});

test('energy strengthens and span broadens the continuous influence', () => {
  const { engine, mapper: visual } = mapper();
  visual.update(features({ position: 1, energy01: 0.2, span01: 0.1 }), {
    forceParameters: true,
  });
  visual.update(features({ position: 2, energy01: 0.9, span01: 0.9 }), {
    forceParameters: true,
  });
  const [low, high] = engine.influences.slice(-2);
  assert.ok(low.strength < high.strength);
  assert.ok(low.radius < high.radius);
});

test('register shifts filmBase around the captured baseline without accumulation', () => {
  const { engine, mapper: visual } = mapper();
  visual.update(features({ position: 1, register01: 0 }), { forceParameters: true });
  visual.update(features({ position: 2, register01: 1 }), { forceParameters: true });
  const low = engine.parameterCalls.at(-2).changes;
  const high = engine.parameterCalls.at(-1).changes;
  assert.ok(low.filmBase < baseline.filmBase);
  assert.ok(high.filmBase > baseline.filmBase);
  assert.equal(high.flowSpeed, low.flowSpeed);
});

test('mapped parameter requests remain within public TFL parameter bounds', () => {
  const { engine, mapper: visual } = mapper({ sensitivity: 2 });
  visual.update(features({
    position: 1,
    energy01: 1,
    density01: 1,
    register01: 0,
    span01: 1,
    pitchMotion01: 1,
  }), { forceParameters: true });
  const changes = engine.parameterCalls.at(-1).changes;
  for (const [name, value] of Object.entries(changes)) {
    assert.ok(value >= PARAM_SCHEMA[name].minimum, `${name} below minimum`);
    assert.ok(value <= PARAM_SCHEMA[name].maximum, `${name} above maximum`);
  }
});

test('zero sensitivity suppresses transients and meaningful modulation', () => {
  const { engine, mapper: visual } = mapper({ sensitivity: 0 });
  visual.emitEvent({ type: 'note-on', note: 60, velocity: 1 }, features({ energy01: 1 }));
  visual.update(features({ energy01: 1, register01: 1 }), { forceParameters: true });
  assert.equal(engine.events.length, 0);
  assert.deepEqual(engine.parameterCalls.at(-1).changes, baseline);
  assert.equal(engine.influences.at(-1).engaged, false);
  assert.equal(engine.influences.at(-1).strength, 0);
});

test('disabling restores the baseline and turns interaction systems off', () => {
  const { engine, mapper: visual } = mapper();
  visual.update(features({ energy01: 1 }), { forceParameters: true });
  visual.setEnabled(false);
  assert.deepEqual(engine.parameterCalls.at(-1).changes, baseline);
  assert.deepEqual(engine.motion.at(-1), { enabled: false });
  assert.deepEqual(engine.active.at(-1), { enabled: false });
  assert.deepEqual(engine.shear.at(-1), { enabled: false });
  assert.deepEqual(engine.ripple.at(-1), { enabled: false });
  assert.deepEqual(engine.membrane.at(-1), { enabled: false });
});

test('seek and stop clear transients while seek emits no historical ripple', () => {
  const { engine, mapper: visual } = mapper();
  visual.emitEvent({ type: 'note-on', note: 64, velocity: 0.8 }, features());
  assert.equal(engine.events.length, 1);
  const clearsBeforeSeek = engine.clearTransientCount;
  visual.seek(features({ position: 4, register01: 0.8 }));
  assert.equal(engine.clearTransientCount, clearsBeforeSeek + 1);
  assert.equal(engine.events.length, 0);
  assert.deepEqual(engine.influences.at(-1).velocity, { x: 0, y: 0 });

  visual.emitEvent({ type: 'note-on', note: 67, velocity: 0.8 }, features());
  visual.stop();
  assert.equal(engine.events.length, 0);
  assert.deepEqual(engine.parameterCalls.at(-1).changes, baseline);
  assert.ok(engine.clearInfluenceCount > 0);
});

test('default configuration retains every original Musical Field v1 numeric value', () => {
  const config = defaultTuning();
  for (const group of ['transient', 'influence', 'interactions', 'parameterMappings']) {
    const check = (source, target) => {
      for (const [key, value] of Object.entries(source)) {
        if (key === 'feature') continue;
        if (typeof value === 'object') check(value, target[key]);
        else assert.equal(target[key], value, key);
      }
    };
    check(MUSICAL_FIELD_V1[group], config[group]);
  }
  assert.equal(config.temporal.parameterInterval, MUSICAL_FIELD_V1.parameterInterval);
  assert.equal(config.temporal.enabled, false);
  const original = mapper();
  const tuned = mapper();
  tuned.mapper.applyTuning(config);
  for (let i = 0; i < 20; i++) {
    const f = features({ position: i / 10, register01: i % 3 === 0 ? null : i / 20, energy01: i / 20 });
    original.mapper.update(f);
    tuned.mapper.update(f);
    const event = { type: 'note-on', note: 21 + i * 4, velocity: i / 20 };
    original.mapper.emitEvent(event, f);
    tuned.mapper.emitEvent(event, f);
    assert.deepEqual(tuned.engine.influences.at(-1), original.engine.influences.at(-1));
    assert.deepEqual(tuned.engine.events, original.engine.events);
    assert.deepEqual(tuned.engine.parameterCalls.at(-1), original.engine.parameterCalls.at(-1));
  }
});

test('default engine-call trace matches pre-tuning HEAD a687795 exactly', () => {
  // Golden digest captured by executing the unmodified mapper at a687795.
  // Includes 200 attacks and updates, null registers, varying polyphony and throttling.
  const calls = [];
  const engine = new Proxy({}, { get: (_object, key) => (...args) => {
    calls.push([key, ...structuredClone(args)]);
    return { accepted: true };
  } });
  const visual = new MusicalVisualMapper({ engine, baseline, aspect: 1.7 });
  visual.applyTuning(defaultTuning());
  calls.length = 0;
  for (let i = 0; i < 200; i++) {
    const f = {
      position: i / 60, energy01: (i % 17) / 17, density01: (i % 13) / 13,
      soundingPolyphony: i % 5, register01: i % 11 ? (i % 19) / 19 : null,
      span01: (i % 7) / 7, pitchMotion01: (i % 3) / 3, sustain01: i % 2,
      harmony: { key: { tonicPitchClass: i % 12, mode: i % 2 ? 'major' : 'minor' }, confidence: 0.9 },
    };
    visual.update(f);
    visual.emitEvent({ type: 'note-on', note: 21 + i % 88, velocity: (i % 127) / 127 }, f);
  }
  assert.equal(calls.length, 474);
  assert.equal(createHash('sha256').update(JSON.stringify(calls)).digest('hex'),
    '081de8b1df4e1fd427a59ca44be7b812d4dfdabe74f0a7427caea465c22b630e');
});

test('complete JSON round trip is stable and restore defaults is exact', () => {
  const json = serializeTuning(defaultTuning());
  assert.equal(serializeTuning(parseTuning(json)), json);
  const { mapper: visual } = mapper();
  visual.applyTuning(disableAllTuning(defaultTuning()));
  visual.applyTuning(defaultTuning());
  assert.equal(serializeTuning(visual.tuning), json);
});

test('import rejects malformed types, unknown fields and versions atomically; clamps finite values', () => {
  const { mapper: visual, engine } = mapper();
  visual.update(features());
  const before = serializeTuning(visual.tuning);
  const calls = engine.parameterCalls.length;
  for (const mutate of [
    (c) => { c.version = 99; }, (c) => { c.transient.width = '0.2'; },
    (c) => { c.influence.enabled = 1; }, (c) => { delete c.temporal; },
    (c) => { c.master.extra = true; }, (c) => { c.transient.width = NaN; },
  ]) {
    const c = defaultTuning(); mutate(c);
    assert.throws(() => visual.applyTuning(c));
    assert.equal(serializeTuning(visual.tuning), before);
    assert.equal(engine.parameterCalls.length, calls);
  }
  assert.throws(() => parseTuning('{broken'));
  for (const item of TUNING_SCHEMA.filter((entry) => typeof entry.default === 'number')) {
    const c = defaultTuning();
    if (item.path === 'transient.pitchMinimum') c.transient.pitchMaximum = 127;
    const keys = item.path.split('.'); const last = keys.pop();
    keys.reduce((o, key) => o[key], c)[last] = item.maximum + 100;
    assert.equal(getTuningValue(parseTuning(JSON.stringify(c)), item.path), item.maximum);
  }
});

test('disable all emits no events or influence and restores all global baselines', () => {
  const { mapper: visual, engine } = mapper();
  visual.update(features());
  visual.applyTuning(disableAllTuning(visual.tuning));
  const count = engine.influences.length;
  visual.update(features({ position: 2 }));
  assert.equal(visual.emitEvent({ type: 'note-on', note: 80, velocity: 1 }, features()), false);
  assert.equal(engine.influences.length, count);
  assert.deepEqual(engine.parameterCalls.at(-1).changes, baseline);
  assert.equal(engine.motion.at(-1).enabled, false);
  assert.equal(engine.membrane.at(-1).enabled, false);
});

test('each disabled global mapping restores only its target and import takes effect immediately', () => {
  for (const name of Object.keys(baseline)) {
    const { mapper: visual, engine } = mapper();
    visual.update(features({ register01: 0.8 }));
    const before = engine.parameterCalls.at(-1).changes;
    const c = defaultTuning(); c.parameterMappings[name].enabled = false;
    const featureReference = visual.lastFeatures;
    visual.applyTuning(parseTuning(serializeTuning(c)));
    assert.deepEqual(engine.parameterCalls.at(-1).changes, { ...before, [name]: baseline[name] });
    assert.equal(visual.lastFeatures, featureReference);
    assert.equal(featureReference.position, 1);
  }
});

test('transient relationships can be disabled independently without removing the event', () => {
  const event = { type: 'note-on', note: 90, velocity: 0.9 };
  const f = features({ sustain01: 1 });
  const read = (c) => {
    const { mapper: visual, engine } = mapper(); visual.applyTuning(c); visual.emitEvent(event, f);
    return engine.events[0];
  };
  const original = read(defaultTuning());
  for (const key of ['pitchPosition', 'velocityPosition', 'velocityAmplitude', 'pitchWavelength', 'energyPropagation', 'sustainLifetime']) {
    const c = defaultTuning(); c.transient[key] = false;
    const value = read(c);
    assert.ok(value, key);
    assert.notDeepEqual(value, original, key);
    if (!key.includes('Position')) assert.deepEqual(value.position, original.position);
    if (key !== 'velocityAmplitude') assert.equal(value.strength, original.strength);
    if (key !== 'sustainLifetime') assert.equal(value.lifetime, original.lifetime);
    for (const [control, parameter] of [['pitchWavelength', 'wavelength'], ['energyPropagation', 'propagationSpeed']]) {
      if (key !== control) assert.equal(value.parameters[parameter], original.parameters[parameter]);
    }
  }
  const c = defaultTuning(); c.transient.enabled = false;
  assert.equal(read(c), undefined);
});

test('spatial switches isolate position, velocity, radius, strength and each activity source', () => {
  const { mapper: visual, engine } = mapper();
  const c = defaultTuning(); c.influence.registerPosition = false;
  visual.applyTuning(c);
  visual.update(features({ position: 1, register01: 0.2 }));
  visual.update(features({ position: 2, register01: 0.8 }));
  assert.deepEqual(engine.influences.at(-1).position, { x: 0, y: 0 });
  assert.ok(engine.influences.at(-1).velocity.x > 0);
  c.influence.registerVelocity = false; c.influence.spanRadius = false; c.influence.energyStrength = false;
  visual.applyTuning(c);
  const influence = engine.influences.at(-1);
  assert.deepEqual(influence.velocity, { x: 0, y: 0 });
  assert.equal(influence.radius, c.influence.baseRadius + c.influence.radiusMinimumDelta);
  assert.equal(influence.strength, c.influence.strengthMinimumActive);
  for (const source of ['soundingActivity', 'densityActivity']) {
    const gate = defaultTuning(); gate.influence[source] = false;
    visual.applyTuning(gate, features({ soundingPolyphony: source === 'soundingActivity' ? 3 : 0, density01: source === 'densityActivity' ? 1 : 0 }));
    assert.equal(engine.influences.at(-1).engaged, false);
  }
  c.influence.activityGate = false;
  visual.applyTuning(c, features({ soundingPolyphony: 0, density01: 0 }));
  assert.equal(engine.influences.at(-1).engaged, true);
});

test('Solo preserves values and isolates each global mapping with no field or attacks', () => {
  for (const name of Object.keys(baseline)) {
    const c = defaultTuning(); c.parameterMappings.flowSpeed.delta = -0.2;
    const solo = soloTuning(c, `parameterMappings.${name}.enabled`);
    assert.equal(solo.parameterMappings.flowSpeed.delta, -0.2);
    const { mapper: visual, engine } = mapper(); visual.applyTuning(solo, features({ register01: 0.8 }));
    assert.equal(engine.influences.length, 0);
    for (const target of Object.keys(baseline)) if (target !== name) assert.equal(engine.parameterCalls.at(-1).changes[target], baseline[target]);
    assert.equal(visual.emitEvent({ type: 'note-on', note: 60, velocity: 1 }, features()), false);
  }
  const solo = soloTuning(defaultTuning(), 'transient.pitchPosition');
  assert.equal(solo.transient.enabled, true);
  assert.equal(solo.interactions.rippleDisplacement.enabled, true);
  assert.equal(solo.transient.velocityAmplitude, false);
});

test('optional smoothing is bypassed by default and bounded when enabled', () => {
  const { mapper: visual, engine } = mapper();
  const c = defaultTuning(); c.temporal.enabled = true; c.temporal.responseSeconds = 1;
  visual.applyTuning(c, features({ position: 0, energy01: 0 }));
  visual.update(features({ position: 0.1, energy01: 1 }), { forceParameters: true });
  const value = engine.parameterCalls.at(-1).changes.flowSpeed;
  assert.ok(value > baseline.flowSpeed && value < baseline.flowSpeed + 0.7);
  visual.applyTuning(defaultTuning());
  assert.equal(engine.parameterCalls.at(-1).changes.flowSpeed, baseline.flowSpeed + 0.7);
  c.temporal.parameterSmoothing = false;
  visual.applyTuning(c);
  assert.equal(engine.parameterCalls.at(-1).options.transition, 'immediate');
});
