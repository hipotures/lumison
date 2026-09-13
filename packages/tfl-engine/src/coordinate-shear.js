// Optional active-drag coordinate shear for a continuous spatial influence.
// The response is expressed entirely in canonical surface units and contains
// no browser, device or pointer-button semantics. It defaults off so the
// accepted Phase 3B path remains exact.

export const COORDINATE_SHEAR_DEFAULTS = Object.freeze({
  enabled: false,
  gain: 1,
});

export const COORDINATE_SHEAR_LIMITS = Object.freeze({
  gain: Object.freeze([0, 2]),
});

// The response vector is the bounded off-diagonal displacement coefficient
// used by coordinateShearDisplacementAt(). It is calibrated independently of
// Active Drag translation, although both consume the same canonical velocity.
export const COORDINATE_SHEAR_CALIBRATION = Object.freeze({
  fullAmplitude: 1.55,
  maximumDisplacement: 0.12,
  speedStart: 0.05,
  speedFull: 2,
  attackRate: 20,
  releaseRate: 7,
});

const CONFIGURATION_KEYS = Object.keys(COORDINATE_SHEAR_DEFAULTS);

export function createCoordinateShearState(configuration = {}) {
  const state = {
    configuration: { ...COORDINATE_SHEAR_DEFAULTS },
    position: { x: 0, y: 0 },
    positionValid: false,
    active: false,
    sourceVelocity: { x: 0, y: 0 },
    sourceSpeed: 0,
    sourceAmplitude: 0,
    displacement: { x: 0, y: 0 },
    effectiveStrength: 0,
  };
  configureCoordinateShear(state, configuration);
  return state;
}

