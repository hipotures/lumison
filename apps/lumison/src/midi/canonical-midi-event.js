const DATA_MAX = 127;

function dataByte(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(DATA_MAX, Math.round(value)));
}

function timelineTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function contextFields(message) {
  const context = {};
  if (Number.isInteger(message.track) && message.track > 0) context.track = message.track;
  if (typeof message.trackName === 'string' && message.trackName) {
    context.trackName = message.trackName;
  }
  return context;
}

/**
 * Convert a complete MIDI channel message into the source-neutral event shape
 * consumed by Lumison. Channel numbers in the canonical API are 1–16.
 */
export function normalizeMidiMessage({
  status,
  data1 = 0,
  data2 = 0,
  timestamp = 0,
  ...context
} = {}) {
  if (!Number.isInteger(status) || status < 0x80 || status > 0xef) return null;
  const messageType = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const first = dataByte(data1);
  const second = dataByte(data2);
  const time = timelineTime(timestamp);
  const location = contextFields(context);

  if (messageType === 0x90 && second > 0) {
    return {
      type: 'note-on', channel, note: first, velocity: second / DATA_MAX,
      timestamp: time, ...location,
    };
  }
  if (messageType === 0x80 || messageType === 0x90) {
    return {
      type: 'note-off', channel, note: first, velocity: second / DATA_MAX,
      timestamp: time, ...location,
    };
  }
  if (messageType === 0xb0) {
    return {
      type: 'control-change', channel, controller: first,
      value: second / DATA_MAX, rawValue: second, timestamp: time, ...location,
    };
  }
  if (messageType === 0xc0) {
    return {
      type: 'program-change', channel, program: first,
      timestamp: time, ...location,
    };
  }
  if (messageType === 0xe0) {
    const rawValue = first | (second << 7);
    const offset = rawValue - 8192;
    return {
      type: 'pitch-bend', channel,
      value: offset < 0 ? offset / 8192 : offset / 8191,
      rawValue, timestamp: time, ...location,
    };
  }
  return null;
}

export function createTempoChange({ bpm, timestamp = 0, ...context } = {}) {
  if (!(typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0)) return null;
  return {
    type: 'tempo-change', bpm, timestamp: timelineTime(timestamp),
    ...contextFields(context),
  };
}

export function isCanonicalMidiEvent(event) {
  if (!event || typeof event !== 'object'
    || !(typeof event.timestamp === 'number' && Number.isFinite(event.timestamp))) return false;
  if (event.type === 'tempo-change') return event.bpm > 0;
  if (!Number.isInteger(event.channel) || event.channel < 1 || event.channel > 16) return false;
  if (event.type === 'note-on' || event.type === 'note-off') {
    return Number.isInteger(event.note) && event.note >= 0 && event.note <= 127
      && event.velocity >= 0 && event.velocity <= 1;
  }
  if (event.type === 'control-change') {
    return Number.isInteger(event.controller) && event.controller >= 0 && event.controller <= 127
      && Number.isInteger(event.rawValue) && event.rawValue >= 0 && event.rawValue <= 127
      && event.value >= 0 && event.value <= 1;
  }
  if (event.type === 'program-change') {
    return Number.isInteger(event.program) && event.program >= 0 && event.program <= 127;
  }
  if (event.type === 'pitch-bend') {
    return Number.isInteger(event.rawValue) && event.rawValue >= 0 && event.rawValue <= 16383
      && event.value >= -1 && event.value <= 1;
  }
  return false;
}
