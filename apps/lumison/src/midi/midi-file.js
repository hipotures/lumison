import { read } from 'midifile-ts';
import { createTempoChange, normalizeMidiMessage } from './canonical-midi-event.js';

const DEFAULT_MICROSECONDS_PER_BEAT = 500000;

function collectTracks(parsed) {
  return parsed.tracks.map((events, trackIndex) => {
    let ticks = 0;
    let name = '';
    const positioned = events.map((event, eventIndex) => {
      ticks += Math.max(0, Number(event.deltaTime) || 0);
      if (event.type === 'meta' && event.subtype === 'trackName' && !name) name = event.text;
      return { event, ticks, trackIndex, eventIndex };
    });
    return { name, ticks, positioned };
  });
}

export function createTempoMap(tracks, ticksPerBeat) {
  const tempoEvents = [{
    ticks: 0,
    microsecondsPerBeat: DEFAULT_MICROSECONDS_PER_BEAT,
    order: -1,
    synthetic: true,
  }];
  let order = 0;
  for (const track of tracks) {
    for (const item of track.positioned) {
      const { event } = item;
      if (event.type === 'meta' && event.subtype === 'setTempo'
        && event.microsecondsPerBeat > 0) {
        tempoEvents.push({
          ticks: item.ticks,
          microsecondsPerBeat: event.microsecondsPerBeat,
          order: order++,
          synthetic: false,
        });
      }
    }
  }
  tempoEvents.sort((a, b) => a.ticks - b.ticks || a.order - b.order);

  let previousTicks = 0;
  let previousTime = 0;
  let previousTempo = DEFAULT_MICROSECONDS_PER_BEAT;
  return tempoEvents.map((tempo) => {
    const time = previousTime
      + ((tempo.ticks - previousTicks) * previousTempo) / (ticksPerBeat * 1e6);
    const segment = {
      ticks: tempo.ticks,
      timestamp: time,
      bpm: 60000000 / tempo.microsecondsPerBeat,
      microsecondsPerBeat: tempo.microsecondsPerBeat,
      synthetic: tempo.synthetic,
    };
    previousTicks = tempo.ticks;
    previousTime = time;
    previousTempo = tempo.microsecondsPerBeat;
    return segment;
  });
}

export function ticksToSeconds(ticks, tempoMap, ticksPerBeat) {
  let low = 0;
  let high = tempoMap.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (tempoMap[middle].ticks <= ticks) low = middle + 1;
    else high = middle;
  }
  const tempo = tempoMap[Math.max(0, low - 1)];
  return tempo.timestamp
    + ((ticks - tempo.ticks) * tempo.microsecondsPerBeat) / (ticksPerBeat * 1e6);
}

function channelStatus(event) {
  const channel = Math.max(0, Math.min(15, Number(event.channel) || 0));
  if (event.subtype === 'noteOff') return 0x80 | channel;
  if (event.subtype === 'noteOn') return 0x90 | channel;
  if (event.subtype === 'controller') return 0xb0 | channel;
  if (event.subtype === 'programChange') return 0xc0 | channel;
  if (event.subtype === 'pitchBend') return 0xe0 | channel;
  return null;
}

function canonicalChannelEvent(event, timestamp, context) {
  const status = channelStatus(event);
  if (status === null) return null;
  if (event.subtype === 'noteOff' || event.subtype === 'noteOn') {
    return normalizeMidiMessage({
      status, data1: event.noteNumber, data2: event.velocity, timestamp, ...context,
    });
  }
  if (event.subtype === 'controller') {
    return normalizeMidiMessage({
      status, data1: event.controllerType, data2: event.value, timestamp, ...context,
    });
  }
  if (event.subtype === 'programChange') {
    return normalizeMidiMessage({ status, data1: event.value, timestamp, ...context });
  }
  const rawValue = Math.max(0, Math.min(16383, Number(event.value) || 0));
  return normalizeMidiMessage({
    status, data1: rawValue & 0x7f, data2: (rawValue >> 7) & 0x7f,
    timestamp, ...context,
  });
}

export function convertParsedMidi(parsed, filename = 'Untitled.mid') {
  if (!parsed?.header || !Array.isArray(parsed.tracks)) throw new Error('Invalid MIDI file');
  const { formatType, ticksPerBeat } = parsed.header;
  if (![0, 1].includes(formatType)) throw new Error(`Unsupported MIDI format ${formatType}`);
  if (!(Number.isInteger(ticksPerBeat) && ticksPerBeat > 0)) {
    throw new Error('SMPTE-time MIDI files are not supported');
  }

  const tracks = collectTracks(parsed);
  const tempoMap = createTempoMap(tracks, ticksPerBeat);
  const events = [];
  const channels = new Set();
  const keySignatures = [];

  for (const track of tracks) {
    for (const item of track.positioned) {
      const timestamp = ticksToSeconds(item.ticks, tempoMap, ticksPerBeat);
      const context = { track: item.trackIndex + 1, trackName: track.name };
      // Diagnostic metadata only: never add key signatures to playback events.
      if (item.event.type === 'meta' && item.event.subtype === 'keySignature') {
        keySignatures.push({ timestamp, fifths: item.event.key, minor: item.event.scale });
      }
      let canonical = null;
      if (item.event.type === 'channel') {
        canonical = canonicalChannelEvent(item.event, timestamp, context);
        if (canonical) channels.add(canonical.channel);
      } else if (item.event.type === 'meta' && item.event.subtype === 'setTempo') {
        canonical = createTempoChange({
          bpm: 60000000 / item.event.microsecondsPerBeat,
          timestamp,
          ...context,
        });
      }
      if (canonical) {
        events.push({
          event: canonical,
          ticks: item.ticks,
          trackIndex: item.trackIndex,
          eventIndex: item.eventIndex,
        });
      }
    }
  }

  events.sort((a, b) => a.ticks - b.ticks
    || a.trackIndex - b.trackIndex
    || a.eventIndex - b.eventIndex);
  const canonicalEvents = events.map((item) => item.event);
  const durationTicks = tracks.reduce((maximum, track) => Math.max(maximum, track.ticks), 0);
  const duration = ticksToSeconds(durationTicks, tempoMap, ticksPerBeat);

  return {
    events: canonicalEvents,
    metadata: {
      filename,
      format: formatType,
      tracks: tracks.length,
      trackNames: tracks.map((track) => track.name).filter(Boolean),
      channels: [...channels].sort((a, b) => a - b),
      eventCount: canonicalEvents.length,
      duration,
      durationTicks,
      ticksPerBeat,
      tempoMap: tempoMap.map(({ synthetic, ...tempo }) => tempo),
      keySignatures: keySignatures.sort((a, b) => a.timestamp - b.timestamp),
    },
  };
}

export function parseMidiFile(arrayBuffer, filename) {
  const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  return convertParsedMidi(read(bytes), filename);
}
