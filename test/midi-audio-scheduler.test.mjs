import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalChannelToSynth,
  dispatchCanonicalMidiEvent,
  MidiAudioScheduler,
  normalizedVelocityToMidi,
} from '../apps/lumison/src/audio/midi-audio-scheduler.js';

const midiEvent = (timestamp, type = 'note-on', extra = {}) => ({
  type, timestamp, channel: 1, note: 60, velocity: 1, ...extra,
});

function spySynth() {
  const calls = [];
  return {
    calls,
    noteOn: (...args) => calls.push(['noteOn', ...args]),
    noteOff: (...args) => calls.push(['noteOff', ...args]),
    controllerChange: (...args) => calls.push(['controllerChange', ...args]),
    programChange: (...args) => calls.push(['programChange', ...args]),
    pitchWheel: (...args) => calls.push(['pitchWheel', ...args]),
  };
}

test('canonical events convert to SpessaSynth channels and MIDI values', () => {
  assert.equal(canonicalChannelToSynth(1), 0);
  assert.equal(canonicalChannelToSynth(16), 15);
  assert.throws(() => canonicalChannelToSynth(0), RangeError);
  assert.equal(normalizedVelocityToMidi(0), 1);
  assert.equal(normalizedVelocityToMidi(0.5), 64);
  assert.equal(normalizedVelocityToMidi(1), 127);

  const synth = spySynth();
  dispatchCanonicalMidiEvent(synth, midiEvent(1, 'note-on', { channel: 16, note: 72, velocity: 0.5 }), 9);
  dispatchCanonicalMidiEvent(synth, midiEvent(1, 'note-off', { note: 72 }), 9.1);
  dispatchCanonicalMidiEvent(synth, midiEvent(1, 'control-change', { controller: 64, rawValue: 96 }), 9.2);
  dispatchCanonicalMidiEvent(synth, midiEvent(1, 'program-change', { program: 41 }), 9.3);
  dispatchCanonicalMidiEvent(synth, midiEvent(1, 'pitch-bend', { rawValue: 16383 }), 9.4);
  assert.deepEqual(synth.calls, [
    ['noteOn', 15, 72, 64, { time: 9 }],
    ['noteOff', 0, 72, { time: 9.1 }],
    ['controllerChange', 0, 64, 96, { time: 9.2 }],
    ['programChange', 0, 41, { time: 9.3 }],
    ['pitchWheel', 0, 16383, { time: 9.4 }],
  ]);
  assert.equal(dispatchCanonicalMidiEvent(synth, { type: 'tempo-change', bpm: 90 }, 10), false);
});

test('scheduler uses bounded lookahead and schedules each event exactly once at 1x', () => {
  const scheduled = [];
  const scheduler = new MidiAudioScheduler({
    lookaheadSeconds: 0.12,
    scheduleEvent: (event, time) => scheduled.push([event.id, time]),
  });
  scheduler.setTimeline([
    { timestamp: 0.05, id: 'a' },
    { timestamp: 0.12, id: 'b' },
    { timestamp: 0.2, id: 'c' },
  ]);
  scheduler.start(0, 1, 10);
  assert.equal(scheduler.tick(10), 2);
  assert.equal(scheduler.tick(10.08), 1);
  assert.equal(scheduler.tick(10.1), 0);
  assert.deepEqual(scheduled.map(([id]) => id), ['a', 'b', 'c']);
  assert.ok(Math.abs(scheduled[0][1] - 10.05) < 1e-12);
  assert.ok(Math.abs(scheduled[2][1] - 10.2) < 1e-12);
});

test('scheduler converts MIDI distance to audio time at 0.5x and 2x', () => {
  for (const [rate, expected] of [[0.5, 5.4], [2, 5.1]]) {
    const times = [];
    const scheduler = new MidiAudioScheduler({
      lookaheadSeconds: 0.5,
      scheduleEvent: (_event, time) => times.push(time),
    });
    scheduler.setTimeline([{ timestamp: 1 }]);
    scheduler.start(0.8, rate, 5);
    scheduler.tick(5);
    assert.equal(times.length, 1);
    assert.ok(Math.abs(times[0] - expected) < 1e-12);
  }
});

test('dense simultaneous events are all scheduled without loss', () => {
  const seen = [];
  const events = Array.from({ length: 2000 }, (_, id) => ({ timestamp: 0.05, id }));
  const scheduler = new MidiAudioScheduler({ scheduleEvent: (event) => seen.push(event.id) });
  scheduler.setTimeline(events);
  scheduler.start(0, 1, 2);
  assert.equal(scheduler.tick(2), 2000);
  assert.equal(new Set(seen).size, 2000);
});

test('pause, stop, seek, rate change, and loop reset scheduler state deterministically', () => {
  const seen = [];
  const events = [0.1, 0.5, 0.7].map((timestamp) => ({ timestamp }));
  const scheduler = new MidiAudioScheduler({
    lookaheadSeconds: 0.1,
    scheduleEvent: (event, time) => seen.push([event.timestamp, time]),
  });
  scheduler.setTimeline(events);
  scheduler.start(0, 1, 0);
  scheduler.tick(0);
  scheduler.pause();
  assert.equal(scheduler.active, false);
  assert.equal(scheduler.tick(1), 0);

  scheduler.seek(0.5, 4);
  scheduler.start(0.5, 1, 4);
  scheduler.tick(4.11);
  assert.deepEqual(seen.map(([timestamp]) => timestamp), [0.1, 0.7]);

  scheduler.setRate(0.2, 2, 10);
  scheduler.tick(10.05);
  const rateCall = seen.find(([timestamp, time]) => timestamp === 0.5 && time > 10);
  assert.ok(Math.abs(rateCall[1] - 10.15) < 1e-12);

  scheduler.loop(0, 1, 20);
  scheduler.tick(20);
  assert.equal(seen.filter(([timestamp]) => timestamp === 0.1).length, 2);

  scheduler.stop();
  assert.equal(scheduler.cursor, 0);
  assert.equal(scheduler.active, false);
  assert.equal(scheduler.anchorMidiPosition, 0);
});
