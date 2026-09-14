import { MUSICAL_FIELD_V1 } from './mapping-profiles.js';
import { MOTION_WARP_LIMITS, RIPPLE_DISPLACEMENT_LIMITS, MEMBRANE_RESPONSE_LIMITS } from '../../../../packages/tfl-engine/src/index.js';

// Semantic paths are shared by serialization, runtime and generated controls.
export const TUNING_SCHEMA = [];
const add = (path, label, value, minimum, maximum, step = 0.01, feature = null) =>
  TUNING_SCHEMA.push({ path, label, default: value, minimum, maximum, step, feature });
const toggle = (path, label, feature) => add(path, label, true, undefined, undefined, undefined, feature);
export const GROUPS = {
  master: 'Master', transient: 'Attack / transient mapping', influence: 'Spatial musical field',
  parameterMappings: 'Continuous global parameter mappings', interactions: 'Visual mechanisms', temporal: 'Temporal response',
};
add('master.enabled', 'Mapping enabled', true);
add('master.sensitivity', 'Master sensitivity', 1, 0, 2);
const transientLinks = {
  enabled: ['Note On → ripple event'], pitchPosition: ['Pitch → horizontal position'],
  velocityPosition: ['Velocity → vertical position'], velocityAmplitude: ['Velocity → amplitude'],
  pitchWavelength: ['Pitch → wavelength'], energyPropagation: ['Energy → propagation speed', 'energy01'],
  sustainLifetime: ['Sustain → lifetime', 'sustain01'],
};
for (const [key, [label, feature]] of Object.entries(transientLinks)) toggle(`transient.${key}`, label, feature);
add('transient.pitchMinimum', 'Pitch range minimum (MIDI note)', MUSICAL_FIELD_V1.pitch.minimum, 0, 126, 1);
add('transient.pitchMaximum', 'Pitch range maximum (MIDI note)', MUSICAL_FIELD_V1.pitch.maximum, 1, 127, 1);
const ranges = {
  horizontalMargin: [0, 0.5], strongAttackY: [0, 1], softAttackY: [0, 1],
  amplitudeMinimum: [0, 2], amplitudeMaximum: [0, 2], amplitudeExponent: [0.1, 3],
  wavelengthLowPitch: [0.02, 0.5, 0.001], wavelengthHighPitch: [0.02, 0.5, 0.001],
  propagationMinimum: [0.01, 1], propagationEnergyDelta: [0, 1],
  lifetimeMinimum: [0.1, 4], lifetimeSustainDelta: [0, 4], width: [0.01, 0.5], displacementGain: [0, 2],
  viewportY: [0, 1], baseRadius: [0.01, 0.5], radiusMinimumDelta: [0, 0.3], radiusSpanDelta: [0, 0.6],
  strengthMinimumActive: [0, 2], strengthMaximum: [0, 2], activityThreshold: [0, 0.2, 0.001], maximumVelocity: [0, 3.2],
};
const words = (key) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
for (const [key, value] of Object.entries(MUSICAL_FIELD_V1.transient)) add(`transient.${key}`, words(key), value, ...ranges[key]);
for (const [key, label, feature] of [
  ['enabled', 'Spatial field enabled'], ['registerPosition', 'Register → field position', 'register01'],
  ['registerVelocity', 'Register movement → velocity', 'register01'], ['spanRadius', 'Span → radius', 'span01'],
  ['energyStrength', 'Energy → strength', 'energy01'], ['activityGate', 'Activity → engagement'],
  ['soundingActivity', 'Sounding notes → activity', 'soundingPolyphony'], ['densityActivity', 'Density → activity', 'density01'],
]) toggle(`influence.${key}`, label, feature);
for (const [key, value] of Object.entries(MUSICAL_FIELD_V1.influence)) add(`influence.${key}`, words(key), value, ...ranges[key]);
for (const [name, mapping] of Object.entries(MUSICAL_FIELD_V1.parameterMappings)) {
  toggle(`parameterMappings.${name}.enabled`, `${mapping.feature.replace('01', '')} → ${name}`, mapping.feature);
  const key = Object.hasOwn(mapping, 'delta') ? 'delta' : 'centeredDelta';
  const limit = key === 'delta' ? 2 : 360;
  add(`parameterMappings.${name}.${key}`, `${name} amount`, mapping[key], -limit, limit, key === 'delta' ? 0.01 : 1);
}
const limits = { motionWarp: MOTION_WARP_LIMITS, rippleDisplacement: RIPPLE_DISPLACEMENT_LIMITS, membraneResponse: MEMBRANE_RESPONSE_LIMITS };
for (const [name, settings] of Object.entries(MUSICAL_FIELD_V1.interactions)) {
  for (const [key, value] of Object.entries(settings)) add(`interactions.${name}.${key}`, `${words(name)}: ${words(key)}`, value, ...(limits[name]?.[key] ?? []));
}
add('temporal.parameterInterval', 'Parameter update interval (seconds)', MUSICAL_FIELD_V1.parameterInterval, 0, 0.2, 0.001);
add('temporal.parameterSmoothing', 'Smooth global parameter transitions', true);
add('temporal.enabled', 'Mapping smoothing enabled', false);
add('temporal.responseSeconds', 'Mapping smoothing time (seconds)', 0, 0, 2);

