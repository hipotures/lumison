import assert from 'node:assert/strict';
import test from 'node:test';
import { MidiFilePlayer } from '../apps/lumison/src/midi/midi-file-player.js';
import { MidiFileSource } from '../apps/lumison/src/midi/midi-file-source.js';
import { MidiTransport } from '../apps/lumison/src/midi/midi-transport.js';

const event = (timestamp, id) => ({ timestamp, id });

test('transport play/pause preserves position and applies playback rate', () => {
  let time = 0;
  const seen = [];
  const transport = new MidiTransport({
    now: () => time,
    onEvents: (events) => seen.push(...events.map((item) => item.id)),
  });
  transport.setTimeline([event(0.1, 'a'), event(0.2, 'b'), event(1.5, 'c')], 2);

  assert.equal(transport.play(), true);
  time = 0.25;
  transport.tick();
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(transport.position, 0.25);
  assert.equal(transport.pause(), true);
  time = 3;
  transport.tick();
  assert.equal(transport.position, 0.25);

  assert.equal(transport.setRate(0.5), true);
  transport.play();
  time = 5;
  transport.tick();
  assert.equal(transport.position, 1.25);
  assert.deepEqual(seen, ['a', 'b']);
});

test('stop resets position and makes time-zero events due on replay', () => {
  let time = 0;
  const seen = [];
  const changes = [];
  const transport = new MidiTransport({
    now: () => time,
    onEvents: (events) => seen.push(...events.map((item) => item.id)),
    onChange: (change) => changes.push(change.type),
  });
  transport.setTimeline([event(0, 'zero'), event(0.5, 'later')], 1);
  transport.play();
  transport.tick();
  assert.deepEqual(seen, ['zero']);
  time = 0.75;
  transport.tick();
  transport.stop();
  assert.equal(transport.position, 0);
  assert.equal(transport.playing, false);
  transport.play();
  transport.tick();
  assert.deepEqual(seen, ['zero', 'later', 'zero']);
  assert.ok(changes.includes('stop'));
});

test('loop resets the cycle cleanly and dispatches every due event', () => {
  let time = 0;
  const seen = [];
  let loops = 0;
  const transport = new MidiTransport({
    now: () => time,
    onEvents: (events) => seen.push(...events.map((item) => item.id)),
    onChange: (change) => { if (change.type === 'loop') loops += 1; },
  });
  transport.setTimeline([event(0.1, 'a'), event(0.9, 'b')], 1);
  transport.setLoop(true);
  transport.play();
  time = 1.2;
  transport.tick();
  assert.deepEqual(seen, ['a', 'b', 'a']);
  assert.equal(loops, 1);
  assert.ok(Math.abs(transport.position - 0.2) < 1e-12);
});

test('a single update processes dense due events without loss', () => {
  let time = 0;
  const events = Array.from({ length: 2000 }, (_, index) => event((index + 1) / 10000, index));
  const seen = [];
  const transport = new MidiTransport({ now: () => time, onEvents: (due) => seen.push(...due) });
  transport.setTimeline(events, 1);
  transport.play();
  time = 0.25;
  transport.tick();
  assert.equal(seen.length, 2000);
  assert.equal(new Set(seen).size, 2000);
});

test('file player rebuilds state on seek and clears it on stop and loop', () => {
  let time = 0;
  const canonical = [
    { type: 'note-on', channel: 1, note: 60, velocity: 1, timestamp: 0.1 },
    { type: 'control-change', channel: 1, controller: 64, value: 1, rawValue: 127, timestamp: 0.2 },
    { type: 'note-off', channel: 1, note: 60, velocity: 0, timestamp: 0.8 },
  ];
  const source = new MidiFileSource({
    now: () => time,
    parse: () => ({
      events: canonical,
      metadata: { filename: 'fixture.mid', duration: 1, tracks: 1, trackNames: [], channels: [1], eventCount: 3 },
    }),
  });
  const player = new MidiFilePlayer({ source });
  player.load(new ArrayBuffer(0), 'fixture.mid');

  player.seek(0.5);
  assert.equal(player.performance.polyphony, 1);
  assert.equal(player.performance.sustain.on, true);
  player.seek(0.9);
  assert.equal(player.performance.polyphony, 0);
  player.seek(0.15);
  assert.equal(player.performance.polyphony, 1);
  assert.equal(player.performance.sustain.on, false);

  player.stop();
  assert.equal(player.performance.polyphony, 0);
  assert.equal(player.performance.sustain.on, false);
  source.setLoop(true);
  player.play();
  time = 1.05;
  player.update();
  assert.equal(player.performance.polyphony, 0);
  assert.equal(player.performance.sustain.on, false);
});
