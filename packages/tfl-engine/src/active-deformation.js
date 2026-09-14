// Optional press- and velocity-driven domain displacement for a continuous
// spatial influence. This module uses canonical surface units and contains no
// browser or device semantics. Both new responses default off; the historical
// Fixed response remains enabled for compatibility.

export const ACTIVE_DEFORMATION_DEFAULTS = Object.freeze({
  pressEnabled: false,
  pressGain: 1,
  dragEnabled: false,
  dragGain: 1,
  radius: 0.19,
});

export const ACTIVE_DEFORMATION_LIMITS = Object.freeze({
  pressGain: Object.freeze([-2, 2]),
  dragGain: Object.freeze([0, 2]),
  radius: Object.freeze([0.03, 0.5]),
});

// Qwen V1 used a 0.09 radial press offset and multiplied frame-smoothed
// velocity by an event-count-dependent strength. Here displacement is bounded
// in canonical surface units and drag drive is derived from real speed.
export const ACTIVE_DEFORMATION_CALIBRATION = Object.freeze({
  fullAmplitude: 1.55,
  maximumPressDisplacement: 0.075,
  maximumDragDisplacement: 0.08,
  dragSpeedStart: 0.05,
  dragSpeedFull: 2,
  pressAttackRate: 18,
  dragAttackRate: 20,
  releaseRate: 7,
});

const CONFIGURATION_KEYS = Object.keys(ACTIVE_DEFORMATION_DEFAULTS);
const BOOLEAN_KEYS = new Set(['pressEnabled', 'dragEnabled']);

export function createActiveDeformationState(configuration = {}) {
  const state = {
    configuration: { ...ACTIVE_DEFORMATION_DEFAULTS },
    position: { x: 0, y: 0 },
    positionValid: false,
    active: false,
    sourceVelocity: { x: 0, y: 0 },
    sourceSpeed: 0,
    sourceAmplitude: 0,
    pressDisplacement: 0,
    pressEffectiveStrength: 0,
    dragDisplacement: { x: 0, y: 0 },
    dragEffectiveStrength: 0,
  };
  configureActiveDeformation(state, configuration);
  return state;
}