export const getTuningValue = (config, path) => path.split('.').reduce((value, key) => value?.[key], config);
export function setTuningValue(config, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((object, key) => (object[key] ??= {}), config);
  parent[last] = value;
}
export function defaultTuning() {
  const config = { schema: 'lumison-midi-visual-tuning', version: 1, profile: MUSICAL_FIELD_V1.id };
  for (const item of TUNING_SCHEMA) setTuningValue(config, item.path, item.default);
  return config;
}
export function validateTuning(input) {
  if (!input || input.schema !== 'lumison-midi-visual-tuning' || input.version !== 1 || input.profile !== MUSICAL_FIELD_V1.id) {
    throw new Error('Incompatible tuning schema, version or profile. Expected lumison-midi-visual-tuning version 1 / musical-field-v1.');
  }
  const result = defaultTuning();
  for (const item of TUNING_SCHEMA) {
    const value = getTuningValue(input, item.path);
    if (typeof value !== typeof item.default || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`Invalid or missing ${item.path}`);
    setTuningValue(result, item.path, typeof value === 'number' ? Math.max(item.minimum, Math.min(item.maximum, value)) : value);
  }
  // Reject unknown structure, including arrays, rather than silently accepting typos.
  const check = (actual, expected) => {
    if (!actual || Array.isArray(actual) || typeof actual !== 'object') throw new Error('Invalid tuning object');
    for (const key of Object.keys(actual)) {
      if (!Object.hasOwn(expected, key)) throw new Error(`Unknown tuning property: ${key}`);
      if (typeof expected[key] === 'object') check(actual[key], expected[key]);
    }
  };
  check(input, result);
  if (result.transient.pitchMinimum >= result.transient.pitchMaximum) throw new Error('Pitch maximum must exceed pitch minimum');
  return result;
}
export const parseTuning = (json) => validateTuning(JSON.parse(json));
export const serializeTuning = (config) => `${JSON.stringify(validateTuning(config), null, 2)}\n`;
export function disableAllTuning(config) {
  const next = validateTuning(config);
  for (const item of TUNING_SCHEMA) if (typeof item.default === 'boolean' && !item.path.startsWith('master.') && !item.path.startsWith('temporal.')) setTuningValue(next, item.path, false);
  return next;
}
export function soloTuning(config, path) {
  const next = disableAllTuning(config);
  if (!TUNING_SCHEMA.some((item) => item.path === path && typeof item.default === 'boolean')) throw new Error('Unknown mapping');
  next.master.enabled = true;
  setTuningValue(next, path, true);
  // Global parameters need no interaction mechanism. Spatial/ripple solos need
  // a carrier; their other musical contributions stay disabled.
  if (path.startsWith('transient.')) {
    next.transient.enabled = true;
    next.interactions.rippleDisplacement.enabled = true;
  }
  if (path.startsWith('influence.')) {
    next.influence.enabled = true;
    next.interactions.membraneResponse.enabled = true;
    if (['influence.soundingActivity', 'influence.densityActivity'].includes(path)) next.influence.activityGate = true;
    if (path === 'influence.activityGate') {
      next.influence.soundingActivity = true;
      next.influence.densityActivity = true;
    }
  }
  return next;
}
