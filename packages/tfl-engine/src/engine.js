// Source-neutral engine controller. A browser renderer is supplied as an
// adapter, while parameters, clocks, influences, events and replay state stay
// independent of DOM and browser input semantics.
import { advanceClocks } from './clocks.js';
import {
  activeDeformationConfiguration,
  activeDeformationRenderState,
  advanceActiveDeformation,
  configureActiveDeformation,
  createActiveDeformationState,
  restoreActiveDeformationRuntime,
  snapshotActiveDeformationRuntime,
} from './active-deformation.js';
import {
  advanceCoordinateShear,
  configureCoordinateShear,
  coordinateShearConfiguration,
  coordinateShearRenderState,
  createCoordinateShearState,
  restoreCoordinateShearRuntime,
  snapshotCoordinateShearRuntime,
} from './coordinate-shear.js';
import {
  advanceMotionWarp,
  configureMotionWarp,
  createMotionWarpState,
  motionWarpConfiguration,
  motionWarpRenderState,
  restoreMotionWarpRuntime,
  snapshotMotionWarpRuntime,
} from './motion-warp.js';
import { adaptiveTick, createAdaptive, createPerf, perfTick } from './perf.js';
import { applyPreset, mutate, randomize, resetParameters } from './presets.js';
import { sampleSurface } from './probe.js';
import {
  configureRippleDisplacement,
  createRippleDisplacementState,
  RIPPLE_DISPLACEMENT_EVENT_TYPE,
  rippleDisplacementConfiguration,
  rippleDisplacementRenderState,
  validateRippleDisplacementEvent,
} from './ripple-displacement.js';
import {
  applySnapshot,
  createSnapshot,
  createState,
  DIAG_MODES,
  factoryResetState,
  PARAM_DEFS,
  QUALITY_LEVELS,
  resetParameter as resetStateParameter,
  setParameterLock as setStateParameterLock,
  smoothState,
  synchronizeEffectiveParameters,
  TARGET_FPS_OPTIONS,
  transactParameters,
} from './state.js';
import {
  canonicalInfluenceToFixed,
  createSpatialInfluence,
  normalizeAspect,
  sanitizeSpatialInfluence,
} from './spatial.js';
import {
  activeTransientCount,
  addTransientEvent,
  advanceTransientStore,
  createTransientStore,
  restoreTransientStore,
  snapshotTransientStore,
} from './transients.js';

export class TflEngine {
  constructor({
    renderHost = null,
    state = createState(),
    eventCapacity,
    onBackendChange = null,
  } = {}) {
    this.renderHost = renderHost;
    this.state = state;
    this.onBackendChange = onBackendChange;
    this.perf = createPerf();
    this.adaptive = createAdaptive();
    this.manualQuality = state.quality;
    this.effectiveQuality = state.quality;
    this.adaptiveScale = state.requested.renderScale;
    this.influence = createSpatialInfluence();
    this.motionWarp = createMotionWarpState();
    this.activeDeformation = createActiveDeformationState();
    this.coordinateShear = createCoordinateShearState();
    this.rippleDisplacement = createRippleDisplacementState();
    this.events = createTransientStore(eventCapacity);
    this.viewport = { aspect: 1 };
    this.lastProbeTime = -Infinity;
  }

  get backend() {
    return this.renderHost?.backend ?? 'unattached';
  }

  async initialize({ onProgress = () => {} } = {}) {
    if (!this.renderHost) throw new Error('TflEngine has no rendering host');
    const result = await this.renderHost.initialize({
      msaa: this.state.msaa,
      quality: this.effectiveQuality,
      onProgress,
    });
    this.#notifyBackendChange();
    return result;
  }

  dispose() {
    this.renderHost?.dispose();
  }

  setParameters(changes, options = {}) {
    const report = transactParameters(this.state, changes, {
      source: options.source ?? 'external',
      transition: options.transition ?? 'smooth',
      preset: options.preset ?? 'Custom',
      markPreset: options.markPreset ?? true,
    });
    this.#afterParameterTransaction(report);
    return report;
  }

  setParameter(name, value) {
    return this.setParameters({ [name]: value }, { source: 'parameter' });
  }

  resetParameter(name) {
    const report = resetStateParameter(this.state, name);
    this.#afterParameterTransaction(report);
    return report;
  }

