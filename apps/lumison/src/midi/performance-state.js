const PEDAL_CONTROLLERS = new Map([
  [64, 'sustain'],
  [66, 'sostenuto'],
  [67, 'soft'],
]);

function pedalState(channel = null) {
  return { value: 0, rawValue: 0, on: false, channel };
}

export function createPerformanceState({ tempo = 120, position = 0 } = {}) {
  return {
    lastAttackNote: null,
    lastAttackVelocity: 0,
    lastAttackTimestamp: null,
    lastReleaseNote: null,
    lastReleaseVelocity: 0,
    lastReleaseTimestamp: null,
    lastEventType: null,
    heldNotes: new Map(),
    heldPolyphony: 0,
    lowestHeldNote: null,
    highestHeldNote: null,
    soundingNotes: new Map(),
    soundingPolyphony: 0,
    lowestSoundingNote: null,
    highestSoundingNote: null,
    sustain: pedalState(),
    sostenuto: pedalState(),
    soft: pedalState(),
    pedalsByChannel: new Map(),
    sostenutoLatches: new Map(),
    controllers: new Map(),
    channelActivity: new Map(),
    currentTempo: tempo,
    position,
    nextVoiceId: 1,
  };
}

function noteKey(channel, note) {
  return `${channel}:${note}`;
}

function channelPedals(state, channel) {
  let pedals = state.pedalsByChannel.get(channel);
  if (!pedals) {
    pedals = {
      sustain: pedalState(channel),
      sostenuto: pedalState(channel),
      soft: pedalState(channel),
    };
    state.pedalsByChannel.set(channel, pedals);
  }
  return pedals;
}

function aggregatePedal(state, name) {
  let aggregate = pedalState();
  for (const pedals of state.pedalsByChannel.values()) {
    if (pedals[name].rawValue >= aggregate.rawValue) aggregate = { ...pedals[name] };
  }
  state[name] = aggregate;
}

function addVoice(notes, voice) {
  const key = noteKey(voice.channel, voice.note);
  const current = notes.get(key);
  const voices = current ? [...current.voices, voice] : [voice];
  notes.set(key, {
    channel: voice.channel,
    note: voice.note,
    velocity: voice.velocity,
    count: voices.length,
    voices,
  });
}

function removeVoice(notes, key, voiceId) {
  const current = notes.get(key);
  if (!current) return;
  const voices = current.voices.filter((voice) => voice.id !== voiceId);
  if (!voices.length) {
    notes.delete(key);
    return;
  }
  notes.set(key, {
    ...current,
    velocity: voices.at(-1).velocity,
    count: voices.length,
    voices,
  });
}

function noteMetrics(notes) {
  let polyphony = 0;
  let lowest = null;
  let highest = null;
  for (const active of notes.values()) {
    polyphony += active.count;
    lowest = lowest === null ? active.note : Math.min(lowest, active.note);
    highest = highest === null ? active.note : Math.max(highest, active.note);
  }
  return { polyphony, lowest, highest };
}

function updateNoteMetrics(state) {
  const held = noteMetrics(state.heldNotes);
  state.heldPolyphony = held.polyphony;
  state.lowestHeldNote = held.lowest;
  state.highestHeldNote = held.highest;
  const sounding = noteMetrics(state.soundingNotes);
  state.soundingPolyphony = sounding.polyphony;
  state.lowestSoundingNote = sounding.lowest;
  state.highestSoundingNote = sounding.highest;
}

function voiceIds(notes, channel) {
  const ids = new Set();
  for (const active of notes.values()) {
    if (active.channel !== channel) continue;
    for (const voice of active.voices) ids.add(voice.id);
  }
  return ids;
}

function voiceIsLatched(state, channel, voiceId) {
  return channelPedals(state, channel).sostenuto.on
    && (state.sostenutoLatches.get(channel)?.has(voiceId) ?? false);
}

