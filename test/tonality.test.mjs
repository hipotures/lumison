import test from 'node:test';
import assert from 'node:assert/strict';
import { TONAL_PROFILES, inferKey, keySignature, fifthsCoordinates, fifthsDistance, TonalityTimeline, TonalityAnalyzer } from '../apps/lumison/src/music/tonality.js';
import { parseMidiFile, convertParsedMidi } from '../apps/lumison/src/midi/midi-file.js';
import { defaultTuning, parseTuning, serializeTuning, soloTuning, disableAllTuning } from '../apps/lumison/src/visual/visual-tuning.js';
import { TonalTransition, tonalOffsets } from '../apps/lumison/src/visual/tonal-mapping.js';
import { MusicalVisualMapper } from '../apps/lumison/src/visual/musical-visual-mapper.js';
import { TflEngine, PARAM_SCHEMA } from '../packages/tfl-engine/src/index.js';

const rotate = (profile, tonic) => profile.map((_, pc) => profile[(pc - tonic + 12) % 12]);
function note(start, end, pitch, channel = 1, velocity = 0.8) {
  return [{ type: 'note-on', timestamp: start, channel, note: pitch, velocity },
    { type: 'note-off', timestamp: end, channel, note: pitch, velocity: 0 }];
}
function profileNotes(tonic = 0, mode = 'major', start = 0, cycles = 4) {
  const events = [];
  // Each pitch-class duration follows the reference profile over an 8 s phrase.
  for (let cycle = 0; cycle < cycles; cycle++) {
    TONAL_PROFILES[mode].forEach((duration, pc) => events.push(...note(start + cycle * 8, start + cycle * 8 + duration, 48 + (pc + tonic) % 12)));
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}
const makeAnalyzer = (events, overrides = {}, signatures = []) => new TonalityAnalyzer(
  { ...defaultTuning().harmony.analysis, ...overrides }, new TonalityTimeline(events, signatures, events.at(-1)?.timestamp ?? 0),
);
const configured = () => {
  const c = defaultTuning(); c.harmony.mapping.enabled = true; c.harmony.mapping.influence = 1;
  c.harmony.mapping.targets.filmBase.enabled = true; c.harmony.mapping.targets.filmBase.amount = 100;
  return c;
};

test('MIDI key signatures parse signed accidentals and mode without entering canonical events', () => {
  const bytes = Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,10,
    0,255,89,2,253,1,0,255,47,0]);
  const parsed = parseMidiFile(bytes);
  assert.deepEqual(parsed.metadata.keySignatures, [{ timestamp: 0, fifths: -3, minor: 1 }]);
  assert.equal(parsed.events.length, 0);
  assert.deepEqual(keySignature(-3, 0), { timestamp: 0, fifths: -3, tonicPitchClass: 3, mode: 'major' });
  assert.equal(keySignature(-1, 1).tonicPitchClass, 2);
  assert.equal(keySignature(8, 0), null);
  const timed = convertParsedMidi({ header: { formatType: 1, ticksPerBeat: 480 }, tracks: [[
    { deltaTime: 0, type: 'meta', subtype: 'keySignature', key: 0, scale: 0 },
    { deltaTime: 480, type: 'meta', subtype: 'setTempo', microsecondsPerBeat: 1000000 },
    { deltaTime: 480, type: 'meta', subtype: 'keySignature', key: 2, scale: 1 },
  ]] });
  assert.equal(timed.metadata.keySignatures[1].timestamp, 1.5);
});

test('K-S profile matching is transposition equivariant for all 12 major and minor keys', () => {
  for (const mode of ['major', 'minor']) for (let tonic = 0; tonic < 12; tonic++) {
    const result = inferKey(rotate(TONAL_PROFILES[mode], tonic));
    assert.equal(result.key.tonicPitchClass, tonic); assert.equal(result.key.mode, mode);
    assert.ok(result.confidence > 0.999 && result.confidence <= 1);
    assert.ok(Number.isFinite(result.separation) && result.separation >= 0 && result.separation <= 1);
  }
});

