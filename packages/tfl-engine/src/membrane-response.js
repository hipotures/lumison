// Mobile-inspired broad membrane response. Continuous radial/tangential
// displacement and timed wave events share one source-neutral configuration,
// while the generic transient store owns event allocation and age.

import { DEFAULT_TRANSIENT_CAPACITY } from './transients.js';

export const MEMBRANE_WAVE_EVENT_TYPE = 'membrane-wave';
export const MEMBRANE_WAVE_CAPACITY = DEFAULT_TRANSIENT_CAPACITY;

export const MEMBRANE_RESPONSE_DEFAULTS = Object.freeze({
  enabled: false,
  radialGain: 1,
  tangentialGain: 1,
  radius: 0.48,
  waveEnabled: true,
  waveGain: 1,
});

export const MEMBRANE_RESPONSE_LIMITS = Object.freeze({
  radialGain: Object.freeze([-2, 2]),
  tangentialGain: Object.freeze([-2, 2]),
  radius: Object.freeze([0.12, 0.9]),
  waveGain: Object.freeze([0, 2]),
});

export const MEMBRANE_RESPONSE_CALIBRATION = Object.freeze({
  fullAmplitude: 1.55,
  maximumRadialDisplacement: 0.055,
  maximumTangentialDisplacement: 0.048,
  tangentialSpeedStart: 0.04,
  tangentialSpeedFull: 1.6,
  attackRate: 10,
  releaseRate: 2.4,
  maximumCombinedDisplacement: 0.13,
});

// Mobile 2.2 used a broad sin((distance - front) * 15.5) wave with front
// speed 1.05 in its own accelerated event time. These values retain the soft,
// travelling-front character in canonical units without claiming a 1:1 map.
export const MEMBRANE_WAVE_DEFAULTS = Object.freeze({
  amplitude: 1,
  lifetime: 3.6,
  wavelength: 0.34,
  propagationSpeed: 0.36,
  width: 0.25,
  displacementGain: 1,
});

export const MEMBRANE_WAVE_LIMITS = Object.freeze({
  amplitude: Object.freeze([0, 2]),
  lifetime: Object.freeze([0.2, 8]),
  wavelength: Object.freeze([0.08, 0.8]),
  propagationSpeed: Object.freeze([0.03, 1.5]),
  width: Object.freeze([0.05, 0.7]),
  displacementGain: Object.freeze([0, 2]),
});

export const MEMBRANE_WAVE_CALIBRATION = Object.freeze({
  maximumEventDisplacement: 0.036,
  maximumCombinedDisplacement: 0.12,
});

const CONFIGURATION_KEYS = Object.keys(MEMBRANE_RESPONSE_DEFAULTS);
const BOOLEAN_KEYS = new Set(['enabled', 'waveEnabled']);
const EVENT_PARAMETER_KEYS = Object.freeze([
  'wavelength',
  'propagationSpeed',
  'width',
  'displacementGain',
]);

export function createMembraneResponseState(configuration = {}) {
  const state = {
    configuration: { ...MEMBRANE_RESPONSE_DEFAULTS },
    position: { x: 0, y: 0 },
    positionValid: false,
    active: false,
    sourceVelocity: { x: 0, y: 0 },
    sourceSpeed: 0,
    sourceAmplitude: 0,
    radialDisplacement: 0,
    tangentialDisplacement: 0,
    effectiveStrength: 0,
  };
  configureMembraneResponse(state, configuration);
  return state;
}

