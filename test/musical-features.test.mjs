import assert from 'node:assert/strict';
import test from 'node:test';
import { MidiTransport } from '../apps/lumison/src/midi/midi-transport.js';
import {
  createPerformanceState,
  createPerformanceTimeline,
  rebuildPerformanceState,
  reducePerformanceState,
} from '../apps/lumison/src/midi/performance-state.js';
import {
  createMusicalFeatureState,
  rebuildMusicalFeatureState,
  reduceMusicalFeatureState,
  updateMusicalFeatureState,
} from '../apps/lumison/src/music/musical-features.js';

const close = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};
const note = (type, timestamp, noteNumber, velocity = 1, channel = 1) => ({
  type, timestamp, note: noteNumber, velocity, channel,
});
const cc = (timestamp, controller, rawValue, channel = 1) => ({
  type: 'control-change', timestamp, channel, controller,
  rawValue, value: rawValue / 127,
});

function progress(events, position) {
  const performance = createPerformanceState();
  const features = createMusicalFeatureState();
  for (const event of events) {
    if (event.timestamp > position) break;
    reducePerformanceState(performance, event);
    reduceMusicalFeatureState(features, event, performance);
  }
  performance.position = position;
  updateMusicalFeatureState(features, performance, position);
  return { performance, features };
}

function publicFeatures(features) {
  const { attackHistory, ...values } = features;
  return values;
}

test('rolling attack rates and velocity means use MIDI timeline windows', () => {
  const events = [
    note('note-on', 0, 60, 0.2),
    note('note-on', 0.5, 62, 0.6),
    note('note-on', 1.5, 64, 1),
    note('note-off', 1.7, 64, 0),
  ];
  const { features } = progress(events, 2);
  assert.equal(features.attackRate1s, 1);
  assert.equal(features.attackRate4s, 0.75);
  assert.equal(features.attackVelocity1s, 1);
  close(features.attackVelocity4s, 0.6);

  updateMusicalFeatureState(features, createPerformanceState(), 5.6);
  assert.equal(features.attackRate1s, 0);
  assert.equal(features.attackRate4s, 0);
  assert.equal(features.attackVelocity1s, 0);
});

test('sounding voices drive weighted centroid, register, span, and polyphony', () => {
  const { features } = progress([
    note('note-on', 0, 21, 0.25),
    note('note-on', 0.1, 69, 0.75),
  ], 0.2);
  assert.equal(features.soundingPolyphony, 2);
  close(features.polyphony01, 1 - Math.exp(-2 / 4));
  close(features.pitchCentroid, 57);
  close(features.register01, 36 / 87);
  assert.equal(features.pitchSpan, 48);
  assert.equal(features.span01, 1);
});

test('pitch motion is mean successive attack distance normalized around an octave', () => {
  const { features } = progress([
    note('note-on', 0, 60),
    note('note-on', 0.2, 72),
    note('note-on', 0.4, 78),
  ], 0.5);
  close(features.pitchMotion01, 0.75);
});

test('continuous half-pedal value and transparent energy formula are preserved', () => {
  const { features } = progress([
    cc(0, 64, 32),
    note('note-on', 0.1, 60, 0.8),
  ], 0.2);
  close(features.sustain01, 32 / 127);
  close(
    features.energy01,
    0.45 * features.attackVelocity1s
      + 0.35 * features.density01
      + 0.20 * features.polyphony01,
  );
});

test('silence has null pitch and zero aggregate features after rolling history expires', () => {
  const { performance, features } = progress([
    note('note-on', 0, 60, 0.7),
    note('note-off', 0.2, 60, 0),
  ], 5);
  assert.equal(performance.soundingPolyphony, 0);
  assert.equal(features.pitchCentroid, null);
  assert.equal(features.register01, null);
  assert.equal(features.pitchSpan, 0);
  assert.equal(features.density01, 0);
  assert.equal(features.energy01, 0);
});

test('direct rebuild at T matches natural progression without historical callbacks', () => {
  const events = [
    { type: 'tempo-change', timestamp: 0, bpm: 90 },
    note('note-on', 1, 48, 0.4),
    note('note-off', 1.2, 48, 0),
    note('note-on', 3, 72, 0.8),
    cc(3.2, 64, 96),
    note('note-off', 3.4, 72, 0),
    note('note-on', 6, 84, 1),
  ];
  const position = 3.8;
  const natural = progress(events, position);
  const performance = rebuildPerformanceState(createPerformanceTimeline(events), position);
  const rebuilt = rebuildMusicalFeatureState(events, performance, position);
  assert.deepEqual(publicFeatures(rebuilt), publicFeatures(natural.features));
  assert.equal(rebuilt.attackHistory.length, 2);
  assert.equal(rebuilt.tempoBpm, 90);
});

test('playback rate does not change features at the same MIDI position', () => {
  const events = [
    note('note-on', 0.2, 60, 0.4),
    note('note-on', 0.8, 67, 0.9),
    note('note-off', 1.1, 60, 0),
  ];
  const run = (rate, wallTime) => {
    let now = 0;
    const performance = createPerformanceState();
    const features = createMusicalFeatureState();
    const transport = new MidiTransport({
      now: () => now,
      onEvents: (due) => {
        for (const event of due) {
          reducePerformanceState(performance, event);
          reduceMusicalFeatureState(features, event, performance);
        }
      },
    });
    transport.setTimeline(events, 3);
    transport.setRate(rate);
    transport.play();
    now = wallTime;
    transport.tick();
    performance.position = transport.position;
    updateMusicalFeatureState(features, performance, transport.position);
    return publicFeatures(features);
  };
  assert.deepEqual(run(0.5, 3), run(2, 0.75));
});
