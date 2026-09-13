// Browser rendering host for the source-neutral TflEngine controller. This is
// the only public integration seam that accepts canvas elements; no DOM value
// crosses into parameter, clock, influence, event or snapshot APIs.
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
import { canonicalInfluenceToFixed } from './spatial.js';

export function createBrowserRenderHost({ canvas, fallbackCanvas }) {
  if (!canvas || !fallbackCanvas) throw new Error('Browser render host requires GPU and fallback canvases');

  const host = {
    canvas,
    fallbackCanvas,
    backend: 'starting',
    renderer: null,
    stage: null,
    fallback: null,
    lastFallbackReason: '',
    backendChange: null,

    async initialize({ msaa, quality, onProgress = () => {} }) {
      try {
        host.renderer = await createRenderer(canvas, { msaa, onProgress });
        host.backend = backendName(host.renderer);
        host.stage = createFilmStage(host.renderer, quality);
        host.fallback = null;
        host.backendChange = { backend: host.backend, fallback: false, quality, reason: '' };
        return { backend: host.backend, fallback: false };
      } catch (error) {
        console.error(error);
        const reason = `GPU renderer unavailable (${error?.message ?? error}). Canvas2D fallback active.`;
        startFallback(reason, quality);
        return { backend: host.backend, fallback: true, reason };
      }
    },

    render({
      state,
      influence,
      motionWarp,
      activeDeformation,
      coordinateShear,
      rippleDisplacement,
      renderScale,
    }) {
      const aspect = logicalAspect();
      const fixedInfluence = canonicalInfluenceToFixed(
        influence,
        aspect,
        { enabled: activeDeformation?.legacyFixedEnabled !== false },
      );
      try {
        if (host.renderer && host.stage) {
          try { host.renderer.info?.reset?.(); } catch { /* statistics only */ }
          const fit = fitRenderer(host.renderer, canvas, renderScale);
          const fittedAspect = fit.cssW / Math.max(1, fit.cssH);
          pushFrameUniforms(host.stage, state, {
            aspect: fittedAspect,
            bufW: fit.bufW,
            bufH: fit.bufH,
            pointer: canonicalInfluenceToFixed(
              influence,
              fittedAspect,
              { enabled: activeDeformation?.legacyFixedEnabled !== false },
            ),
            motionWarp,
            activeDeformation,
            coordinateShear,
            rippleDisplacement,
          });
          host.renderer.render(host.stage.scene, host.stage.camera);
          return { aspect: fittedAspect };
        }
        if (host.fallback) host.fallback.frame(state, state.clocks.animation, fixedInfluence);
      } catch (error) {
        console.error(error);
        if (host.renderer) {
          startFallback(`Render fault (${error?.message ?? error}). Canvas2D fallback active.`, state.quality);
        }
      }
      return { aspect };
    },

    renderCurrentFrame() {
      if (host.renderer && host.stage) host.renderer.render(host.stage.scene, host.stage.camera);
    },

    rebuildQuality(quality) {
      if (!host.stage || !host.renderer || host.stage.quality === quality) return;
      rebuildStageQuality(host, host.renderer, quality);
    },

    resize() {
      host.fallback?.resize();
    },

    captureCanvas() {
      return host.renderer && host.stage ? canvas : host.fallback ? fallbackCanvas : null;
    },

    diagnostics() {
      const ratio = host.renderer?.getPixelRatio?.() ?? null;
      return {
        backend: host.backend,
        bufferWidth: ratio === null ? null : Math.round(canvas.clientWidth * ratio),
        bufferHeight: ratio === null ? null : Math.round((canvas.clientHeight || 1) * ratio),
        ratio,
        stats: rendererStats(host.renderer),
        capabilities: {
          motionWarp: Boolean(host.renderer && host.stage),
          activeDeformation: Boolean(host.renderer && host.stage),
          coordinateShear: Boolean(host.renderer && host.stage),
          rippleDisplacement: Boolean(host.renderer && host.stage),
        },
      };
    },

    consumeBackendChange() {
      const change = host.backendChange;
      host.backendChange = null;
      return change;
    },

    hasGpu() {
      return Boolean(host.renderer && host.stage);
    },

    dispose() {
      try { host.stage?.dispose(); } catch { /* best-effort cleanup */ }
      try { host.renderer?.dispose(); } catch { /* best-effort cleanup */ }
      host.stage = null;
      host.renderer = null;
      host.fallback = null;
    },
  };

  function logicalAspect() {
    const width = Math.max(1, canvas.clientWidth || fallbackCanvas.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, canvas.clientHeight || fallbackCanvas.clientHeight || window.innerHeight || 1);
    return width / height;
  }

  function startFallback(reason, quality) {
    try { host.stage?.dispose(); } catch { /* ignore */ }
    host.renderer = null;
    host.stage = null;
    host.backend = 'Canvas2D fallback';
    host.lastFallbackReason = reason;
    host.fallback = createFallback(fallbackCanvas);
    host.fallback?.resize();
    host.backendChange = {
      backend: host.backend,
      fallback: true,
      quality,
      reason,
    };
  }

  return host;
}