export function configureMembraneResponse(state, changes) {
  const report = {
    source: 'membrane-response',
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
      report.rejected.push({ name, value, reason: 'unknown-membrane-response-setting' });
      continue;
    }
    if (BOOLEAN_KEYS.has(name)) {
      if (typeof value !== 'boolean') {
        report.rejected.push({ name, value, reason: 'value-must-be-boolean' });
        continue;
      }
    } else {
      const [minimum, maximum] = MEMBRANE_RESPONSE_LIMITS[name];
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
  if (!state.configuration.enabled
    || (state.configuration.radialGain === 0 && state.configuration.tangentialGain === 0)) {
    clearContinuousResponse(state);
  }
  return report;
}

export function advanceMembraneResponse(state, influence, dt) {
  if (!finiteNumber(dt) || dt < 0) return false;
  const located = influence?.positionValid === true && finitePoint(influence.position);
  const engaged = located && influence?.engaged === true;
  const rawStrength = engaged && finiteNonnegative(influence?.strength)
    ? influence.strength
    : 0;
  const amplitude = Math.min(1, rawStrength / MEMBRANE_RESPONSE_CALIBRATION.fullAmplitude);
  const velocity = engaged && finitePoint(influence?.velocity)
    ? influence.velocity
    : { x: 0, y: 0 };
  const speed = Math.hypot(velocity.x, velocity.y);

  // Recovery remains anchored at the last driven location. A new located
  // source takes ownership after the old response has settled.
  if (engaged || state.effectiveStrength === 0) {
    if (located) {
      state.position.x = influence.position.x;
      state.position.y = influence.position.y;
    }
  }
  state.positionValid = located;
  state.active = engaged;
  state.sourceVelocity.x = velocity.x;
  state.sourceVelocity.y = velocity.y;
  state.sourceSpeed = speed;
  state.sourceAmplitude = amplitude;

  if (dt === 0) return true;
  const enabled = state.configuration.enabled;
  const radialTarget = enabled
    ? MEMBRANE_RESPONSE_CALIBRATION.maximumRadialDisplacement
      * state.configuration.radialGain * amplitude
    : 0;
  const tangentialDrive = membraneTangentialDriveForSpeed(speed);
  const tangentialTarget = enabled
    ? MEMBRANE_RESPONSE_CALIBRATION.maximumTangentialDisplacement
      * state.configuration.tangentialGain * amplitude * tangentialDrive
    : 0;
  const driven = engaged && (radialTarget !== 0 || tangentialTarget !== 0);
  const rate = driven
    ? MEMBRANE_RESPONSE_CALIBRATION.attackRate
    : MEMBRANE_RESPONSE_CALIBRATION.releaseRate;
  state.radialDisplacement = approach(state.radialDisplacement, radialTarget, rate, dt);
  state.tangentialDisplacement = approach(
    state.tangentialDisplacement,
    tangentialTarget,
    rate,
    dt,
  );
  state.effectiveStrength = Math.hypot(
    state.radialDisplacement,
    state.tangentialDisplacement,
  );
  if (state.effectiveStrength < 1e-7) clearContinuousResponse(state);
  return true;
}

export function membraneTangentialDriveForSpeed(speed) {
  if (!finiteNumber(speed) || speed <= 0) return 0;
  const { tangentialSpeedStart, tangentialSpeedFull } = MEMBRANE_RESPONSE_CALIBRATION;
  const t = Math.min(
    1,
    Math.max(0, (speed - tangentialSpeedStart) / (tangentialSpeedFull - tangentialSpeedStart)),
  );
  return t * t * (3 - 2 * t);
}

export function membraneResponseConfiguration(state) {
  return { ...state.configuration };
}

export function membraneResponseRenderState(state, store) {
  const configuration = membraneResponseConfiguration(state);
  const events = Array.from(
    { length: MEMBRANE_WAVE_CAPACITY },
    (_, slot) => renderWaveEntry(store?.entries?.[slot], configuration),
  );
  return {
    ...configuration,
    position: { ...state.position },
    positionValid: state.positionValid,
    active: state.active,
    sourceVelocity: { ...state.sourceVelocity },
    sourceSpeed: state.sourceSpeed,
    sourceAmplitude: state.sourceAmplitude,
    radialDisplacement: state.radialDisplacement,
    tangentialDisplacement: state.tangentialDisplacement,
    effectiveStrength: state.effectiveStrength,
    waveCapacity: MEMBRANE_WAVE_CAPACITY,
    activeWaveCount: events.reduce((count, event) => count + (event.active ? 1 : 0), 0),
    events,
  };
}

export function membraneContinuousDisplacementAt(state, position) {
  if (!state.configuration.enabled || state.effectiveStrength === 0
    || !finitePoint(position)) return { x: 0, y: 0 };
  const dx = position.x - state.position.x;
  const dy = position.y - state.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1e-9) return { x: 0, y: 0 };
  const envelope = Math.exp(-(distance * distance)
    / (state.configuration.radius * state.configuration.radius));
  const nx = dx / distance;
  const ny = dy / distance;
  return {
    x: (nx * state.radialDisplacement - ny * state.tangentialDisplacement) * envelope,
    y: (ny * state.radialDisplacement + nx * state.tangentialDisplacement) * envelope,
  };
}

