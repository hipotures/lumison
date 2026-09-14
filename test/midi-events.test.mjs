import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTempoChange,
  isCanonicalMidiEvent,
  normalizeMidiMessage,
} from '../apps/lumison/src/midi/canonical-midi-event.js';
import { convertParsedMidi } from '../apps/lumison/src/midi/midi-file.js';

test('channel messages normalize to source-neutral MIDI events', () => {
  assert.deepEqual(normalizeMidiMessage({
    status: 0x92, data1: 21, data2: 127, timestamp: 1.25,
  }), {
    type: 'note-on', channel: 3, note: 21, velocity: 1, timestamp: 1.25,
  });
  assert.deepEqual(normalizeMidiMessage({
    status: 0x81, data1: 60, data2: 64, timestamp: 2,
  }), {
    type: 'note-off', channel: 2, note: 60, velocity: 64 / 127, timestamp: 2,
  });

  const cc = normalizeMidiMessage({ status: 0xbf, data1: 64, data2: 42, timestamp: 3 });
  assert.deepEqual(cc, {
    type: 'control-change', channel: 16, controller: 64,
    value: 42 / 127, rawValue: 42, timestamp: 3,
  });
  assert.equal(isCanonicalMidiEvent(cc), true);
  assert.equal(isCanonicalMidiEvent(createTempoChange({ bpm: 90, timestamp: 4 })), true);
});

test('Note On with velocity zero becomes canonical note-off', () => {
  const event = normalizeMidiMessage({ status: 0x90, data1: 108, data2: 0, timestamp: 0.5 });
  assert.deepEqual(event, {
    type: 'note-off', channel: 1, note: 108, velocity: 0, timestamp: 0.5,
  });
});

test('program changes and 14-bit pitch bend are retained', () => {
  assert.deepEqual(normalizeMidiMessage({ status: 0xc4, data1: 12, timestamp: 1 }), {
    type: 'program-change', channel: 5, program: 12, timestamp: 1,
  });
  assert.equal(normalizeMidiMessage({ status: 0xe0, data1: 0, data2: 0 }).value, -1);
  assert.equal(normalizeMidiMessage({ status: 0xe0, data1: 0, data2: 64 }).value, 0);
  assert.equal(normalizeMidiMessage({ status: 0xe0, data1: 127, data2: 127 }).value, 1);
});

test('SMF conversion applies the global tempo map across tracks', () => {
  const parsed = {
    header: { formatType: 1, trackCount: 2, ticksPerBeat: 480 },
    tracks: [
      [
        { deltaTime: 0, type: 'meta', subtype: 'trackName', text: 'Conductor' },
        { deltaTime: 0, type: 'meta', subtype: 'setTempo', microsecondsPerBeat: 500000 },
        { deltaTime: 480, type: 'meta', subtype: 'setTempo', microsecondsPerBeat: 1000000 },
        { deltaTime: 480, type: 'meta', subtype: 'endOfTrack' },
      ],
      [
        { deltaTime: 0, type: 'meta', subtype: 'trackName', text: 'Piano' },
        { deltaTime: 0, type: 'channel', subtype: 'programChange', channel: 1, value: 4 },
        { deltaTime: 0, type: 'channel', subtype: 'noteOn', channel: 0, noteNumber: 60, velocity: 127 },
        { deltaTime: 240, type: 'channel', subtype: 'controller', channel: 0, controllerType: 64, value: 63 },
        { deltaTime: 0, type: 'channel', subtype: 'pitchBend', channel: 0, value: 0 },
        { deltaTime: 720, type: 'channel', subtype: 'noteOff', channel: 0, noteNumber: 60, velocity: 32 },
        { deltaTime: 0, type: 'channel', subtype: 'noteOn', channel: 0, noteNumber: 61, velocity: 0 },
      ],
    ],
  };

  const result = convertParsedMidi(parsed, 'tempo.mid');
  assert.equal(result.metadata.format, 1);
  assert.equal(result.metadata.tracks, 2);
  assert.deepEqual(result.metadata.trackNames, ['Conductor', 'Piano']);
  assert.deepEqual(result.metadata.channels, [1, 2]);
  assert.equal(result.metadata.duration, 1.5);
  assert.equal(result.metadata.tempoMap.at(-1).timestamp, 0.5);
  assert.equal(result.events.find((event) => event.type === 'control-change').timestamp, 0.25);
  assert.equal(result.events.find((event) => event.type === 'program-change').program, 4);
  assert.equal(result.events.find((event) => event.type === 'pitch-bend').value, -1);
  const releases = result.events.filter((event) => event.type === 'note-off');
  assert.equal(releases[0].timestamp, 1.5);
  assert.equal(releases[0].velocity, 32 / 127);
  assert.equal(releases[1].velocity, 0);
});

test('SMF type 0 is accepted', () => {
  const result = convertParsedMidi({
    header: { formatType: 0, trackCount: 1, ticksPerBeat: 96 },
    tracks: [[{ deltaTime: 0, type: 'meta', subtype: 'endOfTrack' }]],
  });
  assert.equal(result.metadata.format, 0);
  assert.equal(result.metadata.tracks, 1);
});
