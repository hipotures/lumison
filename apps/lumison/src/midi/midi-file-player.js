import {
  createPerformanceState,
  createPerformanceTimeline,
  rebuildPerformanceState,
  reducePerformanceState,
} from './performance-state.js';
import { MidiFileSource } from './midi-file-source.js';

export class MidiFilePlayer {
  constructor({ source = new MidiFileSource() } = {}) {
    this.source = source;
    this.performance = createPerformanceState();
    this.performanceTimeline = null;
    this.listeners = new Set();
    this.eventListeners = new Set();

    source.subscribe((event) => {
      reducePerformanceState(this.performance, event);
      for (const listener of this.eventListeners) listener(event, this.performance);
      this.notify('event');
    });
    source.subscribeTransport((change) => {
      if (change.type === 'seek' && this.performanceTimeline) {
        this.performance = rebuildPerformanceState(this.performanceTimeline, change.position);
      } else if (change.type === 'stop' || change.type === 'loop') {
        const initialTempo = this.performanceTimeline
          ? rebuildPerformanceState(this.performanceTimeline, 0).currentTempo
          : 120;
        this.performance = createPerformanceState({
          position: change.position,
          tempo: initialTempo,
        });
      } else {
        this.performance.position = change.position;
      }
      this.notify(change.type);
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Observe source-neutral canonical events dispatched by live transport playback. */
  subscribeEvents(listener) {
    if (typeof listener !== 'function') throw new TypeError('MIDI event listener must be a function');
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  notify(reason) {
    for (const listener of this.listeners) listener(this, reason);
  }

  load(arrayBuffer, filename) {
    const parsed = this.source.load(arrayBuffer, filename);
    this.performanceTimeline = createPerformanceTimeline(parsed.events);
    // Loading is also a state-correct seek: time-zero tempo, controllers, and
    // notes are represented without publishing historical event callbacks.
    this.source.seek(0);
    this.notify('load');
    return parsed.metadata;
  }

  play() { return this.source.play(); }
  pause() { return this.source.pause(); }
  stop() { this.source.stop(); }
  seek(position) { return this.source.seek(position); }
  setRate(rate) { return this.source.setRate(rate); }
  setLoop(loop) { this.source.setLoop(loop); }
  update() { return this.source.update(); }

  get metadata() { return this.source.metadata; }
  get transport() { return this.source.transport; }
  get canonicalEvents() { return this.performanceTimeline?.events ?? []; }
}
