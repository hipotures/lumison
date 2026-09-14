// Lightweight Lab profiles for comparing interaction geometry. Profile data
// contains only source-neutral engine interaction settings and Lab event
// trigger policy; it never includes film, optical, lighting or render values.

export const INTERACTION_PROFILE_NAMES = Object.freeze([
  'Qwen-like',
  'Mobile-like',
  'Custom',
]);

export const MEMBRANE_WAVE_DRAG_SPACING = 0.14;

export const INTERACTION_PROFILES = deepFreeze({
  'Qwen-like': {
    motionWarp: { enabled: true, gain: 1, radius: 0.19 },
    activeDeformation: {
      pressEnabled: true,
      pressGain: 1,
      dragEnabled: true,
      dragGain: 1,
      radius: 0.19,
    },
    coordinateShear: { enabled: true, gain: 1 },
    rippleDisplacement: { enabled: true, gain: 1 },
    membraneResponse: {
      enabled: false,
      radialGain: 1,
      tangentialGain: 1,
      radius: 0.48,
      waveEnabled: true,
      waveGain: 1,
    },
    triggers: {
      rippleOnClick: true,
      rippleDuringDrag: true,
      membraneWaveOnPress: true,
      membraneWaveDuringDrag: false,
    },
  },
  'Mobile-like': {
    motionWarp: { enabled: false, gain: 1, radius: 0.19 },
    activeDeformation: {
      pressEnabled: false,
      pressGain: 1,
      dragEnabled: false,
      dragGain: 1,
      radius: 0.19,
    },
    coordinateShear: { enabled: false, gain: 1 },
    rippleDisplacement: { enabled: false, gain: 1 },
    membraneResponse: {
      enabled: true,
      radialGain: 0.85,
      tangentialGain: 0.9,
      radius: 0.5,
      waveEnabled: true,
      waveGain: 0.9,
    },
    triggers: {
      rippleOnClick: true,
      rippleDuringDrag: false,
      membraneWaveOnPress: true,
      membraneWaveDuringDrag: true,
    },
  },
});

export function applyInteractionProfile(engine, labState, name) {
  if (name === 'Custom') {
    labState.interactionProfile = 'Custom';
    return { ok: true, changed: false, name, reports: [] };
  }
  const profile = INTERACTION_PROFILES[name];
  if (!profile) return { ok: false, changed: false, name, reports: [] };
  const reports = [
    engine.setMotionWarp(profile.motionWarp),
    engine.setActiveDeformation(profile.activeDeformation),
    engine.setCoordinateShear(profile.coordinateShear),
    engine.setRippleDisplacement(profile.rippleDisplacement),
    engine.setMembraneResponse(profile.membraneResponse),
  ];
  if (reports.some((report) => !report.ok)) {
    return { ok: false, changed: false, name, reports };
  }
  const previousTriggers = triggerConfiguration(labState);
  Object.assign(labState, profile.triggers);
  labState.interactionProfile = name;
  engine.clearTransientEvents();
  return {
    ok: true,
    changed: reports.some((report) => report.changed)
      || JSON.stringify(previousTriggers) !== JSON.stringify(profile.triggers),
    name,
    reports,
  };
}

export function markInteractionProfileCustom(labState) {
  const changed = labState.interactionProfile !== 'Custom';
  labState.interactionProfile = 'Custom';
  return changed;
}

export function triggerConfiguration(labState) {
  return {
    rippleOnClick: labState.rippleOnClick === true,
    rippleDuringDrag: labState.rippleDuringDrag === true,
    membraneWaveOnPress: labState.membraneWaveOnPress === true,
    membraneWaveDuringDrag: labState.membraneWaveDuringDrag === true,
  };
}

function deepFreeze(value) {
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') deepFreeze(nested);
  }
  return Object.freeze(value);
}
