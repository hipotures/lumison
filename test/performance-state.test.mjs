import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPerformanceState,
  createPerformanceTimeline,
  rebuildPerformanceState,
  reducePerformanceState,
} from '../apps/lumison/src/midi/performance-state.js';

const note = (type, timestamp, noteNumber, velocity = 1, channel = 1) => ({
  type, timestamp, note: noteNumber, velocity, channel,
});
const cc = (timestamp, controller, rawValue, channel = 1) => ({
  type: 'control-change', timestamp, channel, controller,
  rawValue, value: rawValue / 127,
});

test('PerformanceState tracks active notes, polyphony, range, and channels', () => {
  const state = createPerformanceState();
  reducePerformanceState(state, note('note-on', 0, 60, 0.5));
  reducePerformanceState(state, note('note-on', 0.1, 72, 1, 2));
  reducePerformanceState(state, note('note-on', 0.2, 60, 0.75));
  assert.equal(state.polyphony, 3);
  assert.equal(state.activeNotes.size, 2);
  assert.equal(state.lowestActiveNote, 60);
  assert.equal(state.highestActiveNote, 72);
  assert.equal(state.channelActivity.get(1).activeNotes, 2);

  reducePerformanceState(state, note('note-off', 0.3, 60, 0.25));
  assert.equal(state.polyphony, 2);
  reducePerformanceState(state, note('note-off', 0.4, 60, 0));
  assert.equal(state.polyphony, 1);
  assert.equal(state.lowestActiveNote, 72);
  assert.equal(state.lastVelocity, 0);
  assert.equal(state.lastNoteType, 'note-off');
});

test('PerformanceState retains sustain, sostenuto, and soft-pedal values', () => {
  const state = createPerformanceState();
  reducePerformanceState(state, cc(0, 64, 48));
  assert.deepEqual(state.sustain, { value: 48 / 127, rawValue: 48, on: false, channel: 1 });
  reducePerformanceState(state, cc(0.1, 64, 96));
  reducePerformanceState(state, cc(0.2, 66, 127, 2));
  reducePerformanceState(state, cc(0.3, 67, 64));
  assert.equal(state.sustain.on, true);
  assert.equal(state.sostenuto.on, true);
  assert.equal(state.sostenuto.channel, 2);
  assert.equal(state.soft.on, true);
  assert.equal(state.controllers.get(1).get(64), 96);
});

test('seek reconstruction restores crossing notes and controller/tempo state', () => {
  const events = [
    note('note-on', 0, 60, 0.8),
    cc(0.5, 64, 100),
    note('note-on', 1, 67, 0.7),
    note('note-off', 2, 60, 0.2),
    { type: 'tempo-change', timestamp: 3, bpm: 90 },
    cc(4, 64, 0),
  ];
  const timeline = createPerformanceTimeline(events, { checkpointEvery: 2 });

  const middle = rebuildPerformanceState(timeline, 1.5);
  assert.equal(middle.polyphony, 2);
  assert.equal(middle.sustain.rawValue, 100);
  assert.equal(middle.currentTempo, 120);
  assert.equal(middle.position, 1.5);

  const later = rebuildPerformanceState(timeline, 3.5);
  assert.equal(later.polyphony, 1);
  assert.equal(later.lowestActiveNote, 67);
  assert.equal(later.currentTempo, 90);

  const earlier = rebuildPerformanceState(timeline, 0.25);
  assert.equal(earlier.polyphony, 1);
  assert.equal(earlier.sustain.rawValue, 0);
  assert.equal(earlier.currentTempo, 120);
});