  setParameterLock(name, locked) {
    if (!setStateParameterLock(this.state, name, locked)) return false;
    if (name === 'renderScale' && locked) {
      this.adaptiveScale = this.state.target.renderScale;
      this.state.effective.renderScale = this.adaptiveScale;
      this.adaptive.active = false;
    }
    return true;
  }

  applyPreset(name, options = {}) {
    const report = applyPreset(this.state, name, options);
    this.#afterParameterTransaction(report);
    return report;
  }

  mutate(random = null) {
    const report = mutate(this.state, random);
    this.#afterParameterTransaction(report);
    return report;
  }

  randomize(random = null) {
    const report = randomize(this.state, random);
    this.#afterParameterTransaction(report);
    return report;
  }

  reset() {
    const report = resetParameters(this.state);
    this.manualQuality = this.state.quality;
    this.effectiveQuality = this.state.quality;
    this.adaptiveScale = this.state.target.renderScale;
    this.state.effective.renderScale = this.adaptiveScale;
    this.adaptive.active = false;
    this.#rebuildQuality();
    return report;
  }

  factoryReset() {
    factoryResetState(this.state);
    const report = applyPreset(this.state, 'Soap Film', { transition: 'immediate' });
    synchronizeEffectiveParameters(this.state, { renderScale: this.state.target.renderScale });
    this.manualQuality = this.state.quality;
    this.effectiveQuality = this.state.quality;
    this.adaptiveScale = this.state.target.renderScale;
    this.adaptive = createAdaptive();
    this.influence = createSpatialInfluence();
    this.motionWarp = createMotionWarpState();
    this.activeDeformation = createActiveDeformationState();
    this.coordinateShear = createCoordinateShearState();
    this.rippleDisplacement = createRippleDisplacementState();
    this.events = createTransientStore(this.events.capacity);
    this.#rebuildQuality();
    return report;
  }

  setQuality(quality) {
    if (!QUALITY_LEVELS.includes(quality)) return false;
    this.state.quality = quality;
    this.manualQuality = quality;
    this.effectiveQuality = quality;
    this.#rebuildQuality();
    return true;
  }

  setMsaa(msaa) {
    if (![0, 2, 4].includes(msaa)) return false;
    this.state.msaa = msaa;
    return true;
  }

  setAdaptive(enabled) {
    this.state.adaptive = enabled === true;
    if (!this.state.adaptive) {
      this.effectiveQuality = this.manualQuality;
      this.adaptiveScale = this.state.requested.renderScale;
      this.state.effective.renderScale = this.state.current.renderScale;
      this.#rebuildQuality();
    }
  }

  setTargetFps(value) {
    if (!TARGET_FPS_OPTIONS.includes(value)) return false;
    this.state.targetFps = value;
    this.adaptive.active = false;
    return true;
  }

  setDiagnosticView(view) {
    if (!DIAG_MODES.includes(view)) return false;
    this.state.diag = view;
    return true;
  }

  setPaused(paused) {
    this.state.paused = paused === true;
    return this.state.paused;
  }

  togglePaused() {
    return this.setPaused(!this.state.paused);
  }

  setViewport({ aspect } = {}) {
    this.viewport.aspect = normalizeAspect(aspect);
    return { ...this.viewport };
  }

  setSpatialInfluence(candidate) {
    const result = sanitizeSpatialInfluence(candidate);
    if (!result.ok) return { accepted: false, reason: result.reason };
    this.influence = result.value;
    return { accepted: true, influence: cloneInfluence(this.influence) };
  }

  clearSpatialInfluence() {
    this.influence = createSpatialInfluence({
      id: this.influence.id,
      position: this.influence.position,
    });
  }

  setMotionWarp(changes) {
    return configureMotionWarp(this.motionWarp, changes);
  }

  getMotionWarpConfiguration() {
    return motionWarpConfiguration(this.motionWarp);
  }

  setActiveDeformation(changes) {
    return configureActiveDeformation(this.activeDeformation, changes);
  }

  getActiveDeformationConfiguration() {
    return activeDeformationConfiguration(this.activeDeformation);
  }

  setCoordinateShear(changes) {
    return configureCoordinateShear(this.coordinateShear, changes);
  }

  getCoordinateShearConfiguration() {
    return coordinateShearConfiguration(this.coordinateShear);
  }

  setRippleDisplacement(changes) {
    return configureRippleDisplacement(this.rippleDisplacement, changes);
  }