export function createMembraneWaveEvent({
  origin,
  amplitude = MEMBRANE_WAVE_DEFAULTS.amplitude,
  lifetime = MEMBRANE_WAVE_DEFAULTS.lifetime,
  wavelength = MEMBRANE_WAVE_DEFAULTS.wavelength,
  propagationSpeed = MEMBRANE_WAVE_DEFAULTS.propagationSpeed,
  width = MEMBRANE_WAVE_DEFAULTS.width,
  displacementGain = MEMBRANE_WAVE_DEFAULTS.displacementGain,
} = {}) {
  const candidate = {
    type: MEMBRANE_WAVE_EVENT_TYPE,
    position: origin,
    radius: propagationSpeed * lifetime + width * 2,
    strength: amplitude,
    lifetime,
    parameters: { wavelength, propagationSpeed, width, displacementGain },
  };
  const validation = validateMembraneWaveEvent(candidate);
  if (!validation.ok) throw new TypeError(validation.reason);
  return validation.value;
}

export function validateMembraneWaveEvent(event) {
  if (!event || event.type !== MEMBRANE_WAVE_EVENT_TYPE) {
    return { ok: false, reason: 'event-type-must-be-membrane-wave' };
  }
  if (!finitePoint(event.position)) return { ok: false, reason: 'membrane-origin-must-be-finite' };
  const values = { amplitude: event.strength, lifetime: event.lifetime };
  for (const key of EVENT_PARAMETER_KEYS) values[key] = event.parameters?.[key];
  for (const [name, value] of Object.entries(values)) {
    const limits = MEMBRANE_WAVE_LIMITS[name];
    if (!finiteNumber(value)) return { ok: false, reason: `membrane-${name}-must-be-finite` };
    if (value < limits[0] || value > limits[1]) {
      return { ok: false, reason: `membrane-${name}-out-of-range` };
    }
  }
  return {
    ok: true,
    value: {
      type: MEMBRANE_WAVE_EVENT_TYPE,
      position: { ...event.position },
      radius: values.propagationSpeed * values.lifetime + values.width * 2,
      strength: values.amplitude,
      lifetime: values.lifetime,
      parameters: Object.fromEntries(EVENT_PARAMETER_KEYS.map((name) => [name, values[name]])),
    },
  };
}

export function membraneWaveRecoveryEnvelope(age, lifetime) {
  if (!finiteNumber(age) || !finiteNumber(lifetime) || lifetime <= 0) return 0;
  const progress = Math.min(1, Math.max(0, age / lifetime));
  return (1 - progress) * (1 - progress);
}

export function membraneWaveDisplacementAt(event, position, configuration = MEMBRANE_RESPONSE_DEFAULTS) {
  if (!finitePoint(position) || !event?.active || !configuration.enabled
    || !configuration.waveEnabled || configuration.waveGain === 0
    || event.displacement === 0) return { x: 0, y: 0 };
  const dx = position.x - event.position.x;
  const dy = position.y - event.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1e-9) return { x: 0, y: 0 };
  const fromFront = distance - event.age * event.propagationSpeed;
  const phase = fromFront * Math.PI * 2 / event.wavelength;
  const front = Math.exp(-(fromFront * fromFront) / (2 * event.width * event.width));
  const recovery = membraneWaveRecoveryEnvelope(event.age, event.lifetime);
  const signed = Math.sin(phase) * front * recovery * event.displacement;
  return { x: dx / distance * signed, y: dy / distance * signed };
}

