export const MUSICAL_FEATURE_CONFIG = Object.freeze({
  attackWindowShort: 1,
  attackWindowLong: 4,
  pitchMotionWindow: 1,
  pianoMinimum: 21,
  pianoMaximum: 108,
  spanSaturationSemitones: 48,
  motionSaturationSemitones: 12,
  polyphonySaturation: 4,
  densitySaturation: 6,
  energyWeights: Object.freeze({ velocity: 0.45, density: 0.35, polyphony: 0.20 }),
});

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

function emptyFeatures({ position = 0, tempoBpm = 120 } = {}) {
  return {
    position,
    tempoBpm,
    attackRate1s: 0,
    attackRate4s: 0,
    attackVelocity1s: 0,
    attackVelocity4s: 0,
    soundingPolyphony: 0,
    polyphony01: 0,
    pitchCentroid: null,
    register01: null,
    pitchSpan: 0,
    span01: 0,
    pitchMotion01: 0,
    sustain01: 0,
    density01: 0,
    energy01: 0,
    attackHistory: [],
  };
}

/**
 * Objective, timeline-derived musical features. Rolling windows are (T-window, T],
 * so an attack expires exactly when it becomes window-length seconds old.
 */
export function createMusicalFeatureState(options = {}) {
  return emptyFeatures(options);
}

function attacksInWindow(history, position, seconds) {
  const start = position - seconds;
  return history.filter((attack) => attack.timestamp > start && attack.timestamp <= position);
}

function meanVelocity(attacks) {
  if (!attacks.length) return 0;
  return attacks.reduce((sum, attack) => sum + attack.velocity, 0) / attacks.length;
}

function soundingPitchFeatures(performance) {
  let weightedPitch = 0;
  let totalWeight = 0;
  let unweightedPitch = 0;
  let voiceCount = 0;
  const pitches = new Set();

  for (const active of performance?.soundingNotes?.values?.() ?? []) {
    pitches.add(active.note);
    for (const voice of active.voices ?? []) {
      const velocity = clamp01(voice.velocity);
      weightedPitch += voice.note * velocity;
      totalWeight += velocity;
      unweightedPitch += voice.note;
      voiceCount += 1;
    }
  }

  if (!voiceCount) return { centroid: null, span: 0 };
  const sorted = [...pitches].sort((a, b) => a - b);
  return {
    centroid: totalWeight > 0 ? weightedPitch / totalWeight : unweightedPitch / voiceCount,
    span: sorted.length < 2 ? 0 : sorted.at(-1) - sorted[0],
  };
}

function pitchMotion(attacks, saturation) {
  if (attacks.length < 2) return 0;
  let distance = 0;
  for (let index = 1; index < attacks.length; index += 1) {
    distance += Math.abs(attacks[index].note - attacks[index - 1].note);
  }
  return clamp01(distance / (attacks.length - 1) / saturation);
}

export function updateMusicalFeatureState(
  state,
  performance,
  position = performance?.position ?? state.position,
  config = MUSICAL_FEATURE_CONFIG,
) {
  const time = Math.max(0, Number(position) || 0);
  state.position = time;
  state.tempoBpm = Number(performance?.currentTempo) || state.tempoBpm || 120;
  state.attackHistory = state.attackHistory.filter(
    (attack) => attack.timestamp > time - config.attackWindowLong
      && attack.timestamp <= time,
  );

  const attacks1s = attacksInWindow(state.attackHistory, time, config.attackWindowShort);
  const attacks4s = attacksInWindow(state.attackHistory, time, config.attackWindowLong);
  state.attackRate1s = attacks1s.length / config.attackWindowShort;
  state.attackRate4s = attacks4s.length / config.attackWindowLong;
  state.attackVelocity1s = meanVelocity(attacks1s);
  state.attackVelocity4s = meanVelocity(attacks4s);

  state.soundingPolyphony = Math.max(0, performance?.soundingPolyphony ?? 0);
  state.polyphony01 = 1 - Math.exp(-state.soundingPolyphony / config.polyphonySaturation);

  const pitch = soundingPitchFeatures(performance);
  state.pitchCentroid = pitch.centroid;
  state.register01 = pitch.centroid === null
    ? null
    : clamp01((pitch.centroid - config.pianoMinimum)
      / (config.pianoMaximum - config.pianoMinimum));
  state.pitchSpan = pitch.span;
  state.span01 = clamp01(pitch.span / config.spanSaturationSemitones);

  const motionAttacks = attacksInWindow(
    state.attackHistory,
    time,
    config.pitchMotionWindow,
  );
  state.pitchMotion01 = pitchMotion(motionAttacks, config.motionSaturationSemitones);
  state.sustain01 = clamp01(performance?.sustain?.value);
  state.density01 = 1 - Math.exp(-state.attackRate1s / config.densitySaturation);
  const weights = config.energyWeights;
  state.energy01 = clamp01(
    weights.velocity * state.attackVelocity1s
      + weights.density * state.density01
      + weights.polyphony * state.polyphony01,
  );
  return state;
}

export function reduceMusicalFeatureState(state, event, performance) {
  if (event?.type === 'note-on') {
    state.attackHistory.push({
      timestamp: event.timestamp,
      note: event.note,
      velocity: clamp01(event.velocity),
    });
  }
  return updateMusicalFeatureState(state, performance, event?.timestamp ?? performance?.position);
}

function firstEventAfter(events, timestamp) {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].timestamp <= timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Rebuild only the bounded rolling history; this never emits historical callbacks. */
export function rebuildMusicalFeatureState(
  events,
  performance,
  position,
  config = MUSICAL_FEATURE_CONFIG,
) {
  const time = Math.max(0, Number(position) || 0);
  const state = createMusicalFeatureState({
    position: time,
    tempoBpm: performance?.currentTempo ?? 120,
  });
  const start = firstEventAfter(events, time - config.attackWindowLong);
  const end = firstEventAfter(events, time);
  for (let index = start; index < end; index += 1) {
    const event = events[index];
    if (event.type === 'note-on') {
      state.attackHistory.push({
        timestamp: event.timestamp,
        note: event.note,
        velocity: clamp01(event.velocity),
      });
    }
  }
  return updateMusicalFeatureState(state, performance, time, config);
}
