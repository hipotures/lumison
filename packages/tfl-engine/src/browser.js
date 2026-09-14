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
  normalizeRequestedBackend,
} from './renderer.js';
import { createFallback } from './fallback.js';

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
    switching: false,
    msaa: 0,
    lastFrame: null,

    async switchBackend(requested, { msaa, quality }) {
      const backend = normalizeRequestedBackend(requested);
      if (backend === 'auto') throw new Error('Choose WebGPU or WebGL2');
      if (host.switching) throw new Error('Backend switch already in progress');
      if (backend === host.backend && msaa === host.msaa && host.hasGpu()) return canvas;
      host.switching = true;
      let renderer;
      let stage;
      try {
        const replacementCanvas = canvas.cloneNode(false);
        replacementCanvas.hidden = false;
        renderer = await createRenderer(replacementCanvas, { msaa, backend });
        // Settings can change while initialization/compilation is pending.
        do {
          stage?.dispose();
          stage = createFilmStage(renderer, host.stage?.quality ?? quality);
          await renderer.compileAsync(stage.scene, stage.camera);
        } while (stage.quality !== (host.stage?.quality ?? quality));
        if (host.lastFrame) {
          const fit = fitRenderer(renderer, replacementCanvas, host.lastFrame.renderScale);
          pushFrameUniforms(stage, host.lastFrame.state, {
            ...host.lastFrame,
            aspect: fit.cssW / Math.max(1, fit.cssH),
            bufW: fit.bufW,
            bufH: fit.bufH,
          });
        }
        // Validate the reconstructed stage before touching the working host.
        renderer.render(stage.scene, stage.camera);
        const oldRenderer = host.renderer;
        const oldStage = host.stage;
        canvas.replaceWith(replacementCanvas);
        canvas = replacementCanvas;
        host.canvas = canvas;
        host.renderer = renderer;
        host.stage = stage;
        host.backend = backend;
        host.msaa = msaa;
        host.fallback = null;
        host.lastFallbackReason = '';
        fallbackCanvas.hidden = true;
        host.backendChange = { backend, fallback: false, quality: stage.quality, reason: '' };
        try { oldStage?.dispose(); } catch { /* best-effort cleanup */ }
        try { oldRenderer?.dispose(); } catch { /* best-effort cleanup */ }
        return canvas;
      } catch (error) {
        try { stage?.dispose(); } catch { /* best-effort cleanup */ }
        try { renderer?.dispose(); } catch { /* best-effort cleanup */ }
        throw error;
      } finally {
        host.switching = false;
      }
    },

    async initialize({ msaa, quality, onProgress = () => {} }) {
      try {
        host.renderer = await createRenderer(canvas, { msaa, onProgress });
        host.msaa = msaa;
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
      motionWarp,
      activeDeformation,
      coordinateShear,
      rippleDisplacement,
      membraneResponse,
      normalEvaluation,
      renderScale,
    }) {
      host.lastFrame = {
        state, motionWarp, activeDeformation, coordinateShear,
        rippleDisplacement, membraneResponse, normalEvaluation, renderScale,
      };
      const aspect = logicalAspect();
      try {
        if (host.renderer && host.stage) {
          try { host.renderer.info?.reset?.(); } catch { /* statistics only */ }
          const fit = fitRenderer(host.renderer, canvas, renderScale);
          const fittedAspect = fit.cssW / Math.max(1, fit.cssH);
          pushFrameUniforms(host.stage, state, {
            aspect: fittedAspect,
            bufW: fit.bufW,
            bufH: fit.bufH,
            motionWarp,
            activeDeformation,
            coordinateShear,
            rippleDisplacement,
            membraneResponse,
            normalEvaluation,
          });
          host.renderer.render(host.stage.scene, host.stage.camera);
          return { aspect: fittedAspect };
        }
        if (host.fallback) host.fallback.frame(state, state.clocks.animation);
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
          membraneResponse: Boolean(host.renderer && host.stage),
          displacedGeometryNormals: Boolean(host.renderer && host.stage),
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
