// Phase 1 engine facade. It preserves the Fixed renderer and state semantics
// while keeping DOM controls, input events, persistence and presentation in
// TFL Lab. The numeric interaction shape is a compatibility seam for Phase 2.
import {
  applySnapshot,
  createState,
  factoryResetState,
  PARAM_DEFS,
  QUALITY_LEVELS,
  DIAG_MODES,
  resetParameter as resetStateParameter,
  setParameter as setStateParameter,
  setParameterLock as setStateParameterLock,
  smoothState,
  snapshot,
} from './state.js';
import { applyPreset, mutate, randomize, resetParameters } from './presets.js';
import {
  backendName,
  createFilmStage,
  createRenderer,
  fitRenderer,
  pushFrameUniforms,
  rebuildStageQuality,
  rendererStats,
} from './renderer.js';
import { createFallback } from './fallback.js';
import { adaptiveTick, createAdaptive, createPerf, perfTick } from './perf.js';
import { sampleSurface } from './probe.js';

export class TflEngine {
  constructor({ canvas, fallbackCanvas, state = createState(), onBackendChange = null }) {
    if (!canvas || !fallbackCanvas) throw new Error('TflEngine requires GPU and fallback canvases');
    this.canvas = canvas;
    this.fallbackCanvas = fallbackCanvas;
    this.state = state;
    this.onBackendChange = onBackendChange;
    this.backend = 'starting';
    this.renderer = null;
    this.stage = null;
    this.fallback = null;
    this.perf = createPerf();
    this.adaptive = createAdaptive();
    this.manualQuality = state.quality;
    this.manualScale = state.target.renderScale;
    this.effectiveQuality = state.quality;
    this.effectiveScale = state.target.renderScale;
    this.lastFallbackReason = '';
  }

  async initialize({ onProgress = () => {} } = {}) {
    try {
      const renderer = await createRenderer(this.canvas, {
        msaa: this.state.msaa,
        onProgress,
      });
      this.renderer = renderer;
      this.backend = backendName(renderer);
      this.stage = createFilmStage(renderer, this.effectiveQuality);
      this.fallback = null;
      this.#notifyBackend();
      return { backend: this.backend, fallback: false };
    } catch (error) {
      console.error(error);
      const reason = `GPU renderer unavailable (${error?.message ?? error}). Canvas2D fallback active.`;
      this.#startFallback(reason);
      return { backend: this.backend, fallback: true, reason };
    }
  }

  dispose() {
    try { this.stage?.dispose(); } catch { /* best-effort cleanup */ }
    try { this.renderer?.dispose(); } catch { /* best-effort cleanup */ }
    this.stage = null;
    this.renderer = null;
    this.fallback = null;
  }

  setParameter(name, value) {
    if (!setStateParameter(this.state, name, value)) return false;
    if (name === 'renderScale') {
      this.manualScale = this.state.target.renderScale;
      this.effectiveScale = this.state.target.renderScale;
      this.adaptive.active = false;
    }
    return true;
  }

  resetParameter(name) {
    if (!resetStateParameter(this.state, name)) return false;
    if (name === 'renderScale') {
      this.manualScale = this.state.target.renderScale;
      this.effectiveScale = this.state.target.renderScale;
    }
    return true;
  }

  setParameterLock(name, locked) {
    if (!setStateParameterLock(this.state, name, locked)) return false;
    if (name === 'renderScale' && locked) {
      this.effectiveScale = this.state.target.renderScale;
      this.adaptive.active = false;
    }
    return true;
  }

  applyPreset(name) {
    return applyPreset(this.state, name);
  }

  mutate(random = Math.random) {
    mutate(this.state, random);
  }

  randomize(random = Math.random) {
    randomize(this.state, random);
  }

  reset() {
    resetParameters(this.state);
    this.manualQuality = this.state.quality;
    this.effectiveQuality = this.state.quality;
    this.manualScale = this.state.target.renderScale;
    this.effectiveScale = this.state.target.renderScale;
    this.adaptive.active = false;
    this.#rebuildQuality();
  }