export function membraneWaveDisplacementSum(renderState, position) {
  if (!renderState?.enabled || !renderState.waveEnabled || renderState.waveGain === 0
    || !finitePoint(position)) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const event of renderState.events ?? []) {
    const offset = membraneWaveDisplacementAt(event, position, renderState);
    x += offset.x;
    y += offset.y;
  }
  const magnitude = Math.hypot(x, y);
  const maximum = MEMBRANE_WAVE_CALIBRATION.maximumCombinedDisplacement;
  if (magnitude > maximum) {
    const scale = maximum / magnitude;
    x *= scale;
    y *= scale;
  }
  return { x, y };
}

export function snapshotMembraneResponseRuntime(state) {
  return {
    position: { ...state.position },
    positionValid: state.positionValid,
    active: state.active,
    sourceVelocity: { ...state.sourceVelocity },
    sourceSpeed: state.sourceSpeed,
    sourceAmplitude: state.sourceAmplitude,
    radialDisplacement: state.radialDisplacement,
    tangentialDisplacement: state.tangentialDisplacement,
    effectiveStrength: state.effectiveStrength,
  };
}

export function restoreMembraneResponseRuntime(state, saved) {
  if (!saved || typeof saved !== 'object'
    || !finitePoint(saved.position)
    || typeof saved.positionValid !== 'boolean'
    || typeof saved.active !== 'boolean'
    || !finitePoint(saved.sourceVelocity)
    || !finiteNonnegative(saved.sourceSpeed)
    || !finiteUnit(saved.sourceAmplitude)
    || !finiteNumber(saved.radialDisplacement)
    || !finiteNumber(saved.tangentialDisplacement)
    || !finiteNonnegative(saved.effectiveStrength)) return false;
  if (Math.abs(Math.hypot(saved.sourceVelocity.x, saved.sourceVelocity.y) - saved.sourceSpeed) > 1e-9
    || Math.abs(Math.hypot(saved.radialDisplacement, saved.tangentialDisplacement)
      - saved.effectiveStrength) > 1e-9) return false;
  state.position = { ...saved.position };
  state.positionValid = saved.positionValid;
  state.active = saved.active;
  state.sourceVelocity = { ...saved.sourceVelocity };
  state.sourceSpeed = saved.sourceSpeed;
  state.sourceAmplitude = saved.sourceAmplitude;
  state.radialDisplacement = saved.radialDisplacement;
  state.tangentialDisplacement = saved.tangentialDisplacement;
  state.effectiveStrength = saved.effectiveStrength;
  if (!state.configuration.enabled) clearContinuousResponse(state);
  return true;
}

function renderWaveEntry(entry, configuration) {
  const validation = entry?.active ? validateMembraneWaveEvent(entry) : null;
  if (!validation?.ok || !finiteNumber(entry.age)
    || entry.age < 0 || entry.age >= entry.lifetime) return inactiveWaveEntry();
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
    displacement: configuration.enabled && configuration.waveEnabled
      ? MEMBRANE_WAVE_CALIBRATION.maximumEventDisplacement
        * configuration.waveGain * value.strength * value.parameters.displacementGain
      : 0,
  };
}

function inactiveWaveEntry() {
  return {
    active: false,
    slot: -1,
    sequence: 0,
    position: { x: 0, y: 0 },
    age: 0,
    lifetime: 1,
    amplitude: 0,
    wavelength: MEMBRANE_WAVE_DEFAULTS.wavelength,
    propagationSpeed: MEMBRANE_WAVE_DEFAULTS.propagationSpeed,
    width: MEMBRANE_WAVE_DEFAULTS.width,
    displacementGain: 0,
    displacement: 0,
  };
}

function approach(value, target, rate, dt) {
  return value + (target - value) * (1 - Math.exp(-rate * dt));
}

function clearContinuousResponse(state) {
  state.radialDisplacement = 0;
  state.tangentialDisplacement = 0;
  state.effectiveStrength = 0;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function finitePoint(value) {
  return finiteNumber(value?.x) && finiteNumber(value?.y);
}

function finiteNonnegative(value) {
  return finiteNumber(value) && value >= 0;
}

function finiteUnit(value) {
  return finiteNumber(value) && value >= 0 && value <= 1;
}