export function configureActiveDeformation(state, changes) {
  const report = {
    source: 'active-deformation',
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
      report.rejected.push({ name, value, reason: 'unknown-active-deformation-setting' });
      continue;
    }
    if (BOOLEAN_KEYS.has(name)) {
      if (typeof value !== 'boolean') {
        report.rejected.push({ name, value, reason: 'value-must-be-boolean' });
        continue;
      }
    } else {
      const [minimum, maximum] = ACTIVE_DEFORMATION_LIMITS[name];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
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
  if (!state.configuration.pressEnabled || state.configuration.pressGain === 0) {
    clearPressResponse(state);
  }
  if (!state.configuration.dragEnabled || state.configuration.dragGain === 0) {
    clearDragResponse(state);
  }
  return report;
}

export function advanceActiveDeformation(state, influence, dt) {
  if (!(typeof dt === 'number' && Number.isFinite(dt)) || dt < 0) return false;
  const located = influence?.positionValid === true && finitePoint(influence.position);
  const engaged = located && influence?.engaged === true;
  const rawStrength = engaged && finiteNonnegative(influence?.strength)
    ? influence.strength
    : 0;
  const amplitude = Math.min(1, rawStrength / ACTIVE_DEFORMATION_CALIBRATION.fullAmplitude);
  const velocity = engaged && finitePoint(influence?.velocity)
    ? influence.velocity
    : { x: 0, y: 0 };
  const speed = Math.hypot(velocity.x, velocity.y);

  // Keep a releasing response anchored at its last active location. A located
  // inactive source may establish the next position once no response remains.
  if (engaged || (state.pressEffectiveStrength === 0 && state.dragEffectiveStrength === 0)) {
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

  const pressTarget = state.configuration.pressEnabled
    ? ACTIVE_DEFORMATION_CALIBRATION.maximumPressDisplacement
      * state.configuration.pressGain * amplitude
    : 0;
  const pressRate = engaged && pressTarget !== 0
    ? ACTIVE_DEFORMATION_CALIBRATION.pressAttackRate
    : ACTIVE_DEFORMATION_CALIBRATION.releaseRate;
  state.pressDisplacement = approach(
    state.pressDisplacement,
    pressTarget,
    pressRate,
    dt,
  );
  state.pressEffectiveStrength = Math.abs(state.pressDisplacement);

  const drive = activeDragDriveForSpeed(speed);
  const dragMagnitude = state.configuration.dragEnabled
    ? ACTIVE_DEFORMATION_CALIBRATION.maximumDragDisplacement
      * state.configuration.dragGain * amplitude * drive
    : 0;
  const inverseSpeed = speed > 0 ? 1 / speed : 0;
  const dragTargetX = velocity.x * inverseSpeed * dragMagnitude;
  const dragTargetY = velocity.y * inverseSpeed * dragMagnitude;
  const dragRate = engaged && dragMagnitude > 0
    ? ACTIVE_DEFORMATION_CALIBRATION.dragAttackRate
    : ACTIVE_DEFORMATION_CALIBRATION.releaseRate;
  state.dragDisplacement.x = approach(
    state.dragDisplacement.x,
    dragTargetX,
    dragRate,
    dt,
  );
  state.dragDisplacement.y = approach(
    state.dragDisplacement.y,
    dragTargetY,
    dragRate,
    dt,
  );
  state.dragEffectiveStrength = Math.hypot(
    state.dragDisplacement.x,
    state.dragDisplacement.y,
  );

  settleTinyResponses(state);
  return true;
}

export function activeDragDriveForSpeed(speed) {
  if (!(typeof speed === 'number' && Number.isFinite(speed)) || speed <= 0) return 0;
  const { dragSpeedStart, dragSpeedFull } = ACTIVE_DEFORMATION_CALIBRATION;
  const t = Math.min(1, Math.max(0, (speed - dragSpeedStart) / (dragSpeedFull - dragSpeedStart)));
  return t * t * (3 - 2 * t);
}

export function activeDeformationConfiguration(state) {
  return { ...state.configuration };
}

export function activeDeformationRenderState(state) {
  return {
    ...state.configuration,
    position: { ...state.position },
    positionValid: state.positionValid,
    active: state.active,
    sourceVelocity: { ...state.sourceVelocity },
    sourceSpeed: state.sourceSpeed,
    sourceAmplitude: state.sourceAmplitude,
    pressDisplacement: state.pressDisplacement,
    pressEffectiveStrength: state.pressEffectiveStrength,
    dragDisplacement: { ...state.dragDisplacement },
    dragEffectiveStrength: state.dragEffectiveStrength,
  };
}

export function snapshotActiveDeformationRuntime(state) {
  return {
    position: { ...state.position },
    positionValid: state.positionValid,
    active: state.active,
    sourceVelocity: { ...state.sourceVelocity },
    sourceSpeed: state.sourceSpeed,
    sourceAmplitude: state.sourceAmplitude,
    pressDisplacement: state.pressDisplacement,
    pressEffectiveStrength: state.pressEffectiveStrength,
    dragDisplacement: { ...state.dragDisplacement },
    dragEffectiveStrength: state.dragEffectiveStrength,
  };
}

export function restoreActiveDeformationRuntime(state, saved) {
  if (!saved || typeof saved !== 'object'
    || !finitePoint(saved.position)
    || typeof saved.positionValid !== 'boolean'
    || typeof saved.active !== 'boolean'
    || !finitePoint(saved.sourceVelocity)
    || !finiteNonnegative(saved.sourceSpeed)
    || !finiteUnit(saved.sourceAmplitude)
    || !finiteNumber(saved.pressDisplacement)
    || !finiteNonnegative(saved.pressEffectiveStrength)
    || !finitePoint(saved.dragDisplacement)
    || !finiteNonnegative(saved.dragEffectiveStrength)) return false;
  if (Math.abs(Math.hypot(saved.sourceVelocity.x, saved.sourceVelocity.y) - saved.sourceSpeed) > 1e-9
    || Math.abs(Math.abs(saved.pressDisplacement) - saved.pressEffectiveStrength) > 1e-9
    || Math.abs(Math.hypot(saved.dragDisplacement.x, saved.dragDisplacement.y)
      - saved.dragEffectiveStrength) > 1e-9) return false;

  state.position = { ...saved.position };
  state.positionValid = saved.positionValid;
  state.active = saved.active;
  state.sourceVelocity = { ...saved.sourceVelocity };
  state.sourceSpeed = saved.sourceSpeed;
  state.sourceAmplitude = saved.sourceAmplitude;
  state.pressDisplacement = saved.pressDisplacement;
  state.pressEffectiveStrength = saved.pressEffectiveStrength;
  state.dragDisplacement = { ...saved.dragDisplacement };
  state.dragEffectiveStrength = saved.dragEffectiveStrength;
  if (!state.configuration.pressEnabled || state.configuration.pressGain === 0) {
    clearPressResponse(state);
  }
  if (!state.configuration.dragEnabled || state.configuration.dragGain === 0) {
    clearDragResponse(state);
  }
  return true;
}

// Pure CPU mirror of the shader's sampling-coordinate displacement envelope.
// Positive press gain samples inward. Drag is subtracted from sampling
// coordinates so visible landmarks move in the stored velocity direction.
export function activeDeformationDisplacementAt(state, position) {
  if (!finitePoint(position)) return { x: 0, y: 0 };
  const dx = position.x - state.position.x;
  const dy = position.y - state.position.y;
  const distance = Math.hypot(dx, dy);
  const radius = state.configuration.radius;
  const envelope = Math.exp(-(dx * dx + dy * dy) / (radius * radius));
  const inverseDistance = distance > 1e-4 ? 1 / distance : 0;
  return {
    x: (-state.dragDisplacement.x - dx * inverseDistance * state.pressDisplacement) * envelope,
    y: (-state.dragDisplacement.y - dy * inverseDistance * state.pressDisplacement) * envelope,
  };
}

function approach(value, target, rate, dt) {
  return value + (target - value) * (1 - Math.exp(-rate * dt));
}

function settleTinyResponses(state) {
  if (state.pressEffectiveStrength < 1e-7) clearPressResponse(state);
  if (state.dragEffectiveStrength < 1e-7) clearDragResponse(state);
}

function clearPressResponse(state) {
  state.pressDisplacement = 0;
  state.pressEffectiveStrength = 0;
}

function clearDragResponse(state) {
  state.dragDisplacement.x = 0;
  state.dragDisplacement.y = 0;
  state.dragEffectiveStrength = 0;
}

function finitePoint(point) {
  return point && finiteNumber(point.x) && finiteNumber(point.y);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteNonnegative(value) {
  return finiteNumber(value) && value >= 0;
}

function finiteUnit(value) {
  return finiteNumber(value) && value >= 0 && value <= 1;
}