export function configureCoordinateShear(state, changes) {
  const report = {
    source: 'coordinate-shear',
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
      report.rejected.push({ name, value, reason: 'unknown-coordinate-shear-setting' });
      continue;
    }
    if (name === 'enabled') {
      if (typeof value !== 'boolean') {
        report.rejected.push({ name, value, reason: 'value-must-be-boolean' });
        continue;
      }
    } else {
      const [minimum, maximum] = COORDINATE_SHEAR_LIMITS[name];
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
  if (!state.configuration.enabled || state.configuration.gain === 0) clearResponse(state);
  return report;
}

export function advanceCoordinateShear(state, influence, dt) {
  if (!finiteNumber(dt) || dt < 0) return false;
  const located = influence?.positionValid === true && finitePoint(influence.position);
  const engaged = located && influence?.engaged === true;
  const rawStrength = engaged && finiteNonnegative(influence?.strength)
    ? influence.strength
    : 0;
  const amplitude = Math.min(1, rawStrength / COORDINATE_SHEAR_CALIBRATION.fullAmplitude);
  const velocity = engaged && finitePoint(influence?.velocity)
    ? influence.velocity
    : { x: 0, y: 0 };
  const speed = Math.hypot(velocity.x, velocity.y);

  // A releasing transform remains anchored at the last driven location.
  // Once settled, any located influence can establish the next center.
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

  const drive = coordinateShearDriveForSpeed(speed);
  const magnitude = state.configuration.enabled
    ? COORDINATE_SHEAR_CALIBRATION.maximumDisplacement
      * state.configuration.gain * amplitude * drive
    : 0;
  const inverseSpeed = magnitude > 0 && speed > 0 ? 1 / speed : 0;
  const targetX = velocity.x * inverseSpeed * magnitude;
  const targetY = velocity.y * inverseSpeed * magnitude;
  const rate = engaged && magnitude > 0
    ? COORDINATE_SHEAR_CALIBRATION.attackRate
    : COORDINATE_SHEAR_CALIBRATION.releaseRate;
  state.displacement.x = approach(state.displacement.x, targetX, rate, dt);
  state.displacement.y = approach(state.displacement.y, targetY, rate, dt);
  state.effectiveStrength = Math.hypot(state.displacement.x, state.displacement.y);
  if (state.effectiveStrength < 1e-7) clearResponse(state);
  return true;
}

export function coordinateShearDriveForSpeed(speed) {
  if (!finiteNumber(speed) || speed <= 0) return 0;
  const { speedStart, speedFull } = COORDINATE_SHEAR_CALIBRATION;
  const t = Math.min(1, Math.max(0, (speed - speedStart) / (speedFull - speedStart)));
  return t * t * (3 - 2 * t);
}

export function coordinateShearConfiguration(state) {
  return { ...state.configuration };
}

export function coordinateShearRenderState(state, radius) {
  return {
    ...state.configuration,
    radius,
    position: { ...state.position },
    positionValid: state.positionValid,
    active: state.active,
    sourceVelocity: { ...state.sourceVelocity },
    sourceSpeed: state.sourceSpeed,
    sourceAmplitude: state.sourceAmplitude,
    displacement: { ...state.displacement },
    effectiveStrength: state.effectiveStrength,
  };
}

export function snapshotCoordinateShearRuntime(state) {
  return {
    position: { ...state.position },
    positionValid: state.positionValid,
    active: state.active,
    sourceVelocity: { ...state.sourceVelocity },
    sourceSpeed: state.sourceSpeed,
    sourceAmplitude: state.sourceAmplitude,
    displacement: { ...state.displacement },
    effectiveStrength: state.effectiveStrength,
  };
}

export function restoreCoordinateShearRuntime(state, saved) {
  if (!saved || typeof saved !== 'object'
    || !finitePoint(saved.position)
    || typeof saved.positionValid !== 'boolean'
    || typeof saved.active !== 'boolean'
    || !finitePoint(saved.sourceVelocity)
    || !finiteNonnegative(saved.sourceSpeed)
    || !finiteUnit(saved.sourceAmplitude)
    || !finitePoint(saved.displacement)
    || !finiteNonnegative(saved.effectiveStrength)) return false;
  if (Math.abs(Math.hypot(saved.sourceVelocity.x, saved.sourceVelocity.y) - saved.sourceSpeed) > 1e-9
    || Math.abs(Math.hypot(saved.displacement.x, saved.displacement.y)
      - saved.effectiveStrength) > 1e-9) return false;

  state.position = { ...saved.position };
  state.positionValid = saved.positionValid;
  state.active = saved.active;
  state.sourceVelocity = { ...saved.sourceVelocity };
  state.sourceSpeed = saved.sourceSpeed;
  state.sourceAmplitude = saved.sourceAmplitude;
  state.displacement = { ...saved.displacement };
  state.effectiveStrength = saved.effectiveStrength;
  if (!state.configuration.enabled || state.configuration.gain === 0) clearResponse(state);
  return true;
}

// Pure CPU mirror of the local off-diagonal shader transform. Local X drives
// Y displacement and local Y drives X displacement. This produces true shear
// for cardinal drags, a combined skew/stretch for diagonal drags, and reverses
// exactly when the canonical velocity reverses. Inverse sampling accounts for
// the leading minus signs.
export function coordinateShearDisplacementAt(state, position, radius) {
  if (!finitePoint(position) || !finitePositive(radius)
    || state.effectiveStrength === 0) return { x: 0, y: 0 };
  const dx = position.x - state.position.x;
  const dy = position.y - state.position.y;
  if (dx === 0 && dy === 0) return { x: 0, y: 0 };
  const radius2 = radius * radius;
  const envelope = Math.exp(-(dx * dx + dy * dy) / radius2);
  const acrossY = Math.min(1, Math.max(-1, dy / radius));
  const acrossX = Math.min(1, Math.max(-1, dx / radius));
  return {
    x: -state.displacement.x * acrossY * envelope,
    y: -state.displacement.y * acrossX * envelope,
  };
}

function approach(value, target, rate, dt) {
  return value + (target - value) * (1 - Math.exp(-rate * dt));
}

function clearResponse(state) {
  state.displacement.x = 0;
  state.displacement.y = 0;
  state.effectiveStrength = 0;
}

function finitePoint(point) {
  return point && finiteNumber(point.x) && finiteNumber(point.y);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function finitePositive(value) {
  return finiteNumber(value) && value > 0;
}

function finiteNonnegative(value) {
  return finiteNumber(value) && value >= 0;
}

function finiteUnit(value) {
  return finiteNumber(value) && value >= 0 && value <= 1;
}