  factoryReset() {
    factoryResetState(this.state);
    applyPreset(this.state, 'Soap Film');
    this.state.current = { ...this.state.target };
    this.manualQuality = this.state.quality;
    this.effectiveQuality = this.state.quality;
    this.manualScale = this.state.target.renderScale;
    this.effectiveScale = this.state.target.renderScale;
    this.adaptive = createAdaptive();
    this.#rebuildQuality();
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
      this.effectiveScale = this.manualScale;
      this.state.target.renderScale = this.manualScale;
      this.#rebuildQuality();
    }
  }

  setTargetFps(value) {
    if (![30, 60, 90, 120].includes(value)) return false;
    this.state.targetFps = value;
    this.adaptive.active = false;
    return true;
  }

  setDiagnosticView(view) {
    if (!DIAG_MODES.includes(view)) return false;
    this.state.diag = view;
    return true;
  }

  togglePaused() {
    this.state.paused = !this.state.paused;
    return this.state.paused;
  }

  createSnapshot() {
    return snapshot(this.state);
  }

  restoreSnapshot(saved, options = {}) {
    if (!applySnapshot(this.state, saved, options)) return false;
    this.state.current = { ...this.state.target };
    this.manualQuality = this.state.quality;
    this.effectiveQuality = this.state.quality;
    this.manualScale = this.state.target.renderScale;
    this.effectiveScale = this.state.target.renderScale;
    this.adaptive.active = false;
    this.#rebuildQuality();
    return true;
  }

  renderFrame(dt, interaction, now, displayHz = 60) {
    smoothState(this.state, dt);
    if (!this.state.paused) this.state.simTime += dt * this.state.current.temporal;
    perfTick(this.perf, dt * 1000);

    if (this.renderer && this.state.adaptive) {
      const action = adaptiveTick(this.adaptive, this.perf.fps, now, {
        enabled: true,
        targetFps: Math.min(this.state.targetFps, displayHz),
        manualQuality: this.manualQuality,
        manualScale: this.manualScale,
      });
      if (action) {
        if (action.quality !== this.effectiveQuality) {
          this.effectiveQuality = action.quality;
          this.#rebuildQuality();
        }
        if (!this.state.locks?.renderScale) this.effectiveScale = action.scale;
      }
    } else if (!this.state.adaptive) {
      this.adaptive.active = false;
    }

    try {
      if (this.renderer && this.stage) {
        try { this.renderer.info?.reset?.(); } catch { /* statistics only */ }
        const renderScale = this.state.adaptive
          ? this.effectiveScale
          : this.state.current.renderScale;
        const fit = fitRenderer(this.renderer, this.canvas, renderScale);
        pushFrameUniforms(this.stage, this.state, {
          aspect: fit.cssW / Math.max(1, fit.cssH),
          bufW: fit.bufW,
          bufH: fit.bufH,
          pointer: interaction,
        });
        this.renderer.render(this.stage.scene, this.stage.camera);
      } else if (this.fallback) {
        this.fallback.frame(this.state, this.state.simTime, interaction);
      }
    } catch (error) {
      console.error(error);
      if (this.renderer) {
        this.#startFallback(`Render fault (${error?.message ?? error}). Canvas2D fallback active.`);
      }
    }
  }

  renderCurrentFrame() {
    if (this.renderer && this.stage) this.renderer.render(this.stage.scene, this.stage.camera);
  }

  sampleSurface(interaction, minInterval = 70) {
    return sampleSurface(interaction, this.state.current, this.state.simTime, minInterval);
  }

  resizeFallback() {
    this.fallback?.resize();
  }

  captureCanvas() {
    return this.renderer && this.stage ? this.canvas : this.fallback ? this.fallbackCanvas : null;
  }

  diagnostics(displayHz = 60) {
    const ratio = this.renderer?.getPixelRatio?.() ?? null;
    const stats = rendererStats(this.renderer);
    return {
      backend: this.backend,
      fps: this.perf.fps,
      frameMs: this.perf.frameMs,
      bufferWidth: ratio === null ? null : Math.round(this.canvas.clientWidth * ratio),
      bufferHeight: ratio === null ? null : Math.round((this.canvas.clientHeight || 1) * ratio),
      ratio,
      effectiveScale: this.state.adaptive ? this.effectiveScale : this.state.target.renderScale,
      displayHz,
      effectiveQuality: this.renderer ? this.effectiveQuality : null,
      adaptiveAction: this.adaptive.lastAction,
      stats,
    };
  }

  #rebuildQuality() {
    if (!this.stage || !this.renderer || this.stage.quality === this.effectiveQuality) return;
    rebuildStageQuality(this, this.renderer, this.effectiveQuality);
  }

  #startFallback(reason) {
    try { this.stage?.dispose(); } catch { /* ignore */ }
    this.renderer = null;
    this.stage = null;
    this.backend = 'Canvas2D fallback';
    this.lastFallbackReason = reason;
    this.fallback = createFallback(this.fallbackCanvas);
    this.fallback?.resize();
    this.#notifyBackend(reason);
  }

  #notifyBackend(reason = '') {
    this.onBackendChange?.({
      backend: this.backend,
      fallback: this.backend === 'Canvas2D fallback',
      quality: this.effectiveQuality,
      reason,
    });
  }
}

export function parameterDefault(name) {
  return PARAM_DEFS[name]?.[3];
}
