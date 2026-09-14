import { parseMidiFile } from './midi-file.js';
import { MidiSource } from './midi-source.js';
import { MidiTransport } from './midi-transport.js';

export class MidiFileSource extends MidiSource {
  constructor({ now, parse = parseMidiFile } = {}) {
    super('midi-file');
    this.parse = parse;
    this.events = [];
    this.metadata = null;
    this.transportListeners = new Set();
    this.transport = new MidiTransport({
      now,
      onEvents: (events) => {
        for (const event of events) this.emit(event);
      },
      onChange: (change) => {
        for (const listener of this.transportListeners) listener(change);
      },
    });
  }

  subscribeTransport(listener) {
    if (typeof listener !== 'function') throw new TypeError('Transport listener must be a function');
    this.transportListeners.add(listener);
    return () => this.transportListeners.delete(listener);
  }

  load(arrayBuffer, filename = 'Untitled.mid') {
    const parsed = this.parse(arrayBuffer, filename);
    this.events = parsed.events;
    this.metadata = parsed.metadata;
    this.transport.setTimeline(this.events, this.metadata.duration);
    return parsed;
  }

  play() { return this.transport.play(); }
  pause() { return this.transport.pause(); }
  stop() { this.transport.stop(); }
  seek(position) { return this.transport.seek(position); }
  setRate(rate) { return this.transport.setRate(rate); }
  setLoop(loop) { this.transport.setLoop(loop); }
  update() { return this.transport.tick(); }
}
