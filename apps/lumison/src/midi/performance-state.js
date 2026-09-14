const PEDAL_CONTROLLERS = new Map([
  [64, 'sustain'],
  [66, 'sostenuto'],
  [67, 'soft'],
]);

function pedalState() {
  return { value: 0, rawValue: 0, on: false, channel: null };
}

export function createPerformanceState({ tempo = 120, position = 0 } = {}) {
  return {
    lastNote: null,
    lastVelocity: 0,
    lastNoteType: null,
    activeNotes: new Map(),
    polyphony: 0,
    lowestActiveNote: null,
    highestActiveNote: null,
    sustain: pedalState(),
    sostenuto: pedalState(),
    soft: pedalState(),
    controllers: new Map(),
    channelActivity: new Map(),
    currentTempo: tempo,
    position,
  };
}

function noteKey(channel, note) {
  return `${channel}:${note}`;
}

function activeCountForChannel(state, channel) {
  let count = 0;
  for (const active of state.activeNotes.values()) {
    if (active.channel === channel) count += active.count;
  }
  return count;
}

function updateRange(state) {
  let lowest = null;
  let highest = null;
  let polyphony = 0;
  for (const active of state.activeNotes.values()) {
    if (active.count <= 0) continue;
    polyphony += active.count;
    lowest = lowest === null ? active.note : Math.min(lowest, active.note);
    highest = highest === null ? active.note : Math.max(highest, active.note);
  }
  state.polyphony = polyphony;
  state.lowestActiveNote = lowest;
  state.highestActiveNote = highest;
}

function markChannel(state, event) {
  if (!Number.isInteger(event.channel)) return;
  const previous = state.channelActivity.get(event.channel);
  state.channelActivity.set(event.channel, {
    eventCount: (previous?.eventCount ?? 0) + 1,
    lastEventType: event.type,
    lastTimestamp: event.timestamp,
    activeNotes: activeCountForChannel(state, event.channel),
  });
}

function clearChannelNotes(state, channel) {
  for (const [key, active] of state.activeNotes) {
    if (active.channel === channel) state.activeNotes.delete(key);
  }
  updateRange(state);
}

export function reducePerformanceState(state, event) {
  if (!state || !event) return state;
  state.position = Math.max(state.position, event.timestamp ?? 0);

  if (event.type === 'tempo-change') {
    state.currentTempo = event.bpm;
    return state;
  }

  if (event.type === 'note-on') {
    const key = noteKey(event.channel, event.note);
    const previous = state.activeNotes.get(key);
    state.activeNotes.set(key, {
      channel: event.channel,
      note: event.note,
      velocity: event.velocity,
      count: (previous?.count ?? 0) + 1,
    });
    state.lastNote = event.note;
    state.lastVelocity = event.velocity;
    state.lastNoteType = event.type;
    updateRange(state);
  } else if (event.type === 'note-off') {
    const key = noteKey(event.channel, event.note);
    const previous = state.activeNotes.get(key);
    if (previous?.count > 1) state.activeNotes.set(key, { ...previous, count: previous.count - 1 });
    else state.activeNotes.delete(key);
    state.lastNote = event.note;
    state.lastVelocity = event.velocity;
    state.lastNoteType = event.type;
    updateRange(state);
  } else if (event.type === 'control-change') {
    let controllers = state.controllers.get(event.channel);
    if (!controllers) {
      controllers = new Map();
      state.controllers.set(event.channel, controllers);
    }
    controllers.set(event.controller, event.rawValue);
    const pedal = PEDAL_CONTROLLERS.get(event.controller);
    if (pedal) {
      state[pedal] = {
        value: event.value,
        rawValue: event.rawValue,
        on: event.rawValue >= 64,
        channel: event.channel,
      };
    }
    if (event.controller === 120 || event.controller === 123) {
      clearChannelNotes(state, event.channel);
    }
  }

  markChannel(state, event);
  return state;
}

export function clonePerformanceState(state) {
  return {
    ...state,
    activeNotes: new Map([...state.activeNotes].map(([key, value]) => [key, { ...value }])),
    sustain: { ...state.sustain },
    sostenuto: { ...state.sostenuto },
    soft: { ...state.soft },
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
