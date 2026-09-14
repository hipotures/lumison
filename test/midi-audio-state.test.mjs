import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyReconstructedMidiState,
  createMidiChannelTimeline,
  rebuildMidiChannelState,
} from '../apps/lumison/src/audio/midi-channel-state.js';
import {
  createPerformanceTimeline,
  rebuildPerformanceState,
} from '../apps/lumison/src/midi/performance-state.js';

const cc = (timestamp, controller, rawValue, channel = 1) => ({
  type: 'control-change', timestamp, channel, controller,
  value: rawValue / 127, rawValue,
});
const note = (type, timestamp, noteNumber, velocity = 1, channel = 1) => ({
  type, timestamp, channel, note: noteNumber, velocity,
});

function recordingSynth() {
  const calls = [];
  const synth = { calls, reset: () => calls.push(['reset']) };
  for (const method of ['controllerChange', 'programChange', 'pitchWheel', 'noteOn', 'noteOff']) {
    synth[method] = (...args) => calls.push([method, ...args]);
  }
  return synth;
}

test('channel timeline reconstructs bank, program, controllers, pedals, and pitch bend', () => {
  const events = [
    cc(0, 0, 2),
    cc(0.1, 32, 3),
    { type: 'program-change', timestamp: 0.2, channel: 1, program: 41 },
    cc(0.3, 7, 100),
    cc(0.4, 64, 96),
    { type: 'pitch-bend', timestamp: 0.5, channel: 1, rawValue: 12000, value: 0.5 },
    cc(0.6, 121, 0),
    cc(0.7, 11, 80),
  ];
  const timeline = createMidiChannelTimeline(events, { checkpointEvery: 2 });
  const beforeReset = rebuildMidiChannelState(timeline, 0.55).channels.get(1);
  assert.equal(beforeReset.controllers.get(0), 2);
  assert.equal(beforeReset.controllers.get(32), 3);
  assert.equal(beforeReset.controllers.get(64), 96);
  assert.equal(beforeReset.controllers.get(7), 100);
  assert.equal(beforeReset.program, 41);
  assert.equal(beforeReset.pitchBend, 12000);

  const afterReset = rebuildMidiChannelState(timeline, 1).channels.get(1);
  assert.deepEqual([...afterReset.controllers], [[11, 80]]);
  assert.equal(afterReset.program, 41);
  assert.equal(afterReset.pitchBend, 12000);
});

test('seek reconstruction applies channel state then restarts held and pedal-retained voices', () => {
  const events = [
    cc(0, 0, 1),
    { type: 'program-change', timestamp: 0, channel: 1, program: 5 },
    note('note-on', 0.1, 60, 0.5),
    cc(0.2, 66, 127),
    note('note-off', 0.3, 60, 0.2),
    note('note-on', 0.4, 64, 0.75),
    cc(0.45, 64, 96),
    note('note-off', 0.5, 64, 0.1),
    { type: 'pitch-bend', timestamp: 0.55, channel: 1, rawValue: 9000, value: 0.1 },
  ];
  const position = 0.6;
  const channels = rebuildMidiChannelState(createMidiChannelTimeline(events), position);
  const performance = rebuildPerformanceState(createPerformanceTimeline(events), position);
  const synth = recordingSynth();
  applyReconstructedMidiState(synth, channels, performance, 12);

  assert.deepEqual(synth.calls[0], ['reset']);
  assert.ok(synth.calls.some((call) => call[0] === 'controllerChange'
    && call[1] === 0 && call[2] === 0 && call[3] === 1));
  assert.ok(synth.calls.some((call) => call[0] === 'programChange'
    && call[1] === 0 && call[2] === 5));
  assert.ok(synth.calls.some((call) => call[0] === 'pitchWheel'
    && call[1] === 0 && call[2] === 9000));
  assert.equal(synth.calls.filter((call) => call[0] === 'noteOn').length, 2);
  assert.equal(synth.calls.filter((call) => call[0] === 'noteOff').length, 2);

  const sostenutoIndex = synth.calls.findIndex((call) => call[0] === 'controllerChange'
    && call[2] === 66);
  const c4Index = synth.calls.findIndex((call) => call[0] === 'noteOn' && call[2] === 60);
  const e4Index = synth.calls.findIndex((call) => call[0] === 'noteOn' && call[2] === 64);
  assert.ok(c4Index < sostenutoIndex, 'latched voice exists before sostenuto goes down');
  assert.ok(sostenutoIndex < e4Index, 'later voice is not sostenuto-latched');
});

test('paused seek reconstructs channel state without starting sounding notes', () => {
  const events = [
    { type: 'program-change', timestamp: 0, channel: 2, program: 9 },
    note('note-on', 0.1, 67, 1, 2),
  ];
  const synth = recordingSynth();
  applyReconstructedMidiState(
    synth,
    rebuildMidiChannelState(createMidiChannelTimeline(events), 0.5),
    rebuildPerformanceState(createPerformanceTimeline(events), 0.5),
    3,
    { restartSounding: false },
  );
  assert.ok(synth.calls.some((call) => call[0] === 'programChange' && call[1] === 1));
  assert.equal(synth.calls.some((call) => call[0] === 'noteOn'), false);
});