test('synthetic duration-weighted notes infer C major, A minor and other tonal centers', () => {
  for (const [tonic, mode] of [[0, 'major'], [9, 'minor'], [3, 'major'], [6, 'minor'], [7, 'major'], [2, 'minor']]) {
    const timeline = new TonalityTimeline(profileNotes(tonic, mode));
    const result = inferKey(timeline.histogram(8, 8));
    assert.equal(result.key.tonicPitchClass, tonic); assert.equal(result.key.mode, mode);
  }
});

test('diatonic cadential melodies identify transposed major and harmonic-minor centers', () => {
  for (const mode of ['major', 'minor']) for (const tonic of [0, 3, 7, 9]) {
    const third = mode === 'major' ? 4 : 3;
    const pitches = [0, third, 7, 0, 7, 5, third, 2, 7, 11, 0];
    const durations = [0.8, 0.3, 0.3, 0.8, 0.4, 0.3, 0.3, 0.3, 0.5, 0.2, 1.2];
    let position = 0; const events = [];
    for (let repeat = 0; repeat < 6; repeat++) pitches.forEach((pitch, i) => {
      events.push(...note(position, position + durations[i], 48 + tonic + pitch)); position += durations[i];
    });
    const result = makeAnalyzer(events).seek(position);
    assert.deepEqual(result.key, { tonicPitchClass: tonic, mode });
    assert.ok(result.confidence >= 0.65);
  }
});

test('percussion is ignored; silence, a lone pitch and uniform evidence remain unknown', () => {
  const events = [...profileNotes(), ...profileNotes(6, 'minor').map((event) => ({ ...event, channel: 10 }))].sort((a, b) => a.timestamp - b.timestamp);
  assert.deepEqual(new TonalityTimeline(events).histogram(8, 8), new TonalityTimeline(profileNotes()).histogram(8, 8));
  for (const histogram of [Array(12).fill(0), Array(12).fill(1), [10, ...Array(11).fill(0)]]) {
    const result = inferKey(histogram); assert.equal(result.key, null); assert.equal(result.confidence, 0);
  }
  assert.equal(inferKey(new TonalityTimeline(note(0, 4, 60, 10)).histogram(4, 12)).key, null);
});

test('reattacks, doubled octaves and concurrent voices do not inflate chroma duration', () => {
  const held = new TonalityTimeline(note(0, 4, 60)).histogram(4, 4);
  const repeated = Array.from({ length: 16 }, (_, i) => note(i / 4, (i + 1) / 4, 60)).flat();
  const doubled = [...note(0, 4, 60), ...note(0, 4, 72, 2)].sort((a, b) => a.timestamp - b.timestamp);
  new TonalityTimeline(repeated).histogram(4, 4).forEach((value, pc) => assert.ok(Math.abs(value - held[pc]) < 1e-12));
  assert.deepEqual(new TonalityTimeline(doubled).histogram(4, 4), held);
  const pedal = [...note(0, 1, 60), { type: 'control-change', channel: 1, controller: 64, rawValue: 127, value: 1, timestamp: 0.5 },
    { type: 'control-change', channel: 1, controller: 64, rawValue: 0, value: 0, timestamp: 4 }].sort((a, b) => a.timestamp - b.timestamp);
  assert.deepEqual(new TonalityTimeline(pedal).histogram(4, 4), held);
});

test('metadata is selected when compatible and rejected when content strongly contradicts it', () => {
  const compatible = makeAnalyzer(profileNotes(), { windowSeconds: 8 }, [{ timestamp: 0, fifths: 0, minor: 0 }]);
  const good = compatible.seek(15.75);
  assert.deepEqual(good.key, { tonicPitchClass: 0, mode: 'major' });
  assert.equal(good.source, 'MIDI metadata'); assert.equal(good.inferred.tonicPitchClass, 0);
  const conflict = makeAnalyzer(profileNotes(), { windowSeconds: 8 }, [{ timestamp: 0, fifths: 6, minor: 1 }]);
  const rejected = conflict.seek(15.75);
  assert.deepEqual(rejected.key, { tonicPitchClass: 0, mode: 'major' }); assert.equal(rejected.source, 'inferred');
});

