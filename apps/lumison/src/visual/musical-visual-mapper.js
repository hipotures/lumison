import {
  clampParam,
  createRippleDisplacementEvent,
  normalizedViewportToSurface,
  parameterDefault,
} from '../../../../packages/tfl-engine/src/index.js';
import { MUSICAL_FIELD_V1 } from './mapping-profiles.js';
import { defaultTuning, validateTuning } from './visual-tuning.js';
import { TONAL_TARGETS, TonalTransition } from './tonal-mapping.js';

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
    sensitivity,
    enabled,
    aspect = 1,
  }) {
    if (!engine) throw new TypeError('MusicalVisualMapper requires a TFL engine');
    this.engine = engine;
    this.tuning = defaultTuning();
    this.profile = profile;
    this.tonalTransition = new TonalTransition();
    this.tonalValues = {};
    this.tonalTargetsUsed = new Set();
    this.tonalBaseline = Object.fromEntries(Object.keys(TONAL_TARGETS).map((name) => [name,
      Number.isFinite(baseline[name]) ? baseline[name] : parameterDefault(name),
    ]));
    this.baseline = Object.fromEntries(
      Object.keys(profile.parameterMappings).map((name) => [name, baseline[name]]),
    );
    if (Object.values(this.baseline).some((value) => !Number.isFinite(value))) {
      throw new TypeError('MusicalVisualMapper requires a complete numeric baseline');
    }
    this.sensitivity = clamp(Number(sensitivity ?? this.tuning.master.sensitivity) || 0, 0, 2);
    this.tuning.master.sensitivity = this.sensitivity;
    this.tuning.master.enabled = enabled ?? this.tuning.master.enabled;
    this.aspect = finiteAspect(aspect);
    this.enabled = false;
    this.lastFeatures = null;
    this.smoothedFeatures = null;
    this.lastSurfacePosition = { x: 0, y: 0 };
    this.lastRegisterPosition = { x: 0, y: 0 };
    this.lastPositionTime = null;
    this.hasPosition = false;
    this.lastParameterPosition = -Infinity;
    this.lastParameterValues = null;
    if (this.tuning.master.enabled) this.setEnabled(true);
  }

  setAspect(aspect) {
    this.aspect = finiteAspect(aspect);
  }

  applyTuning(configuration, features = this.lastFeatures) {
    const next = validateTuning(configuration); // Validate completely before any mutation.
    const previous = this.tuning;
    this.tuning = next;
    this.profile = {
      ...MUSICAL_FIELD_V1,
      pitch: { minimum: next.transient.pitchMinimum, maximum: next.transient.pitchMaximum },
      transient: next.transient,
      influence: next.influence,
      interactions: next.interactions,
      parameterInterval: next.temporal.parameterInterval,
      parameterMappings: Object.fromEntries(Object.entries(MUSICAL_FIELD_V1.parameterMappings)
        .map(([key, value]) => [key, { ...value, ...next.parameterMappings[key] }])),
    };
    this.sensitivity = next.master.sensitivity;
    this.setEnabled(next.master.enabled);
    this.configureProfile(this.enabled);
    if (JSON.stringify(previous.transient) !== JSON.stringify(next.transient)
      || !next.master.enabled || this.sensitivity === 0) this.engine.clearTransientEvents();
    const resetVelocity = ['enabled', 'registerPosition', 'registerVelocity', 'viewportY']
      .some((key) => previous.influence[key] !== next.influence[key]);
    if (resetVelocity) this.resetInfluenceMotion();
    if (JSON.stringify(previous.temporal) !== JSON.stringify(next.temporal)) this.smoothedFeatures = null;
    if (this.enabled && features) this.update(features, { forceParameters: true, resetVelocity });
    if (!next.influence.enabled || this.sensitivity === 0) this.engine.clearSpatialInfluence();
    return structuredClone(next);
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
    this.tuning.master.enabled = active;
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
    this.tuning.master.sensitivity = this.sensitivity;
    if (this.sensitivity === 0) {
      this.engine.clearTransientEvents();
      this.engine.clearSpatialInfluence();
      this.resetInfluenceMotion();
    }
    if (this.enabled && features) this.update(features, { forceParameters: true });
    return this.sensitivity;
  }

  emitEvent(event, features) {
    if (!this.enabled || !this.tuning.transient.enabled || this.sensitivity === 0 || event?.type !== 'note-on') return false;
    const normalized = mapNoteToNormalizedPosition(event, this.profile);
    if (!this.tuning.transient.pitchPosition) normalized.x = 0.5;
    if (!this.tuning.transient.velocityPosition) normalized.y = 0.5;
    const origin = normalizedViewportToSurface(normalized.x, normalized.y, this.aspect);
    const pitch01 = clamp01(
      (event.note - this.profile.pitch.minimum)
        / (this.profile.pitch.maximum - this.profile.pitch.minimum),
    );
    const transient = this.profile.transient;
    const velocityResponse = this.tuning.transient.velocityAmplitude
      ? clamp01(event.velocity) ** transient.amplitudeExponent : 0;
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
        + (transient.wavelengthHighPitch - transient.wavelengthLowPitch)
          * (this.tuning.transient.pitchWavelength ? pitch01 : 0),
      propagationSpeed: transient.propagationMinimum
        + transient.propagationEnergyDelta * (this.tuning.transient.energyPropagation ? clamp01(features?.energy01) : 0),
      lifetime: transient.lifetimeMinimum
        + transient.lifetimeSustainDelta * (this.tuning.transient.sustainLifetime ? clamp01(features?.sustain01) : 0),
      width: transient.width,
      displacementGain: transient.displacementGain,
    });
    return this.engine.emitTransientEvent(descriptor).accepted === true;
  }

  mappedParameters(features) {
    const changes = {};
    for (const [name, mapping] of Object.entries(this.profile.parameterMappings)) {
      if (!this.tuning.parameterMappings[name].enabled) {
        changes[name] = this.baseline[name];
        continue;
      }
      const rawFeature = features?.[mapping.feature];
      const feature = rawFeature === null ? 0.5 : clamp01(rawFeature);
      const value = Object.hasOwn(mapping, 'centeredDelta')
        ? this.baseline[name] + (feature - 0.5) * 2 * mapping.centeredDelta * this.sensitivity
        : this.baseline[name] + feature * mapping.delta * this.sensitivity;
      changes[name] = value;
    }
    // Compose before clamping, so filmBase's register and tonic offsets cannot
    // overwrite one another or depend on setter order. Extra targets are touched
    // only after opting in, preserving the original default engine-call trace.
    for (const name of this.tonalTargetsUsed) {
      changes[name] = (changes[name] ?? this.tonalBaseline[name])
        + (this.tonalValues[name] ?? 0) * this.sensitivity;
    }
    for (const name of Object.keys(changes)) changes[name] = clampParam(name, changes[name]);
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
        transition: this.tuning.temporal.parameterSmoothing ? 'smooth' : 'immediate',
        markPreset: false,
      });
      this.lastParameterValues = changes;
    }
    this.lastParameterPosition = position;
  }

  applyInfluence(features, resetVelocity = false) {
    if (!this.tuning.influence.enabled) {
      this.engine.clearSpatialInfluence();
      return;
    }
    const field = this.profile.influence;
    const controls = this.tuning.influence;
    const hasRegister = features?.register01 !== null
      && Number.isFinite(features?.register01);
    let position = this.lastSurfacePosition;
    if (hasRegister || !controls.registerPosition) {
      position = normalizedViewportToSurface(
        controls.registerPosition ? clamp01(features.register01) : 0.5,
        field.viewportY,
        this.aspect,
      );
    }

    let velocity = { x: 0, y: 0 };
    // Velocity follows register independently even when the visible field is centered.
    const registerPosition = hasRegister
      ? normalizedViewportToSurface(clamp01(features.register01), field.viewportY, this.aspect)
      : this.lastRegisterPosition;
    if (controls.registerVelocity && !resetVelocity && hasRegister && this.hasPosition
      && (registerPosition.x !== this.lastRegisterPosition.x || registerPosition.y !== this.lastRegisterPosition.y)) {
      velocity = boundedVelocity(
        this.lastRegisterPosition,
        registerPosition,
        features.position - this.lastPositionTime,
        field.maximumVelocity,
      );
    }
    if ((hasRegister || !controls.registerPosition)
      && (!this.hasPosition
        || registerPosition.x !== this.lastRegisterPosition.x
        || registerPosition.y !== this.lastRegisterPosition.y)) {
      this.lastSurfacePosition = position;
      this.lastRegisterPosition = registerPosition;
      this.lastPositionTime = features.position;
      this.hasPosition = true;
    }

    const meaningful = !controls.activityGate
      || (controls.soundingActivity && (features?.soundingPolyphony ?? 0) > 0)
      || (controls.densityActivity && (features?.density01 ?? 0) > field.activityThreshold);
    const engaged = meaningful && this.sensitivity > 0;
    this.engine.setSpatialInfluence({
      id: 'musical-field-v1',
      position: { ...this.lastSurfacePosition },
      velocity: engaged
        ? { x: velocity.x * this.sensitivity, y: velocity.y * this.sensitivity }
        : { x: 0, y: 0 },
      radius: field.baseRadius
        + (field.radiusMinimumDelta + field.radiusSpanDelta * (controls.spanRadius ? clamp01(features?.span01) : 0))
          * this.sensitivity,
      strength: engaged
        ? (field.strengthMinimumActive
          + (field.strengthMaximum - field.strengthMinimumActive)
            * (controls.energyStrength ? clamp01(features?.energy01) : 0)) * this.sensitivity
        : 0,
      engaged,
      positionValid: this.hasPosition,
    });
  }

  update(features, { forceParameters = false, resetVelocity = false, seekTonality = false } = {}) {
    this.lastFeatures = features;
    if (!this.enabled) return false;
    this.tonalValues = this.tonalTransition.update(this.tuning.harmony, features?.harmony?.key,
      Number(features?.position) || 0, { seek: seekTonality });
    for (const name of Object.keys(this.tonalValues)) this.tonalTargetsUsed.add(name);
    const temporal = this.tuning.temporal;
    if (temporal.enabled && temporal.responseSeconds > 0) {
      const previous = this.smoothedFeatures;
      const dt = features.position - (previous?.position ?? features.position);
      const amount = previous && dt >= 0 && !resetVelocity ? 1 - Math.exp(-dt / temporal.responseSeconds) : 1;
      const smooth = { ...features };
      for (const key of ['energy01', 'density01', 'register01', 'span01', 'pitchMotion01']) {
        if (Number.isFinite(features[key]) && Number.isFinite(previous?.[key])) smooth[key] = previous[key] + (features[key] - previous[key]) * amount;
      }
      this.smoothedFeatures = smooth;
      features = smooth;
    } else this.smoothedFeatures = null;
    this.applyInfluence(features, resetVelocity);
    this.applyParameters(features, forceParameters);
    return true;
  }

  resetInfluenceMotion() {
    this.smoothedFeatures = null;
    this.lastPositionTime = null;
    this.hasPosition = false;
    this.lastSurfacePosition = { x: 0, y: 0 };
    this.lastRegisterPosition = { x: 0, y: 0 };
  }

  restoreBaseline() {
    this.tonalTransition.reset();
    this.tonalValues = {};
    this.lastParameterPosition = -Infinity;
    const baseline = { ...this.baseline };
    for (const name of this.tonalTargetsUsed) baseline[name] = this.tonalBaseline[name];
    this.lastParameterValues = baseline;
    this.engine.setParameters(baseline, {
      source: 'musical-field-v1-reset',
      transition: this.tuning.temporal.parameterSmoothing ? 'smooth' : 'immediate',
      markPreset: false,
    });
  }

  seek(features) {
    if (!this.enabled) return;
    this.engine.clearTransientEvents();
    this.resetInfluenceMotion();
    this.update(features, { forceParameters: true, resetVelocity: true, seekTonality: true });
  }

  loop(features) {
    if (!this.enabled) return;
    this.engine.clearTransientEvents();
    this.resetInfluenceMotion();
    this.update(features, { forceParameters: true, resetVelocity: true, seekTonality: true });
  }

  stop() {
    this.engine.clearTransientEvents();
    this.engine.clearSpatialInfluence();
    this.resetInfluenceMotion();
    this.restoreBaseline();
  }
}
