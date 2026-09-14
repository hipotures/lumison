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
const apply = (state, ...events) => events.forEach((event) => reducePerformanceState(state, event));

test('held and sounding notes are explicit and repeated notes remain count-safe', () => {
  const state = createPerformanceState();
  apply(
    state,
    note('note-on', 0, 60, 0.5),
    note('note-on', 0.1, 72, 1, 2),
    note('note-on', 0.2, 60, 0.75),
  );
  assert.equal(state.heldPolyphony, 3);
  assert.equal(state.soundingPolyphony, 3);
  assert.equal(state.heldNotes.get('1:60').count, 2);
  assert.equal(state.soundingNotes.size, 2);
  assert.equal(state.lowestHeldNote, 60);
  assert.equal(state.highestSoundingNote, 72);
  assert.equal(state.channelActivity.get(1).heldNotes, 2);
  assert.equal(state.channelActivity.get(1).soundingNotes, 2);

  reducePerformanceState(state, note('note-off', 0.3, 60, 0.25));
  assert.equal(state.heldPolyphony, 2);
  assert.equal(state.soundingPolyphony, 2);
  reducePerformanceState(state, note('note-off', 0.4, 60, 0));
  assert.equal(state.heldPolyphony, 1);
  assert.equal(state.soundingPolyphony, 1);
  assert.equal(state.lowestSoundingNote, 72);
});

test('sustain retains released voices until it crosses down to up', () => {
  const state = createPerformanceState();
  apply(
    state,
    note('note-on', 0, 60, 0.8),
    cc(0.1, 64, 127),
    note('note-off', 0.2, 60, 0.3),
  );
  assert.equal(state.heldPolyphony, 0);
  assert.equal(state.soundingPolyphony, 1);
  assert.equal(state.sustain.on, true);

  reducePerformanceState(state, cc(0.3, 64, 0));
  assert.equal(state.heldPolyphony, 0);
  assert.equal(state.soundingPolyphony, 0);
});

test('pedal hold state applies only to its MIDI channel', () => {
  const state = createPerformanceState();
  apply(
    state,
    note('note-on', 0, 60, 1, 2),
    cc(0.1, 64, 127, 1),
    note('note-off', 0.2, 60, 0, 2),
  );
  assert.equal(state.sustain.on, true);
  assert.equal(state.heldPolyphony, 0);
  assert.equal(state.soundingPolyphony, 0);
});

test('sustain release preserves a currently held retriggered voice', () => {
  const state = createPerformanceState();
  apply(
    state,
    note('note-on', 0, 60),
    cc(0.1, 64, 127),
    note('note-off', 0.2, 60),
    note('note-on', 0.3, 60, 0.6),
  );
  assert.equal(state.heldPolyphony, 1);
  assert.equal(state.soundingPolyphony, 2);
  reducePerformanceState(state, cc(0.4, 64, 0));
  assert.equal(state.heldPolyphony, 1);
  assert.equal(state.soundingPolyphony, 1);
  assert.equal(state.soundingNotes.get('1:60').velocity, 0.6);
});

test('half-pedal values and soft pedal are preserved without extending notes', () => {
  const state = createPerformanceState();
  reducePerformanceState(state, cc(0, 64, 32));
  assert.deepEqual(state.sustain, { value: 32 / 127, rawValue: 32, on: false, channel: 1 });
  reducePerformanceState(state, cc(0.1, 64, 96));
  assert.deepEqual(state.sustain, { value: 96 / 127, rawValue: 96, on: true, channel: 1 });

  apply(
    state,
    cc(0.2, 64, 0),
    note('note-on', 0.3, 64),
    cc(0.4, 67, 64),
    note('note-off', 0.5, 64),
  );
  assert.equal(state.soft.on, true);
  assert.equal(state.soft.rawValue, 64);
  assert.equal(state.heldPolyphony, 0);
  assert.equal(state.soundingPolyphony, 0);
});

test('sostenuto latches existing voices but not notes struck afterward', () => {
  const state = createPerformanceState();
  apply(
    state,
    note('note-on', 0, 60),
    cc(0.1, 66, 127),
    note('note-off', 0.2, 60),
    note('note-on', 0.3, 64),
    note('note-off', 0.4, 64),
  );
  assert.equal(state.heldPolyphony, 0);
  assert.equal(state.soundingPolyphony, 1);
  assert.equal(state.soundingNotes.has('1:60'), true);
  assert.equal(state.soundingNotes.has('1:64'), false);

  reducePerformanceState(state, cc(0.5, 66, 0));
  assert.equal(state.soundingPolyphony, 0);
});