  getRippleDisplacementConfiguration() {
    return rippleDisplacementConfiguration(this.rippleDisplacement);
  }

  emitTransientEvent(event) {
    if (event?.type === RIPPLE_DISPLACEMENT_EVENT_TYPE) {
      const validation = validateRippleDisplacementEvent(event);
      if (!validation.ok) {
        return { accepted: false, reason: validation.reason, slot: null, evicted: null };
      }
      return addTransientEvent(this.events, validation.value);
    }
    return addTransientEvent(this.events, event);
  }

  clearTransientEvents() {
    this.events = createTransientStore(this.events.capacity);
  }

  advance(dt) {
    if (!(typeof dt === 'number' && Number.isFinite(dt)) || dt < 0) return false;
    smoothState(this.state, dt);
    advanceClocks(this.state.clocks, dt, this.state.current, { paused: this.state.paused });
    advanceTransientStore(this.events, dt, { paused: this.state.paused });
    // Continuous response follows explicit application dt even while the
    // animation clocks are paused, matching Fixed's influence-release policy.
    advanceMotionWarp(this.motionWarp, this.influence, dt);
    advanceActiveDeformation(this.activeDeformation, this.influence, dt);
    advanceCoordinateShear(this.coordinateShear, this.influence, dt);
    perfTick(this.perf, dt * 1000);
    const scale = this.state.adaptive
      ? this.adaptiveScale
      : this.state.current.renderScale;
    synchronizeEffectiveParameters(this.state, { renderScale: scale });
    return true;
  }

  render({ now = 0, displayHz = 60 } = {}) {
    if (!this.renderHost) return false;
    if (this.renderHost.hasGpu() && this.state.adaptive) {
      const action = adaptiveTick(this.adaptive, this.perf.fps, now, {
        enabled: true,
        targetFps: Math.min(this.state.targetFps, displayHz),
        manualQuality: this.manualQuality,
        manualScale: this.state.requested.renderScale,
      });
      if (action) {
        if (action.quality !== this.effectiveQuality) {
          this.effectiveQuality = action.quality;
          this.#rebuildQuality();
        }
        if (!this.state.locks?.renderScale) this.adaptiveScale = action.scale;
      }
      this.state.effective.renderScale = this.adaptiveScale;
    } else if (!this.state.adaptive) {
      this.adaptive.active = false;
      this.state.effective.renderScale = this.state.current.renderScale;
    }

    const result = this.renderHost.render({
      state: this.state,
      influence: this.influence,
      motionWarp: motionWarpRenderState(this.motionWarp),
      activeDeformation: activeDeformationRenderState(this.activeDeformation),
      coordinateShear: coordinateShearRenderState(
        this.coordinateShear,
        this.activeDeformation.configuration.radius,
      ),
      rippleDisplacement: rippleDisplacementRenderState(
        this.rippleDisplacement,
        this.events,
      ),
      renderScale: this.state.effective.renderScale,
    });
    if (result?.aspect) this.viewport.aspect = normalizeAspect(result.aspect);
    this.#notifyBackendChange();
    return true;
  }

  renderCurrentFrame() {
    this.renderHost?.renderCurrentFrame();
  }

  createSnapshot({ includeRuntime = false } = {}) {
    const saved = createSnapshot(this.state, { includeRuntime });
    saved.interactions = {
      motionWarp: motionWarpConfiguration(this.motionWarp),
      activeDeformation: activeDeformationConfiguration(this.activeDeformation),
      coordinateShear: coordinateShearConfiguration(this.coordinateShear),
      rippleDisplacement: rippleDisplacementConfiguration(this.rippleDisplacement),
    };
    if (includeRuntime) {
      saved.runtime.influence = cloneInfluence(this.influence);
      saved.runtime.transients = snapshotTransientStore(this.events);
      saved.runtime.viewport = { ...this.viewport };
      saved.runtime.effectiveQuality = this.effectiveQuality;
      saved.runtime.adaptiveScale = this.adaptiveScale;
      saved.runtime.motionWarp = snapshotMotionWarpRuntime(this.motionWarp);
      saved.runtime.activeDeformation = snapshotActiveDeformationRuntime(this.activeDeformation);
      saved.runtime.coordinateShear = snapshotCoordinateShearRuntime(this.coordinateShear);
    }
    return saved;
  }

