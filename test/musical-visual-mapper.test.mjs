import assert from 'node:assert/strict';
import test from 'node:test';
import { PARAM_SCHEMA, surfaceToNormalizedViewport } from '../packages/tfl-engine/src/index.js';
import { MUSICAL_FIELD_V1 } from '../apps/lumison/src/visual/mapping-profiles.js';
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