function releaseUnheldSounding(state, channel) {
  const pedals = channelPedals(state, channel);
  if (pedals.sustain.on) return;
  const heldVoiceIds = voiceIds(state.heldNotes, channel);
  for (const [key, active] of [...state.soundingNotes]) {
    if (active.channel !== channel) continue;
    for (const voice of active.voices) {
      if (!heldVoiceIds.has(voice.id) && !voiceIsLatched(state, channel, voice.id)) {
        removeVoice(state.soundingNotes, key, voice.id);
      }
    }
  }
  updateNoteMetrics(state);
}

function clearChannelNotes(state, channel, { sounding }) {
  for (const [key, active] of state.heldNotes) {
    if (active.channel === channel) state.heldNotes.delete(key);
  }
  if (sounding) {
    for (const [key, active] of state.soundingNotes) {
      if (active.channel === channel) state.soundingNotes.delete(key);
    }
    state.sostenutoLatches.delete(channel);
  } else {
    releaseUnheldSounding(state, channel);
  }
  updateNoteMetrics(state);
}

function setPedal(state, event, name) {
  const pedals = channelPedals(state, event.channel);
  const previousOn = pedals[name].on;
  const next = {
    value: event.value,
    rawValue: event.rawValue,
    on: event.rawValue >= 64,
    channel: event.channel,
  };
  pedals[name] = next;

  if (name === 'sustain' && previousOn && !next.on) {
    releaseUnheldSounding(state, event.channel);
  } else if (name === 'sostenuto' && !previousOn && next.on) {
    state.sostenutoLatches.set(event.channel, voiceIds(state.soundingNotes, event.channel));
  } else if (name === 'sostenuto' && previousOn && !next.on) {
    state.sostenutoLatches.delete(event.channel);
    releaseUnheldSounding(state, event.channel);
  }
  aggregatePedal(state, name);
}

function resetControllers(state, channel) {
  state.controllers.set(channel, new Map());
  const pedals = channelPedals(state, channel);
  pedals.sustain = pedalState(channel);
  pedals.sostenuto = pedalState(channel);
  pedals.soft = pedalState(channel);
  state.sostenutoLatches.delete(channel);
  releaseUnheldSounding(state, channel);
  aggregatePedal(state, 'sustain');
  aggregatePedal(state, 'sostenuto');
  aggregatePedal(state, 'soft');
}

function countForChannel(notes, channel) {
  let count = 0;
  for (const active of notes.values()) {
    if (active.channel === channel) count += active.count;
  }
  return count;
}

function markChannel(state, event) {
  if (!Number.isInteger(event.channel)) return;
  const previous = state.channelActivity.get(event.channel);
  state.channelActivity.set(event.channel, {
    eventCount: (previous?.eventCount ?? 0) + 1,
    lastEventType: event.type,
    lastTimestamp: event.timestamp,
    heldNotes: countForChannel(state.heldNotes, event.channel),
    soundingNotes: countForChannel(state.soundingNotes, event.channel),
  });
}

function noteOn(state, event) {
  const voice = {
    id: state.nextVoiceId,
    channel: event.channel,
    note: event.note,
    velocity: event.velocity,
  };
  state.nextVoiceId += 1;
  addVoice(state.heldNotes, voice);
  addVoice(state.soundingNotes, voice);
  state.lastAttackNote = event.note;
  state.lastAttackVelocity = event.velocity;
  state.lastAttackTimestamp = event.timestamp;
  updateNoteMetrics(state);
}

function noteOff(state, event) {
  const key = noteKey(event.channel, event.note);
  const held = state.heldNotes.get(key);
  const releasedVoice = held?.voices[0];
  if (releasedVoice) {
    removeVoice(state.heldNotes, key, releasedVoice.id);
    const pedals = channelPedals(state, event.channel);
    if (!pedals.sustain.on && !voiceIsLatched(state, event.channel, releasedVoice.id)) {
      removeVoice(state.soundingNotes, key, releasedVoice.id);
    }
  }
  state.lastReleaseNote = event.note;
  state.lastReleaseVelocity = event.velocity;
  state.lastReleaseTimestamp = event.timestamp;
  updateNoteMetrics(state);
}