test('hysteresis requires a stable confident challenger and resists competing keys', () => {
  const analyzer = makeAnalyzer([], { minimumStableSeconds: 3 });
  let tonic = 0;
  analyzer.timeline = { histogram: () => rotate(TONAL_PROFILES.major, tonic), metadataAt: () => null };
  assert.equal(analyzer.update(2.75).key, null);
  assert.equal(analyzer.update(3).key.tonicPitchClass, 0);
  tonic = 7;
  assert.equal(analyzer.update(5.75).key.tonicPitchClass, 0);
  assert.equal(analyzer.update(6.25).key.tonicPitchClass, 7);
  for (let i = 26; i < 50; i++) { tonic = i % 2 ? 0 : 9; assert.equal(analyzer.update(i / 4).key.tonicPitchClass, 7); }
});

test('local modulation, frame-independent replay, seek and low-confidence hold policy', () => {
  const events = [...profileNotes(0, 'major', 0, 4), ...profileNotes(7, 'major', 32, 4)];
  const live = makeAnalyzer(events, { windowSeconds: 8 });
  assert.equal(live.update(24).key.tonicPitchClass, 0);
  for (let time = 24; time < 60; time += 0.37) live.update(time);
  const end = live.update(60);
  assert.equal(end.key.tonicPitchClass, 7);
  assert.deepEqual(makeAnalyzer(events, { windowSeconds: 8 }).seek(60), end);
  assert.deepEqual(live.seek(24).key, { tonicPitchClass: 0, mode: 'major' });
  live.update(90); assert.equal(live.snapshot.key.tonicPitchClass, 7);
  const forget = makeAnalyzer(events, { holdLastKey: false, windowSeconds: 8 });
  assert.equal(forget.seek(90).key, null);
});

test('circle of fifths adjacency, wrap and opposite tonic coordinates', () => {
  const circle = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  circle.forEach((tonic, index) => assert.equal(fifthsCoordinates(tonic).position, index));
  assert.equal(fifthsDistance(0, 7), 1); assert.equal(fifthsDistance(0, 5), 1); assert.equal(fifthsDistance(0, 6), 6);
  assert.ok(Math.abs(fifthsCoordinates(6).x + 1) < 1e-12);
});

test('tonal targets are disabled and neutral by default; zero amounts and disabled analysis contribute nothing', () => {
  const key = { tonicPitchClass: 0, mode: 'major' };
  assert.deepEqual(tonalOffsets(defaultTuning().harmony, key), {});
  const c = configured(); c.harmony.mapping.targets.filmBase.amount = 0;
  assert.deepEqual(tonalOffsets(c.harmony, key), {});
  c.harmony.mapping.targets.filmBase.amount = 100; c.harmony.analysis.enabled = false;
  assert.deepEqual(tonalOffsets(c.harmony, key), {});
});

test('smooth tonal transitions have continuous starts, exact endpoints and direct seek targets', () => {
  const c = configured(); const transition = new TonalTransition();
  const major = { tonicPitchClass: 0, mode: 'major' }; const opposite = { tonicPitchClass: 6, mode: 'minor' };
  assert.equal(transition.update(c.harmony, major, 0).filmBase, 0);
  assert.equal(transition.update(c.harmony, major, 2.5).filmBase, 50);
  assert.equal(transition.update(c.harmony, major, 5).filmBase, 100);
  assert.equal(transition.update(c.harmony, opposite, 6).filmBase, 100);
  assert.equal(transition.update(c.harmony, opposite, 11).filmBase, -100);
  assert.equal(transition.update(c.harmony, major, 3, { seek: true }).filmBase, 100);
  c.harmony.mapping.seekTransitionSeconds = 0.5;
  assert.equal(transition.update(c.harmony, opposite, 4, { seek: true }).filmBase, 100);
  assert.equal(transition.update(c.harmony, opposite, 4.5).filmBase, -100);
  c.harmony.mapping.targets.filmBase.enabled = false;
  assert.deepEqual(transition.update(c.harmony, major, 5), {});
});

