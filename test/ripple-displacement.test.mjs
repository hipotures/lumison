import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRippleDisplacementEvent,
  createRippleDisplacementState,
  createTransientStore,
  MAX_TRANSIENT_CAPACITY,
  RIPPLE_DISPLACEMENT_CALIBRATION,
  RIPPLE_DISPLACEMENT_CAPACITY,
  RIPPLE_DISPLACEMENT_EVENT_TYPE,
  RIPPLE_EVENT_DEFAULTS,
  rippleDisplacementAt,
  rippleDisplacementRenderState,
  rippleEventDisplacementAt,
  setParameterLock,
  TflEngine,
} from '../packages/tfl-engine/src/index.js';
import {
  createRippleTriggerPolicy,
  RIPPLE_DRAG_SPACING,
} from '../apps/tfl-lab/src/ripple-trigger.js';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

const descriptor = (x = 0, y = 0, overrides = {}) => createRippleDisplacementEvent({
  origin: { x, y },
  ...overrides,
});

test('ripple events use inactive slots first and evict the oldest allocation at capacity', () => {
  assert.equal(createTransientStore(Number.MAX_SAFE_INTEGER).capacity, MAX_TRANSIENT_CAPACITY);
  assert.equal(MAX_TRANSIENT_CAPACITY, RIPPLE_DISPLACEMENT_CAPACITY);
  const engine = new TflEngine({ eventCapacity: RIPPLE_DISPLACEMENT_CAPACITY });
  for (let index = 0; index < RIPPLE_DISPLACEMENT_CAPACITY; index++) {
    const result = engine.emitTransientEvent(descriptor(index / 100, 0));
    assert.equal(result.accepted, true);
    assert.equal(result.slot, index);
    assert.equal(result.evicted, null);
  }
  assert.equal(engine.events.entries.length, RIPPLE_DISPLACEMENT_CAPACITY);
  assert.equal(rippleDisplacementRenderState(
    engine.rippleDisplacement,
    engine.events,
  ).events.length, RIPPLE_DISPLACEMENT_CAPACITY);

  const overflow = engine.emitTransientEvent(descriptor(0.75, -0.2));
  assert.equal(overflow.slot, 0);
  assert.equal(overflow.evicted.sequence, 0);
  assert.deepEqual(engine.events.entries[0].position, { x: 0.75, y: -0.2 });

  engine.events.entries[4].active = false;
  const reused = engine.emitTransientEvent(descriptor(-0.3, 0.25));
  assert.equal(reused.slot, 4);
  assert.equal(reused.evicted, null);
});

test('a ripple origin remains fixed while age advances and the influence can move', () => {
  const engine = new TflEngine();
  engine.setRippleDisplacement({ enabled: true });
  engine.emitTransientEvent(descriptor(-0.21, 0.17));
  const origin = structuredClone(engine.events.entries[0].position);
  engine.setSpatialInfluence({
    id: 'moving-source',
    position: { x: 0.6, y: -0.3 },
    velocity: { x: 1, y: 0 },
    radius: 0.19,
    strength: 1,
    engaged: true,
    positionValid: true,
  });
  engine.advance(0.4);
  assert.deepEqual(engine.events.entries[0].position, origin);
  assert.equal(engine.events.entries[0].age, 0.4);
  assert.deepEqual(
    rippleDisplacementRenderState(engine.rippleDisplacement, engine.events).events[0].position,
    origin,
  );
});

test('event age is deterministic under dt subdivision and freezes while paused', () => {
  const run = (steps) => {
    const engine = new TflEngine();
    engine.emitTransientEvent(descriptor());
    for (const dt of steps) engine.advance(dt);
    return engine.events.entries[0].age;
  };
  close(run([0.75]), run([0.25, 0.2, 0.3]));

  const paused = new TflEngine();
  paused.emitTransientEvent(descriptor());
  paused.setPaused(true);
  paused.advance(1.5);
  assert.equal(paused.events.entries[0].age, 0);
  paused.setPaused(false);
  paused.advance(0.25);
  assert.equal(paused.events.entries[0].age, 0.25);
});

test('ripple decay follows event lifetime rather than frame count', () => {
  const makeAtAge = (age) => {
    const engine = new TflEngine();
    engine.setRippleDisplacement({ enabled: true });
    engine.emitTransientEvent(descriptor());
    engine.advance(age);
    return rippleDisplacementRenderState(engine.rippleDisplacement, engine.events).events[0];
  };
  const early = makeAtAge(0.2);
  const late = makeAtAge(1.2);
  const atQuarterWave = (event) => ({
    x: event.position.x + event.age * event.propagationSpeed + event.wavelength / 4,
    y: event.position.y,
  });
  const earlyMagnitude = Math.abs(rippleEventDisplacementAt(
    early,
    atQuarterWave(early),
    { enabled: true, gain: 1 },
  ).x);
  const lateMagnitude = Math.abs(rippleEventDisplacementAt(
    late,
    atQuarterWave(late),
    { enabled: true, gain: 1 },
  ).x);
  assert.ok(earlyMagnitude > lateMagnitude);
  const quarterWaveEnvelope = Math.exp(
    -((early.wavelength / 4) ** 2) / (2 * early.width ** 2),
  );
  close(
    earlyMagnitude,
    early.displacement * quarterWaveEnvelope * (1 - early.age / early.lifetime) ** 2,
    1e-9,
  );
});