function controlChange(state, event) {
  let controllers = state.controllers.get(event.channel);
  if (!controllers) {
    controllers = new Map();
    state.controllers.set(event.channel, controllers);
  }
  controllers.set(event.controller, event.rawValue);

  const pedal = PEDAL_CONTROLLERS.get(event.controller);
  if (pedal) setPedal(state, event, pedal);
  else if (event.controller === 120) clearChannelNotes(state, event.channel, { sounding: true });
  else if (event.controller === 121) resetControllers(state, event.channel);
  else if (event.controller === 123) clearChannelNotes(state, event.channel, { sounding: false });
}

export function reducePerformanceState(state, event) {
  if (!state || !event) return state;
  state.position = Math.max(state.position, event.timestamp ?? 0);
  state.lastEventType = event.type;

  if (event.type === 'tempo-change') {
    state.currentTempo = event.bpm;
    return state;
  }
  if (event.type === 'note-on') noteOn(state, event);
  else if (event.type === 'note-off') noteOff(state, event);
  else if (event.type === 'control-change') controlChange(state, event);

  markChannel(state, event);
  return state;
}

function cloneNoteMap(notes) {
  return new Map([...notes].map(([key, active]) => [key, {
    ...active,
    voices: active.voices.map((voice) => ({ ...voice })),
  }]));
}

export function clonePerformanceState(state) {
  return {
    ...state,
    heldNotes: cloneNoteMap(state.heldNotes),
    soundingNotes: cloneNoteMap(state.soundingNotes),
    sustain: { ...state.sustain },
    sostenuto: { ...state.sostenuto },
    soft: { ...state.soft },
    pedalsByChannel: new Map([...state.pedalsByChannel].map(([channel, pedals]) => [
      channel,
      {
        sustain: { ...pedals.sustain },
        sostenuto: { ...pedals.sostenuto },
        soft: { ...pedals.soft },
      },
    ])),
    sostenutoLatches: new Map([...state.sostenutoLatches].map(([channel, voices]) => [
      channel,
      new Set(voices),
    ])),
    controllers: new Map([...state.controllers].map(([channel, controllers]) => [
      channel,
      new Map(controllers),
    ])),
    channelActivity: new Map([...state.channelActivity].map(([channel, activity]) => [
      channel,
      { ...activity },
    ])),
  };
}

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

export function createPerformanceTimeline(events, { checkpointEvery = 256 } = {}) {
  const interval = Math.max(1, Math.floor(checkpointEvery));
  const state = createPerformanceState();
  const checkpoints = [{ eventIndex: 0, state: clonePerformanceState(state) }];
  for (let index = 0; index < events.length; index += 1) {
    reducePerformanceState(state, events[index]);
    if ((index + 1) % interval === 0) {
      checkpoints.push({ eventIndex: index + 1, state: clonePerformanceState(state) });
    }
  }
  return { events, checkpoints, checkpointEvery: interval };
}

/** Restore seek state without publishing historical event callbacks. */
export function rebuildPerformanceState(timeline, position) {
  const time = Math.max(0, Number(position) || 0);
  const end = upperBoundByTime(timeline.events, time);
  const checkpointIndex = Math.floor(end / timeline.checkpointEvery);
  const checkpoint = timeline.checkpoints[Math.min(
    checkpointIndex,
    timeline.checkpoints.length - 1,
  )];
  const state = clonePerformanceState(checkpoint.state);
  for (let index = checkpoint.eventIndex; index < end; index += 1) {
    reducePerformanceState(state, timeline.events[index]);
  }
  state.position = time;
  return state;
}
