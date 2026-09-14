import {
  clampParam,
  createRippleDisplacementEvent,
  normalizedViewportToSurface,
} from '../../../../packages/tfl-engine/src/index.js';
import { MUSICAL_FIELD_V1 } from './mapping-profiles.js';

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function finiteAspect(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

export function mapNoteToNormalizedPosition(event, profile = MUSICAL_FIELD_V1) {
  const pitch01 = clamp01(
    (event.note - profile.pitch.minimum) / (profile.pitch.maximum - profile.pitch.minimum),
  );
  const velocity = clamp01(event.velocity);
  const horizontalRange = 1 - profile.transient.horizontalMargin * 2;
  return {
    x: profile.transient.horizontalMargin + pitch01 * horizontalRange,
    y: profile.transient.softAttackY
      + (profile.transient.strongAttackY - profile.transient.softAttackY) * velocity,
  };
}

function boundedVelocity(from, to, dt, maximum) {
  if (!(dt > 0)) return { x: 0, y: 0 };
  let x = (to.x - from.x) / dt;
  let y = (to.y - from.y) / dt;
  const speed = Math.hypot(x, y);
  if (speed > maximum) {
    const scale = maximum / speed;
    x *= scale;
    y *= scale;
  }
  return { x, y };
}

export class MusicalVisualMapper {
  constructor({
    engine,
    baseline,
    profile = MUSICAL_FIELD_V1,
    sensitivity = 1,
    enabled = true,
    aspect = 1,
  }) {
    if (!engine) throw new TypeError('MusicalVisualMapper requires a TFL engine');
    this.engine = engine;
    this.profile = profile;
    this.baseline = Object.fromEntries(
      Object.keys(profile.parameterMappings).map((name) => [name, baseline[name]]),
    );
    if (Object.values(this.baseline).some((value) => !Number.isFinite(value))) {
      throw new TypeError('MusicalVisualMapper requires a complete numeric baseline');
    }
    this.sensitivity = clamp(Number(sensitivity) || 0, 0, 2);
    this.aspect = finiteAspect(aspect);
    this.enabled = false;
    this.lastSurfacePosition = { x: 0, y: 0 };
    this.lastPositionTime = null;
    this.hasPosition = false;
    this.lastParameterPosition = -Infinity;
    this.lastParameterValues = null;
    if (enabled) this.setEnabled(true);
  }

  setAspect(aspect) {
    this.aspect = finiteAspect(aspect);
  }

  configureProfile(active) {
    if (active) {
      this.engine.setMotionWarp(this.profile.interactions.motionWarp);
      this.engine.setActiveDeformation(this.profile.interactions.activeDeformation);
      this.engine.setCoordinateShear(this.profile.interactions.coordinateShear);
      this.engine.setRippleDisplacement(this.profile.interactions.rippleDisplacement);
      this.engine.setMembraneResponse(this.profile.interactions.membraneResponse);
    } else {
      this.engine.setMotionWarp({ enabled: false });
      this.engine.setActiveDeformation({ enabled: false });
      this.engine.setCoordinateShear({ enabled: false });
      this.engine.setRippleDisplacement({ enabled: false });
      this.engine.setMembraneResponse({ enabled: false });
    }
  }

  setEnabled(enabled) {
    const active = enabled === true;
    if (active === this.enabled) return this.enabled;
    this.enabled = active;
    this.engine.clearTransientEvents();
    this.engine.clearSpatialInfluence();
    this.resetInfluenceMotion();
    this.configureProfile(active);
    this.restoreBaseline();
    return this.enabled;
  }

  setSensitivity(value, features = null) {
    this.sensitivity = clamp(Number(value) || 0, 0, 2);
    if (this.sensitivity === 0) {
      this.engine.clearTransientEvents();
      this.engine.clearSpatialInfluence();
      this.resetInfluenceMotion();
    }
    if (this.enabled && features) this.update(features, { forceParameters: true });
    return this.sensitivity;
  }

  emitEvent(event, features) {
    if (!this.enabled || this.sensitivity === 0 || event?.type !== 'note-on') return false;
    const normalized = mapNoteToNormalizedPosition(event, this.profile);
    const origin = normalizedViewportToSurface(normalized.x, normalized.y, this.aspect);
    const pitch01 = clamp01(
      (event.note - this.profile.pitch.minimum)
        / (this.profile.pitch.maximum - this.profile.pitch.minimum),
    );
    const transient = this.profile.transient;
    const velocityResponse = clamp01(event.velocity) ** transient.amplitudeExponent;
    const amplitude = clamp(
      (transient.amplitudeMinimum
        + velocityResponse * (transient.amplitudeMaximum - transient.amplitudeMinimum))
        * this.sensitivity,
      0,
      2,
    );
    const descriptor = createRippleDisplacementEvent({
      origin,
      amplitude,
      wavelength: transient.wavelengthLowPitch
        + (transient.wavelengthHighPitch - transient.wavelengthLowPitch) * pitch01,
      propagationSpeed: transient.propagationMinimum
        + transient.propagationEnergyDelta * clamp01(features?.energy01),
      lifetime: transient.lifetimeMinimum
        + transient.lifetimeSustainDelta * clamp01(features?.sustain01),
      width: transient.width,
      displacementGain: transient.displacementGain,
    });
    return this.engine.emitTransientEvent(descriptor).accepted === true;
  }

  mappedParameters(features) {
    const changes = {};
    for (const [name, mapping] of Object.entries(this.profile.parameterMappings)) {
      const rawFeature = features?.[mapping.feature];
      const feature = rawFeature === null ? 0.5 : clamp01(rawFeature);
      const value = Object.hasOwn(mapping, 'centeredDelta')
        ? this.baseline[name] + (feature - 0.5) * 2 * mapping.centeredDelta * this.sensitivity
        : this.baseline[name] + feature * mapping.delta * this.sensitivity;
      changes[name] = clampParam(name, value);
    }
    return changes;
  }

  applyParameters(features, force = false) {
    const position = Number(features?.position) || 0;
    if (!force && position - this.lastParameterPosition < this.profile.parameterInterval) return;
    const changes = this.mappedParameters(features);
    if (force || !this.lastParameterValues
      || Object.keys(changes).some((name) => changes[name] !== this.lastParameterValues[name])) {
      this.engine.setParameters(changes, {
        source: 'musical-field-v1',
        transition: 'smooth',
        markPreset: false,
      });
      this.lastParameterValues = changes;
    }
    this.lastParameterPosition = position;
  }

  applyInfluence(features, resetVelocity = false) {
    const field = this.profile.influence;
    const hasRegister = features?.register01 !== null
      && Number.isFinite(features?.register01);
    let position = this.lastSurfacePosition;
    if (hasRegister) {
      position = normalizedViewportToSurface(
        clamp01(features.register01),
        field.viewportY,
        this.aspect,
      );
    }

    let velocity = { x: 0, y: 0 };
    if (!resetVelocity && hasRegister && this.hasPosition
      && (position.x !== this.lastSurfacePosition.x || position.y !== this.lastSurfacePosition.y)) {
      velocity = boundedVelocity(
        this.lastSurfacePosition,
        position,
        features.position - this.lastPositionTime,
        field.maximumVelocity,
      );
    }
    if (hasRegister
      && (!this.hasPosition
        || position.x !== this.lastSurfacePosition.x
        || position.y !== this.lastSurfacePosition.y)) {
      this.lastSurfacePosition = position;
      this.lastPositionTime = features.position;
      this.hasPosition = true;
    }

    const meaningful = (features?.soundingPolyphony ?? 0) > 0
      || (features?.density01 ?? 0) > field.activityThreshold;
    const engaged = meaningful && this.sensitivity > 0;
    this.engine.setSpatialInfluence({
      id: 'musical-field-v1',
      position: { ...this.lastSurfacePosition },
      velocity: engaged
        ? { x: velocity.x * this.sensitivity, y: velocity.y * this.sensitivity }
        : { x: 0, y: 0 },
      radius: field.baseRadius
        + (field.radiusMinimumDelta + field.radiusSpanDelta * clamp01(features?.span01))
          * this.sensitivity,
      strength: engaged
        ? (field.strengthMinimumActive
          + (field.strengthMaximum - field.strengthMinimumActive)
            * clamp01(features?.energy01)) * this.sensitivity
        : 0,
      engaged,
      positionValid: this.hasPosition,
    });
  }

  update(features, { forceParameters = false, resetVelocity = false } = {}) {
    if (!this.enabled) return false;
    this.applyInfluence(features, resetVelocity);
    this.applyParameters(features, forceParameters);
    return true;
  }

  resetInfluenceMotion() {
    this.lastPositionTime = null;
    this.hasPosition = false;
    this.lastSurfacePosition = { x: 0, y: 0 };
  }

  restoreBaseline() {
    this.lastParameterPosition = -Infinity;
    this.lastParameterValues = { ...this.baseline };
    this.engine.setParameters({ ...this.baseline }, {
      source: 'musical-field-v1-reset',
      transition: 'smooth',
      markPreset: false,
    });
  }

  seek(features) {
    if (!this.enabled) return;
    this.engine.clearTransientEvents();
    this.resetInfluenceMotion();
    this.update(features, { forceParameters: true, resetVelocity: true });
  }

  loop(features) {
    if (!this.enabled) return;
    this.engine.clearTransientEvents();
    this.resetInfluenceMotion();
    this.update(features, { forceParameters: true, resetVelocity: true });
  }

  stop() {
    this.engine.clearTransientEvents();
    this.engine.clearSpatialInfluence();
    this.resetInfluenceMotion();
    this.restoreBaseline();
  }
}