test('multiple ripple events retain independent origins and sum independently', () => {
  const engine = new TflEngine();
  engine.setRippleDisplacement({ enabled: true, gain: 0.5 });
  engine.emitTransientEvent(descriptor(-0.2, 0));
  engine.advance(0.1);
  engine.emitTransientEvent(descriptor(0.25, 0.1, { amplitude: 0.7 }));
  engine.advance(0.15);
  const render = rippleDisplacementRenderState(engine.rippleDisplacement, engine.events);
  assert.equal(render.activeEventCount, 2);
  assert.deepEqual(render.events[0].position, { x: -0.2, y: 0 });
  assert.deepEqual(render.events[1].position, { x: 0.25, y: 0.1 });
  assert.equal(render.events[0].age, 0.25);
  assert.equal(render.events[1].age, 0.15);

  const sample = { x: 0.02, y: 0.03 };
  const first = rippleEventDisplacementAt(render.events[0], sample, render);
  const second = rippleEventDisplacementAt(render.events[1], sample, render);
  const combined = rippleDisplacementAt(render, sample);
  close(combined.x, first.x + second.x);
  close(combined.y, first.y + second.y);
});

test('zero global or per-event ripple gain produces identity displacement', () => {
  const store = createTransientStore();
  const engine = new TflEngine();
  engine.setRippleDisplacement({ enabled: true, gain: 0 });
  engine.emitTransientEvent(descriptor(0, 0));
  engine.advance(0.2);
  const zeroGlobal = rippleDisplacementRenderState(engine.rippleDisplacement, engine.events);
  assert.equal(zeroGlobal.events[0].displacement, 0);
  assert.deepEqual(rippleDisplacementAt(zeroGlobal, { x: 0.1, y: 0 }), { x: 0, y: 0 });

  const state = createRippleDisplacementState({ enabled: true, gain: 1 });
  const noEventGain = descriptor(0, 0, { displacementGain: 0 });
  const eventEngine = new TflEngine();
  eventEngine.setRippleDisplacement({ enabled: true });
  eventEngine.emitTransientEvent(noEventGain);
  eventEngine.advance(0.2);
  const render = rippleDisplacementRenderState(state, eventEngine.events);
  assert.equal(render.events[0].displacement, 0);
  assert.equal(store.entries.length, RIPPLE_DISPLACEMENT_CAPACITY);
});

test('expired ripple events become explicit inactive slots', () => {
  const engine = new TflEngine();
  engine.emitTransientEvent(descriptor(0.1, -0.1, { lifetime: 0.2 }));
  engine.advance(0.199);
  assert.equal(engine.events.entries[0].active, true);
  engine.advance(0.001);
  assert.equal(engine.events.entries[0].active, false);
  assert.equal(engine.events.entries[0].type, '');
  assert.deepEqual(engine.events.entries[0].parameters, {});
});

test('click policy creates one stable source-neutral origin', () => {
  const policy = createRippleTriggerPolicy({ clickEnabled: true, dragEnabled: false });
  const origin = { x: -0.12, y: 0.24 };
  const events = policy.begin(origin);
  assert.deepEqual(events, [origin]);
  origin.x = 9;
  assert.deepEqual(events[0], { x: -0.12, y: 0.24 });
  const engine = new TflEngine();
  engine.setRippleDisplacement({ enabled: true });
  const allocation = engine.emitTransientEvent(createRippleDisplacementEvent({
    origin: events[0],
  }));
  assert.equal(allocation.accepted, true);
  assert.deepEqual(engine.events.entries[allocation.slot].position, events[0]);
  assert.deepEqual(policy.move({ x: 0.4, y: 0.2 }), []);
  policy.end();
  assert.deepEqual(policy.move({ x: 0.5, y: 0.2 }), []);
});

test('drag policy emits distance-spaced origins instead of the current position', () => {
  const policy = createRippleTriggerPolicy({
    clickEnabled: false,
    dragEnabled: true,
    spacing: 0.1,
  });
  assert.deepEqual(policy.begin({ x: 0, y: 0 }), []);
  assert.deepEqual(policy.move({ x: 0.06, y: 0 }), []);
  assert.deepEqual(policy.move({ x: 0.26, y: 0 }), [
    { x: 0.1, y: 0 },
    { x: 0.2, y: 0 },
  ]);
  const diagonal = policy.move({ x: 0.36, y: 0.1 });
  assert.equal(diagonal.length, 2);
  assert.ok(diagonal[0].x < 0.36 && diagonal[0].y < 0.1);
  assert.deepEqual(policy.snapshot().configuration, {
    clickEnabled: false,
    dragEnabled: true,
    spacing: 0.1,
  });
  assert.equal(RIPPLE_DRAG_SPACING, 0.075);
});