  restoreSnapshot(saved, options = {}) {
    let restoredEvents = null;
    let restoredInfluence = null;
    let restoredMotionWarp = null;
    let restoredActiveDeformation = null;
    let restoredCoordinateShear = null;
    let restoredRippleDisplacement = null;
    const savedMotionWarp = saved?.interactions?.motionWarp;
    if (savedMotionWarp !== undefined) {
      restoredMotionWarp = createMotionWarpState();
      const motionReport = configureMotionWarp(restoredMotionWarp, savedMotionWarp);
      if (!motionReport.ok || motionReport.accepted.length !== 3) {
        return { ok: false, reason: 'invalid-motion-warp-configuration' };
      }
    }
    const savedActiveDeformation = saved?.interactions?.activeDeformation;
    if (savedActiveDeformation !== undefined) {
      restoredActiveDeformation = createActiveDeformationState();
      const activeReport = configureActiveDeformation(
        restoredActiveDeformation,
        savedActiveDeformation,
      );
      if (!activeReport.ok || activeReport.accepted.length !== 6) {
        return { ok: false, reason: 'invalid-active-deformation-configuration' };
      }
    }
    const savedCoordinateShear = saved?.interactions?.coordinateShear;
    if (savedCoordinateShear !== undefined) {
      restoredCoordinateShear = createCoordinateShearState();
      const shearReport = configureCoordinateShear(
        restoredCoordinateShear,
        savedCoordinateShear,
      );
      if (!shearReport.ok || shearReport.accepted.length !== 2) {
        return { ok: false, reason: 'invalid-coordinate-shear-configuration' };
      }
    }
    const savedRippleDisplacement = saved?.interactions?.rippleDisplacement;
    if (savedRippleDisplacement !== undefined) {
      restoredRippleDisplacement = createRippleDisplacementState();
      const rippleReport = configureRippleDisplacement(
        restoredRippleDisplacement,
        savedRippleDisplacement,
      );
      if (!rippleReport.ok || rippleReport.accepted.length !== 2) {
        return { ok: false, reason: 'invalid-ripple-displacement-configuration' };
      }
    }
    if (options.restoreRuntime) {
      restoredInfluence = sanitizeSpatialInfluence(saved?.runtime?.influence);
      restoredEvents = restoreTransientStore(saved?.runtime?.transients);
      const aspect = saved?.runtime?.viewport?.aspect;
      const adaptiveScale = saved?.runtime?.adaptiveScale;
      if (!restoredInfluence.ok || !restoredEvents
        || !(typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0)
        || !(typeof adaptiveScale === 'number' && Number.isFinite(adaptiveScale)
          && adaptiveScale >= PARAM_DEFS.renderScale[0]
          && adaptiveScale <= PARAM_DEFS.renderScale[1])
        || !QUALITY_LEVELS.includes(saved.runtime?.effectiveQuality)) {
        return { ok: false, reason: 'invalid-engine-runtime' };
      }
      if (saved?.runtime?.motionWarp !== undefined) {
        const target = restoredMotionWarp
          ?? createMotionWarpState(motionWarpConfiguration(this.motionWarp));
        if (!restoreMotionWarpRuntime(target, saved.runtime.motionWarp)) {
          return { ok: false, reason: 'invalid-motion-warp-runtime' };
        }
        restoredMotionWarp = target;
      }
      if (saved?.runtime?.activeDeformation !== undefined) {
        const target = restoredActiveDeformation
          ?? createActiveDeformationState(
            activeDeformationConfiguration(this.activeDeformation),
          );
        if (!restoreActiveDeformationRuntime(target, saved.runtime.activeDeformation)) {
          return { ok: false, reason: 'invalid-active-deformation-runtime' };
        }
        restoredActiveDeformation = target;
      }
      if (saved?.runtime?.coordinateShear !== undefined) {
        const target = restoredCoordinateShear
          ?? createCoordinateShearState(
            coordinateShearConfiguration(this.coordinateShear),
          );
        if (!restoreCoordinateShearRuntime(target, saved.runtime.coordinateShear)) {
          return { ok: false, reason: 'invalid-coordinate-shear-runtime' };
        }
        restoredCoordinateShear = target;
      }
    }
    const result = applySnapshot(this.state, saved, options);
    if (!result.ok) return result;

    this.manualQuality = this.state.quality;
    this.effectiveQuality = options.restoreRuntime
      && QUALITY_LEVELS.includes(saved.runtime?.effectiveQuality)
      ? saved.runtime.effectiveQuality
      : this.state.quality;
    this.adaptive.active = false;
    this.adaptiveScale = options.restoreRuntime
      && typeof saved.runtime?.adaptiveScale === 'number'
      && Number.isFinite(saved.runtime.adaptiveScale)
      ? saved.runtime.adaptiveScale
      : this.state.target.renderScale;
    if (options.restoreRuntime) {
      this.influence = restoredInfluence.value;
      if (restoredEvents) this.events = restoredEvents;
      this.viewport.aspect = normalizeAspect(saved.runtime?.viewport?.aspect);
    }
    if (restoredMotionWarp) this.motionWarp = restoredMotionWarp;
    if (restoredActiveDeformation) this.activeDeformation = restoredActiveDeformation;
    if (restoredCoordinateShear) this.coordinateShear = restoredCoordinateShear;
    if (restoredRippleDisplacement) this.rippleDisplacement = restoredRippleDisplacement;
    this.#rebuildQuality();
    return result;
  }

