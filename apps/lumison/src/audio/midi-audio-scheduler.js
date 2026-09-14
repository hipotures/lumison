export const MIDI_AUDIO_SCHEDULER_CONFIG = Object.freeze({
  intervalMs: 25,
  lookaheadSeconds: 0.12,
});

function upperBoundByTime(events, position) {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].timestamp <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function clampRate(rate) {
  const number = Number(rate);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

export function canonicalChannelToSynth(channel) {
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) {
    throw new RangeError(`Invalid canonical MIDI channel: ${channel}`);
  }
  return channel - 1;
}

export function normalizedVelocityToMidi(velocity) {
  const value = Math.max(0, Math.min(1, Number(velocity) || 0));
  return Math.max(1, Math.min(127, Math.round(value * 127)));
}

/** Translate one source-neutral event through the public SpessaSynth API. */
export function dispatchCanonicalMidiEvent(synth, event, audioExecutionTime) {
  if (!event || event.type === 'tempo-change') return false;
  const channel = canonicalChannelToSynth(event.channel);
  const options = { time: audioExecutionTime };
  if (event.type === 'note-on') {
    synth.noteOn(channel, event.note, normalizedVelocityToMidi(event.velocity), options);
  } else if (event.type === 'note-off') {
    synth.noteOff(channel, event.note, options);
  } else if (event.type === 'control-change') {
    synth.controllerChange(channel, event.controller, event.rawValue, options);
  } else if (event.type === 'program-change') {
    synth.programChange(channel, event.program, options);
  } else if (event.type === 'pitch-bend') {
    synth.pitchWheel(channel, event.rawValue, options);
  } else {
    return false;
  }
  return true;
}

export class MidiAudioScheduler {
  constructor({
    scheduleEvent,
    lookaheadSeconds = MIDI_AUDIO_SCHEDULER_CONFIG.lookaheadSeconds,
  } = {}) {
    if (typeof scheduleEvent !== 'function') throw new TypeError('scheduleEvent is required');
    this.scheduleEvent = scheduleEvent;
    this.lookaheadSeconds = Math.max(0.01, Number(lookaheadSeconds) || 0.12);
    this.events = [];
    this.cursor = 0;
    this.active = false;
    this.rate = 1;
    this.anchorMidiPosition = 0;
    this.anchorAudioTime = 0;
    this.lastScheduledAudioTime = 0;
    this.epoch = 0;
  }

  setTimeline(events) {
    this.events = Array.isArray(events) ? events : [];
    this.stop();
  }

  start(position, rate, audioTime) {
    const midiPosition = Math.max(0, Number(position) || 0);
    this.rate = clampRate(rate);
    this.anchorMidiPosition = midiPosition;
    this.anchorAudioTime = Number(audioTime) || 0;
    this.cursor = upperBoundByTime(this.events, midiPosition);
    this.lastScheduledAudioTime = this.anchorAudioTime;
    this.active = true;
    this.epoch += 1;
    return this.epoch;
  }

  currentMidiPosition(audioTime) {
    const elapsed = Math.max(0, (Number(audioTime) || 0) - this.anchorAudioTime);
    return this.anchorMidiPosition + elapsed * this.rate;
  }

  tick(audioTime) {
    if (!this.active) return 0;
    const now = Number(audioTime) || 0;
    const midiPosition = this.currentMidiPosition(now);
    const midiWindowEnd = midiPosition + this.lookaheadSeconds * this.rate;
    let count = 0;
    while (this.cursor < this.events.length
      && this.events[this.cursor].timestamp <= midiWindowEnd) {
      const event = this.events[this.cursor];
      const executionTime = Math.max(now, now + (event.timestamp - midiPosition) / this.rate);
      this.scheduleEvent(event, executionTime, this.epoch);
      this.lastScheduledAudioTime = Math.max(this.lastScheduledAudioTime, executionTime);
      this.cursor += 1;
      count += 1;
    }
    return count;
  }

  pause() {
    this.active = false;
    this.epoch += 1;
  }

  stop() {
    this.pause();
    this.cursor = 0;
    this.anchorMidiPosition = 0;
    this.anchorAudioTime = 0;
    this.lastScheduledAudioTime = 0;
  }

  seek(position, audioTime = this.anchorAudioTime) {
    this.pause();
    this.anchorMidiPosition = Math.max(0, Number(position) || 0);
    this.anchorAudioTime = Number(audioTime) || 0;
    this.cursor = upperBoundByTime(this.events, this.anchorMidiPosition);
  }

  setRate(position, rate, audioTime) {
    return this.start(position, rate, audioTime);
  }

  loop(position, rate, audioTime) {
    return this.start(position, rate, audioTime);
  }
}