test('drag ripple spacing is independent of straight-line event subdivision', () => {
  const run = (positions) => {
    const policy = createRippleTriggerPolicy({
      clickEnabled: false,
      dragEnabled: true,
      spacing: 0.075,
    });
    policy.begin({ x: 0, y: 0 });
    return positions.flatMap((position) => policy.move(position));
  };
  const oneMove = run([{ x: 0.3, y: 0 }]);
  const manyMoves = run([
    { x: 0.04, y: 0 },
    { x: 0.11, y: 0 },
    { x: 0.19, y: 0 },
    { x: 0.3, y: 0 },
  ]);
  const rounded = (events) => events.map(({ x, y }) => ({
    x: Number(x.toFixed(12)),
    y: Number(y.toFixed(12)),
  }));
  assert.deepEqual(rounded(manyMoves), rounded(oneMove));
  assert.deepEqual(rounded(oneMove), [
    { x: 0.075, y: 0 },
    { x: 0.15, y: 0 },
    { x: 0.225, y: 0 },
    { x: 0.3, y: 0 },
  ]);
});

test('ripple validation rejects malformed configuration and event semantics', () => {
  const engine = new TflEngine();
  const report = engine.setRippleDisplacement({ enabled: 'yes', gain: 3, radius: 0.2 });
  assert.equal(report.ok, false);
  assert.equal(report.accepted.length, 0);
  assert.deepEqual(report.rejected.map((entry) => entry.reason), [
    'value-must-be-boolean',
    'value-out-of-range',
    'unknown-ripple-displacement-setting',
  ]);
  assert.throws(
    () => descriptor(0, 0, { wavelength: 0 }),
    /ripple-wavelength-out-of-range/,
  );
  const malformed = descriptor();
  malformed.parameters.propagationSpeed = Infinity;
  assert.equal(engine.emitTransientEvent(malformed).accepted, false);
  assert.equal(engine.events.nextSequence, 0);
});

test('ripple displacement is bounded with many coincident events', () => {
  const engine = new TflEngine();
  engine.setRippleDisplacement({ enabled: true, gain: 2 });
  for (let index = 0; index < RIPPLE_DISPLACEMENT_CAPACITY; index++) {
    engine.emitTransientEvent(descriptor(0, 0, { amplitude: 2, displacementGain: 2 }));
  }
  engine.advance(0.2);
  const render = rippleDisplacementRenderState(engine.rippleDisplacement, engine.events);
  const wave = rippleDisplacementAt(render, { x: 0.1, y: 0 });
  assert.ok(Number.isFinite(wave.x) && Number.isFinite(wave.y));
  assert.ok(Math.hypot(wave.x, wave.y)
    <= RIPPLE_DISPLACEMENT_CALIBRATION.maximumCombinedDisplacement + 1e-12);
});

test('ripple configuration and runtime replay deterministically without affecting scene policy', () => {
  const run = () => {
    const engine = new TflEngine();
    engine.applyPreset('Deep Violet', { transition: 'immediate' });
    engine.setParameter('exposure', 1.17);
    setParameterLock(engine.state, 'exposure', true);
    const target = structuredClone(engine.state.target);
    const locks = structuredClone(engine.state.locks);
    const preset = engine.state.preset;
    engine.setRippleDisplacement({ enabled: true, gain: 1.4 });
    engine.emitTransientEvent(descriptor(-0.1, 0.2));
    engine.advance(0.1);
    engine.emitTransientEvent(descriptor(0.2, -0.15, { amplitude: 0.8 }));
    for (const dt of [1 / 60, 1 / 30, 0.025]) engine.advance(dt);
    assert.deepEqual(engine.state.target, target);
    assert.deepEqual(engine.state.locks, locks);
    assert.equal(engine.state.preset, preset);
    return engine.createSnapshot({ includeRuntime: true });
  };
  assert.deepEqual(run(), run());

  const saved = run();
  const restored = new TflEngine();
  assert.equal(restored.restoreSnapshot(saved, { restoreRuntime: true }).ok, true);
  assert.deepEqual(restored.createSnapshot({ includeRuntime: true }), saved);
  restored.factoryReset();
  assert.deepEqual(restored.getRippleDisplacementConfiguration(), { enabled: false, gain: 1 });
  assert.equal(restored.events.entries.some((entry) => entry.active), false);
});

test('default ripple payload preserves the accepted Phase 3C compatibility path', () => {
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
  engine.render();
  assert.equal(rendered.rippleDisplacement.enabled, false);
  assert.equal(rendered.rippleDisplacement.gain, 1);
  assert.equal(rendered.rippleDisplacement.activeEventCount, 0);
  assert.equal(rendered.rippleDisplacement.events.length, RIPPLE_DISPLACEMENT_CAPACITY);
  assert.ok(rendered.rippleDisplacement.events.every((event) => event.displacement === 0));
  assert.equal(RIPPLE_EVENT_DEFAULTS.displacementGain, 1);
  assert.equal(RIPPLE_DISPLACEMENT_EVENT_TYPE, 'ripple-displacement');
});
