const BANK_CONTROLLERS = new Set([0, 32]);
const PEDAL_CONTROLLERS = new Set([64, 66, 67]);
const NON_PERSISTENT_CHANNEL_MODE = new Set([120, 123]);

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

function createChannel() {
  return { controllers: new Map(), program: null, pitchBend: null };
}

export function createMidiChannelState() {
  return { channels: new Map() };
}

function channelState(state, channelNumber) {
  let channel = state.channels.get(channelNumber);
  if (!channel) {
    channel = createChannel();
    state.channels.set(channelNumber, channel);
  }
  return channel;
}

export function reduceMidiChannelState(state, event) {
  if (!Number.isInteger(event?.channel)) return state;
  const channel = channelState(state, event.channel);
  if (event.type === 'control-change') {
    if (event.controller === 121) channel.controllers.clear();
    else if (!NON_PERSISTENT_CHANNEL_MODE.has(event.controller)) {
      channel.controllers.set(event.controller, event.rawValue);
    }
  } else if (event.type === 'program-change') {
    channel.program = event.program;
  } else if (event.type === 'pitch-bend') {
    channel.pitchBend = event.rawValue;
  }
  return state;
}

export function cloneMidiChannelState(state) {
  return {
    channels: new Map([...state.channels].map(([number, channel]) => [number, {
      controllers: new Map(channel.controllers),
      program: channel.program,
      pitchBend: channel.pitchBend,
    }])),
  };
}

export function createMidiChannelTimeline(events, { checkpointEvery = 256 } = {}) {
  const interval = Math.max(1, Math.floor(checkpointEvery));
  const state = createMidiChannelState();
  const checkpoints = [{ eventIndex: 0, state: cloneMidiChannelState(state) }];
  for (let index = 0; index < events.length; index += 1) {
    reduceMidiChannelState(state, events[index]);
    if ((index + 1) % interval === 0) {
      checkpoints.push({ eventIndex: index + 1, state: cloneMidiChannelState(state) });
    }
  }
  return { events, checkpoints, checkpointEvery: interval };
}

export function rebuildMidiChannelState(timeline, position) {
  const time = Math.max(0, Number(position) || 0);
  const end = upperBoundByTime(timeline.events, time);
  const checkpoint = timeline.checkpoints[Math.min(
    Math.floor(end / timeline.checkpointEvery),
    timeline.checkpoints.length - 1,
  )];
  const state = cloneMidiChannelState(checkpoint.state);
  for (let index = checkpoint.eventIndex; index < end; index += 1) {
    reduceMidiChannelState(state, timeline.events[index]);
  }
  return state;
}

function voicesForPerformance(performance) {
  const voices = [];
  for (const active of performance?.soundingNotes?.values?.() ?? []) {
    for (const voice of active.voices) voices.push(voice);
  }
  return voices;
}

function voiceIds(notes) {
  const ids = new Set();
  for (const active of notes?.values?.() ?? []) {
    for (const voice of active.voices) ids.add(voice.id);
  }
  return ids;
}

/** Apply seek state immediately; no historical notes are replayed through the transport. */
export function applyReconstructedMidiState(
  synth,
  channelStateValue,
  performance,
  time,
  { restartSounding = true } = {},
) {
  const options = { time };
  synth.reset();

  for (const [canonicalChannel, state] of channelStateValue.channels) {
    const channel = canonicalChannel - 1;
    for (const controller of BANK_CONTROLLERS) {
      if (state.controllers.has(controller)) {
        synth.controllerChange(channel, controller, state.controllers.get(controller), options);
      }
    }
    if (state.program !== null) synth.programChange(channel, state.program, options);
    for (const [controller, value] of state.controllers) {
      if (!BANK_CONTROLLERS.has(controller) && !PEDAL_CONTROLLERS.has(controller)) {
        synth.controllerChange(channel, controller, value, options);
      }
    }
    if (state.pitchBend !== null) synth.pitchWheel(channel, state.pitchBend, options);
  }

  for (const [canonicalChannel, state] of channelStateValue.channels) {
    for (const controller of [64, 67]) {
      const value = state.controllers.get(controller);
      if (value !== undefined) synth.controllerChange(canonicalChannel - 1, controller, value, options);
    }
  }

  if (!restartSounding) {
    for (const [canonicalChannel, state] of channelStateValue.channels) {
      const sostenuto = state.controllers.get(66);
      if (sostenuto !== undefined) synth.controllerChange(canonicalChannel - 1, 66, sostenuto, options);
    }
    return;
  }

  const soundingVoices = voicesForPerformance(performance);
  const heldIds = voiceIds(performance?.heldNotes);
  const latchedIds = new Set();
  for (const ids of performance?.sostenutoLatches?.values?.() ?? []) {
    for (const id of ids) latchedIds.add(id);
  }
  const latched = soundingVoices.filter((voice) => latchedIds.has(voice.id));
  const unlatched = soundingVoices.filter((voice) => !latchedIds.has(voice.id));
  const startVoice = (voice) => synth.noteOn(
    voice.channel - 1,
    voice.note,
    Math.max(1, Math.min(127, Math.round(voice.velocity * 127))),
    options,
  );

  for (const voice of latched) startVoice(voice);
  for (const [canonicalChannel, state] of channelStateValue.channels) {
    const sostenuto = state.controllers.get(66);
    if (sostenuto !== undefined) synth.controllerChange(canonicalChannel - 1, 66, sostenuto, options);
  }
  for (const voice of unlatched) startVoice(voice);

  for (const voice of soundingVoices) {
    if (!heldIds.has(voice.id)) synth.noteOff(voice.channel - 1, voice.note, options);
  }
}
