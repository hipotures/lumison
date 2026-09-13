// Timed radial coordinate displacement built on the generic transient-event
// store. All positions, lengths and propagation rates use canonical surface
// units. Events contain no browser/input-source semantics.

import { DEFAULT_TRANSIENT_CAPACITY } from './transients.js';

export const RIPPLE_DISPLACEMENT_EVENT_TYPE = 'ripple-displacement';
export const RIPPLE_DISPLACEMENT_CAPACITY = DEFAULT_TRANSIENT_CAPACITY;

export const RIPPLE_DISPLACEMENT_DEFAULTS = Object.freeze({
  enabled: false,
  gain: 1,
});

export const RIPPLE_DISPLACEMENT_LIMITS = Object.freeze({
  gain: Object.freeze([0, 2]),
});

// Qwen V1 used sin(distance * 46 - age * 7.4), equivalent to a wavelength
// near 0.137 and phase speed near 0.161 in its surface coordinates. Phase 3D
// keeps that travelling-wave idea but uses a localized front, explicit
// canonical units and a shorter, smooth finite lifetime.
export const RIPPLE_EVENT_DEFAULTS = Object.freeze({
  amplitude: 1,
  lifetime: 2.4,
  wavelength: 0.11,
  propagationSpeed: 0.28,
  width: 0.10,
  displacementGain: 1,
});

export const RIPPLE_EVENT_LIMITS = Object.freeze({
  amplitude: Object.freeze([0, 2]),
  lifetime: Object.freeze([0.1, 8]),
  wavelength: Object.freeze([0.02, 0.5]),
  propagationSpeed: Object.freeze([0.01, 2]),
  width: Object.freeze([0.01, 0.5]),
  displacementGain: Object.freeze([0, 2]),
});

export const RIPPLE_DISPLACEMENT_CALIBRATION = Object.freeze({
  maximumEventDisplacement: 0.018,
  maximumCombinedDisplacement: 0.09,
});

const CONFIGURATION_KEYS = Object.keys(RIPPLE_DISPLACEMENT_DEFAULTS);
const EVENT_PARAMETER_KEYS = Object.freeze([
  'wavelength',
  'propagationSpeed',
  'width',
  'displacementGain',
]);

export function createRippleDisplacementState(configuration = {}) {
  const state = { configuration: { ...RIPPLE_DISPLACEMENT_DEFAULTS } };
  configureRippleDisplacement(state, configuration);
  return state;
}

export function configureRippleDisplacement(state, changes) {
  const report = {
    source: 'ripple-displacement',
    ok: true,
    changed: false,
    accepted: [],
    rejected: [],
  };
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    report.ok = false;
    report.rejected.push({ name: null, reason: 'changes-must-be-an-object' });
    return report;
  }

  for (const [name, value] of Object.entries(changes)) {
    if (!CONFIGURATION_KEYS.includes(name)) {
      report.rejected.push({ name, value, reason: 'unknown-ripple-displacement-setting' });
      continue;
    }
    if (name === 'enabled') {
      if (typeof value !== 'boolean') {
        report.rejected.push({ name, value, reason: 'value-must-be-boolean' });
        continue;
      }
    } else {
      const [minimum, maximum] = RIPPLE_DISPLACEMENT_LIMITS[name];
      if (!finiteNumber(value)) {
        report.rejected.push({ name, value, reason: 'value-must-be-finite-number' });
        continue;
      }
      if (value < minimum || value > maximum) {
        report.rejected.push({ name, value, minimum, maximum, reason: 'value-out-of-range' });
        continue;
      }
    }
    if (state.configuration[name] !== value) report.changed = true;
    state.configuration[name] = value;
    report.accepted.push({ name, value });
  }
  report.ok = report.rejected.length === 0;
  return report;
}

export function rippleDisplacementConfiguration(state) {
  return { ...state.configuration };
}

export function createRippleDisplacementEvent({
  origin,
  amplitude = RIPPLE_EVENT_DEFAULTS.amplitude,
  lifetime = RIPPLE_EVENT_DEFAULTS.lifetime,
  wavelength = RIPPLE_EVENT_DEFAULTS.wavelength,
  propagationSpeed = RIPPLE_EVENT_DEFAULTS.propagationSpeed,
  width = RIPPLE_EVENT_DEFAULTS.width,
  displacementGain = RIPPLE_EVENT_DEFAULTS.displacementGain,
} = {}) {
  const candidate = {
    type: RIPPLE_DISPLACEMENT_EVENT_TYPE,
    position: origin,
    // Generic radius records the maximum intended footprint of this event.
    radius: propagationSpeed * lifetime + width * 2,
    strength: amplitude,
    lifetime,
    parameters: { wavelength, propagationSpeed, width, displacementGain },
  };
  const validation = validateRippleDisplacementEvent(candidate);
  if (!validation.ok) throw new TypeError(validation.reason);
  return validation.value;
}