test('parameter composition adds register and tonic offsets before a single clamp', () => {
  const baseline = Object.fromEntries(Object.entries(PARAM_SCHEMA).map(([name, value]) => [name, value.default]));
  baseline.filmBase = 950;
  const engine = new TflEngine(); const mapper = new MusicalVisualMapper({ engine, baseline });
  const c = configured(); c.harmony.mapping.targets.filmBase.amount = -100;
  const f = { position: 10, register01: 1, harmony: { key: { tonicPitchClass: 0, mode: 'major' } } };
  mapper.applyTuning(c, f); mapper.seek(f);
  assert.equal(mapper.mappedParameters(f).filmBase, 1000); // 950 + 180 - 100 -> 1030 -> 1000
  c.harmony.mapping.targets.filmBase.amount = -200;
  mapper.applyTuning(c, f); mapper.seek(f);
  assert.equal(mapper.mappedParameters(f).filmBase, 930); // not clamp(1130) - 200
  c.parameterMappings.filmBase.enabled = false; mapper.applyTuning(c, f); mapper.seek(f);
  assert.equal(mapper.mappedParameters(f).filmBase, 750);
  mapper.applyTuning(disableAllTuning(c), f);
  assert.equal(mapper.mappedParameters(f).filmBase, 950);
});

test('harmony JSON round trip, v1 migration and tonal Solo preserve all numeric choices', () => {
  const c = configured(); c.harmony.analysis.windowSeconds = 20; c.harmony.mapping.targets.azimuth.phaseDegrees = -90;
  assert.deepEqual(parseTuning(serializeTuning(c)), c);
  const solo = soloTuning(c, 'harmony.mapping.targets.filmBase.enabled');
  assert.equal(solo.harmony.mapping.targets.filmBase.amount, 100); assert.equal(solo.harmony.mapping.enabled, true);
  assert.equal(solo.transient.enabled, false); assert.equal(solo.influence.enabled, false);
  assert.ok(Object.values(solo.parameterMappings).every((mapping) => !mapping.enabled));
  const old = defaultTuning(); old.version = 1; delete old.harmony; old.master.sensitivity = 0.6;
  const migrated = parseTuning(JSON.stringify(old));
  assert.equal(migrated.version, 2); assert.equal(migrated.master.sensitivity, 0.6);
  assert.deepEqual(migrated.harmony, defaultTuning().harmony);
});

test('each tonal target can be isolated, reset and clamped without changing other target baselines', () => {
  const baseline = Object.fromEntries(Object.entries(PARAM_SCHEMA).map(([name, value]) => [name, value.default]));
  for (const name of Object.keys(defaultTuning().harmony.mapping.targets)) {
    const c = soloTuning(defaultTuning(), `harmony.mapping.targets.${name}.enabled`);
    c.harmony.mapping.influence = 1; c.harmony.mapping.targets[name].amount = 0.1;
    const engine = new TflEngine(); const mapper = new MusicalVisualMapper({ engine, baseline });
    const f = { position: 10, harmony: { key: { tonicPitchClass: 0, mode: 'major' } } };
    mapper.applyTuning(c, f); mapper.seek(f);
    const mapped = mapper.mappedParameters(f);
    assert.ok(Math.abs(mapped[name] - baseline[name] - 0.1) < 1e-10);
    for (const other of Object.keys(mapped)) if (other !== name) assert.equal(mapped[other], baseline[other]);
    c.harmony.mapping.targets[name].enabled = false; mapper.applyTuning(c, f);
    assert.equal(mapper.mappedParameters(f)[name], baseline[name]);
  }
});

test('loop applies only the reconstructed destination offset, without emitting attacks', () => {
  const baseline = Object.fromEntries(Object.entries(PARAM_SCHEMA).map(([name, value]) => [name, value.default]));
  const engine = new TflEngine(); const mapper = new MusicalVisualMapper({ engine, baseline });
  const c = configured();
  const f = { position: 30, register01: 0.5, harmony: { key: { tonicPitchClass: 6, mode: 'major' } } };
  mapper.applyTuning(c, f); mapper.seek(f);
  assert.equal(mapper.tonalValues.filmBase, -100);
  mapper.loop({ ...f, position: 0, harmony: { key: { tonicPitchClass: 0, mode: 'major' } } });
  assert.equal(mapper.tonalValues.filmBase, 100);
  assert.ok(engine.events.entries.every((event) => !event.active));
});