  sampleSurface({ now = null, minIntervalSeconds = 0 } = {}) {
    if (!this.influence.positionValid) return null;
    if (typeof now === 'number' && Number.isFinite(now) && minIntervalSeconds > 0) {
      if (now - this.lastProbeTime < minIntervalSeconds) return 'throttled';
      this.lastProbeTime = now;
    }
    const fixed = canonicalInfluenceToFixed(this.influence, this.viewport.aspect, {
      enabled: this.activeDeformation.configuration.legacyFixedEnabled,
    });
    const sample = sampleSurface(fixed, this.state.current, this.state.clocks.animation);
    if (!sample || sample === 'throttled') return sample;
    return {
      ...sample,
      position: { ...this.influence.position },
    };
  }

  resize() {
    this.renderHost?.resize();
  }

  captureCanvas() {
    return this.renderHost?.captureCanvas() ?? null;
  }

  diagnostics(displayHz = 60) {
    const rendered = this.renderHost?.diagnostics() ?? {
      backend: 'unattached',
      bufferWidth: null,
      bufferHeight: null,
      ratio: null,
      stats: null,
    };
    const transaction = this.state.lastTransaction;
    return {
      ...rendered,
      fps: this.perf.fps,
      frameMs: this.perf.frameMs,
      displayHz,
      requestedScale: this.state.requested.renderScale,
      targetScale: this.state.target.renderScale,
      currentScale: this.state.current.renderScale,
      effectiveScale: this.state.effective.renderScale,
      requestedQuality: this.manualQuality,
      effectiveQuality: this.renderHost?.hasGpu() ? this.effectiveQuality : null,
      adaptiveAction: this.adaptive.lastAction,
      clocks: { ...this.state.clocks },
      influence: cloneInfluence(this.influence),
      motionWarp: motionWarpRenderState(this.motionWarp),
      activeDeformation: activeDeformationRenderState(this.activeDeformation),
      coordinateShear: coordinateShearRenderState(
        this.coordinateShear,
        this.activeDeformation.configuration.radius,
      ),
      rippleDisplacement: rippleDisplacementRenderState(
        this.rippleDisplacement,
        this.events,
      ),
      transientEventCount: activeTransientCount(this.events),
      transientCapacity: this.events.capacity,
      lockCount: Object.keys(this.state.locks).length,
      lastTransaction: {
        source: transaction.source,
        accepted: transaction.accepted.length,
        skipped: transaction.skipped.length,
        rejected: transaction.rejected.length,
      },
    };
  }

  #afterParameterTransaction(report) {
    if (!report?.accepted?.some((entry) => entry.name === 'renderScale')) return;
    this.adaptiveScale = this.state.target.renderScale;
    this.state.effective.renderScale = this.adaptiveScale;
    this.adaptive.active = false;
  }

  #rebuildQuality() {
    this.renderHost?.rebuildQuality(this.effectiveQuality);
  }

  #notifyBackendChange() {
    const change = this.renderHost?.consumeBackendChange();
    if (change) this.onBackendChange?.(change);
  }
}

export function parameterDefault(name) {
  return PARAM_DEFS[name]?.[3];
}

function cloneInfluence(influence) {
  return {
    ...influence,
    position: { ...influence.position },
    velocity: { ...influence.velocity },
  };
}
