import { isCanonicalMidiEvent } from './canonical-midi-event.js';

/** Small observable contract shared by file MIDI and future live MIDI sources. */
export class MidiSource {
  constructor(kind) {
    this.kind = kind;
    this.listeners = new Set();
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('MIDI listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    if (!isCanonicalMidiEvent(event)) throw new TypeError('Invalid canonical MIDI event');
    for (const listener of this.listeners) listener(event);
  }
}