test('sustain and sostenuto independently retain the same voice', () => {
  const state = createPerformanceState();
  apply(
    state,
    note('note-on', 0, 60),
    cc(0.1, 66, 127),
    cc(0.2, 64, 127),
    note('note-off', 0.3, 60),
    cc(0.4, 64, 0),
  );
  assert.equal(state.soundingPolyphony, 1, 'sostenuto survives sustain release');

  apply(state, cc(0.5, 64, 127), cc(0.6, 66, 0));
  assert.equal(state.soundingPolyphony, 1, 'sustain survives sostenuto release');
  reducePerformanceState(state, cc(0.7, 64, 0));
  assert.equal(state.soundingPolyphony, 0);
});

test('attack and release velocity histories remain independent', () => {
  const state = createPerformanceState();
  apply(
    state,
    note('note-on', 1, 60, 0.76),
    note('note-off', 2, 60, 0.21),
  );
  assert.equal(state.lastAttackNote, 60);
  assert.equal(state.lastAttackVelocity, 0.76);
  assert.equal(state.lastAttackTimestamp, 1);
  assert.equal(state.lastReleaseNote, 60);
  assert.equal(state.lastReleaseVelocity, 0.21);
  assert.equal(state.lastReleaseTimestamp, 2);
  assert.equal(state.lastEventType, 'note-off');
});

test('channel mode controllers distinguish All Sound Off and All Notes Off', () => {
  const allSound = createPerformanceState();
  apply(
    allSound,
    note('note-on', 0, 60),
    cc(0.1, 64, 127),
    note('note-off', 0.2, 60),
    note('note-on', 0.3, 64),
    cc(0.4, 120, 0),
  );
  assert.equal(allSound.heldPolyphony, 0);
  assert.equal(allSound.soundingPolyphony, 0);

  const allNotes = createPerformanceState();
  apply(
    allNotes,
    note('note-on', 0, 60),
    note('note-on', 0.1, 64),
    cc(0.2, 64, 127),
    cc(0.3, 123, 0),
  );
  assert.equal(allNotes.heldPolyphony, 0);
  assert.equal(allNotes.soundingPolyphony, 2);
  reducePerformanceState(allNotes, cc(0.4, 64, 0));
  assert.equal(allNotes.soundingPolyphony, 0);
});

test('Reset All Controllers releases voices retained only by pedals', () => {
  const state = createPerformanceState();
  apply(
    state,
    note('note-on', 0, 60),
    cc(0.1, 64, 127),
    cc(0.2, 67, 127),
    note('note-off', 0.3, 60),
    cc(0.4, 121, 0),
  );
  assert.equal(state.sustain.on, false);
  assert.equal(state.soft.on, false);
  assert.equal(state.controllers.get(1).size, 0);
  assert.equal(state.soundingPolyphony, 0);
});

test('seek reconstruction restores pedal-held voices and later release state', () => {
  const events = [
    note('note-on', 0, 60, 0.8),
    cc(0.5, 64, 100),
    note('note-off', 1, 60, 0.2),
    { type: 'tempo-change', timestamp: 1.25, bpm: 90 },
    cc(2, 64, 0),
  ];
  const timeline = createPerformanceTimeline(events, { checkpointEvery: 2 });

  const sustained = rebuildPerformanceState(timeline, 1.5);
  assert.equal(sustained.heldPolyphony, 0);
  assert.equal(sustained.soundingPolyphony, 1);
  assert.equal(sustained.sustain.rawValue, 100);
  assert.equal(sustained.sustain.on, true);
  assert.equal(sustained.lastAttackVelocity, 0.8);
  assert.equal(sustained.lastReleaseVelocity, 0.2);
  assert.equal(sustained.currentTempo, 90);

  const released = rebuildPerformanceState(timeline, 2.5);
  assert.equal(released.heldPolyphony, 0);
  assert.equal(released.soundingPolyphony, 0);
  assert.equal(released.sustain.on, false);

  const beforePedal = rebuildPerformanceState(timeline, 0.25);
  assert.equal(beforePedal.heldPolyphony, 1);
  assert.equal(beforePedal.soundingPolyphony, 1);
  assert.equal(beforePedal.sustain.rawValue, 0);
  assert.equal(beforePedal.currentTempo, 120);
});

test('seek reconstruction preserves and releases a sostenuto latch', () => {
  const timeline = createPerformanceTimeline([
    note('note-on', 0, 60),
    cc(0.2, 66, 127),
    note('note-off', 0.4, 60),
    cc(0.8, 66, 0),
  ], { checkpointEvery: 2 });

  const latched = rebuildPerformanceState(timeline, 0.6);
  assert.equal(latched.heldPolyphony, 0);
  assert.equal(latched.soundingPolyphony, 1);
  assert.equal(latched.sostenuto.on, true);
  assert.equal(latched.sostenutoLatches.get(1).size, 1);

  const released = rebuildPerformanceState(timeline, 0.9);
  assert.equal(released.soundingPolyphony, 0);
  assert.equal(released.sostenuto.on, false);
  assert.equal(released.sostenutoLatches.has(1), false);
});