export function validateRippleDisplacementEvent(event) {
  if (!event || event.type !== RIPPLE_DISPLACEMENT_EVENT_TYPE) {
    return { ok: false, reason: 'event-type-must-be-ripple-displacement' };
  }
  if (!finitePoint(event.position)) {
    return { ok: false, reason: 'ripple-origin-must-be-finite' };
  }
  const amplitude = event.strength;
  const lifetime = event.lifetime;
  const values = { amplitude, lifetime };
  for (const key of EVENT_PARAMETER_KEYS) values[key] = event.parameters?.[key];
  for (const [name, value] of Object.entries(values)) {
    const limits = RIPPLE_EVENT_LIMITS[name];
    if (!finiteNumber(value)) return { ok: false, reason: `ripple-${name}-must-be-finite` };
    if (value < limits[0] || value > limits[1]) {
      return { ok: false, reason: `ripple-${name}-out-of-range` };
    }
  }
  const radius = values.propagationSpeed * lifetime + values.width * 2;
  return {
    ok: true,
    value: {
      type: RIPPLE_DISPLACEMENT_EVENT_TYPE,
      position: { ...event.position },
      radius,
      strength: amplitude,
      lifetime,
      parameters: Object.fromEntries(EVENT_PARAMETER_KEYS.map((name) => [name, values[name]])),
    },
  };
}

export function rippleDisplacementRenderState(state, store) {
  const configuration = rippleDisplacementConfiguration(state);
  const events = Array.from(
    { length: RIPPLE_DISPLACEMENT_CAPACITY },
    (_, slot) => renderEntry(store?.entries?.[slot], configuration),
  );
  return {
    ...configuration,
    capacity: RIPPLE_DISPLACEMENT_CAPACITY,
    activeEventCount: events.reduce((count, event) => count + (event.active ? 1 : 0), 0),
    events,
  };
}

export function rippleEventDisplacementAt(event, position, configuration = RIPPLE_DISPLACEMENT_DEFAULTS) {
  if (!finitePoint(position) || !event?.active || !configuration.enabled
    || configuration.gain === 0 || event.displacement === 0) return { x: 0, y: 0 };
  const dx = position.x - event.position.x;
  const dy = position.y - event.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1e-9) return { x: 0, y: 0 };
  const waveRadius = event.age * event.propagationSpeed;
  const fromFront = distance - waveRadius;
  const phase = fromFront * Math.PI * 2 / event.wavelength;
  const front = Math.exp(-(fromFront * fromFront) / (2 * event.width * event.width));
  const progress = Math.min(1, Math.max(0, event.age / event.lifetime));
  const lifetimeFade = (1 - progress) * (1 - progress);
  const signed = Math.sin(phase) * front * lifetimeFade * event.displacement;
  return { x: dx / distance * signed, y: dy / distance * signed };
}

export function rippleDisplacementAt(renderState, position) {
  if (!renderState?.enabled || renderState.gain === 0 || !finitePoint(position)) {
    return { x: 0, y: 0 };
  }
  let x = 0;
  let y = 0;
  for (const event of renderState.events ?? []) {
    const offset = rippleEventDisplacementAt(event, position, renderState);
    x += offset.x;
    y += offset.y;
  }
  const magnitude = Math.hypot(x, y);
  const maximum = RIPPLE_DISPLACEMENT_CALIBRATION.maximumCombinedDisplacement;
  if (magnitude > maximum) {
    const scale = maximum / magnitude;
    x *= scale;
    y *= scale;
  }
  return { x, y };
}

function renderEntry(entry, configuration) {
  const validation = entry?.active ? validateRippleDisplacementEvent(entry) : null;
  if (!validation?.ok || !(finiteNumber(entry.age) && entry.age >= 0 && entry.age < entry.lifetime)) {
    return inactiveRenderEntry();
  }
  const value = validation.value;
  return {
    active: true,
    slot: entry.slot,
    sequence: entry.sequence,
    position: { ...value.position },
    age: entry.age,
    lifetime: value.lifetime,
    amplitude: value.strength,
    wavelength: value.parameters.wavelength,
    propagationSpeed: value.parameters.propagationSpeed,
    width: value.parameters.width,
    displacementGain: value.parameters.displacementGain,
    displacement: configuration.enabled
      ? RIPPLE_DISPLACEMENT_CALIBRATION.maximumEventDisplacement
        * configuration.gain * value.strength * value.parameters.displacementGain
      : 0,
  };
}

function inactiveRenderEntry() {
  return {
    active: false,
    slot: -1,
    sequence: 0,
    position: { x: 0, y: 0 },
    age: 0,
    lifetime: 1,
    amplitude: 0,
    wavelength: RIPPLE_EVENT_DEFAULTS.wavelength,
    propagationSpeed: RIPPLE_EVENT_DEFAULTS.propagationSpeed,
    width: RIPPLE_EVENT_DEFAULTS.width,
    displacementGain: 0,
    displacement: 0,
  };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function finitePoint(value) {
  return finiteNumber(value?.x) && finiteNumber(value?.y);
}
