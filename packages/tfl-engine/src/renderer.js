// Three.js rendering layer: WebGPURenderer lifecycle, fullscreen quad,
// material rebuilds on quality change, resolution management, backend report.
import {
  WebGPURenderer, Scene, OrthographicCamera, PlaneGeometry, Mesh,
  NodeMaterial, NoToneMapping, Vector2,
} from 'three/webgpu';
import { createFilmMaterial, updateUniforms } from './film.js';
import { DIAG_MODES } from './state.js';

export function backendName(renderer) {
  try {
    const b = renderer.backend;
    if (!b) return 'unknown';
    if (b.isWebGPUBackend) return 'WebGPU';
    const name = (b.constructor && b.constructor.name) || '';
    if (/webgpu/i.test(name)) return 'WebGPU';
    if (/webgl/i.test(name)) return 'WebGL2';
    return name || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function createRenderer(canvas, opts) {
  const onProgress = opts.onProgress ?? (() => {});
  // Attempt 1: default path (WebGPU preferred, automatic WebGL2 fallback).
  // NOTE: navigator.gpu.requestAdapter() may pend forever on some systems
  // when no adapter exists, so every attempt is raced against a timeout.
  // A late-resolving attempt is disposed so two renderers never share the
  // canvas context.
  let lateAttempt = null;
  try {
    onProgress('Requesting GPU backend…');
    const renderer = new WebGPURenderer({
      canvas,
      antialias: (opts.msaa ?? 0) > 0,
      powerPreference: 'high-performance',
    });
    renderer.toneMapping = NoToneMapping;
    lateAttempt = renderer.init().then(() => renderer);
    const ready = await withTimeout(lateAttempt, 12000, 'GPU init timed out');
    lateAttempt = null;
    return ready;
  } catch (err1) {
    if (lateAttempt) {
      lateAttempt.then((r) => { try { r.dispose(); } catch { /* ignore */ } }).catch(() => {});
      lateAttempt = null;
    }
    // Attempt 2: skip WebGPU negotiation entirely, force the WebGL2 backend.
    onProgress('Trying forced WebGL2 backend…');
    try {
      const renderer = new WebGPURenderer({
        canvas,
        antialias: (opts.msaa ?? 0) > 0,
        forceWebGL: true,
        powerPreference: 'high-performance',
      });
      renderer.toneMapping = NoToneMapping;
      await withTimeout(renderer.init(), 12000, 'WebGL2 init timed out');
      return renderer;
    } catch (err2) {
      throw new Error(
        `WebGPU path: ${err1?.message ?? err1}; WebGL2 path: ${err2?.message ?? err2}`,
      );
    }
  }
}

function withTimeout(promise, ms, message) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createFilmStage(renderer, quality) {
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const built = createFilmMaterial(quality);
  const material = new NodeMaterial();
  material.fragmentNode = built.fragmentNode;
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    scene, camera, mesh, material,
    uniforms: built.uniforms,
    quality,
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

export function rebuildStageQuality(stageHolder, renderer, quality) {
  stageHolder.stage.dispose();
  stageHolder.stage = createFilmStage(renderer, quality);
}

export function rendererStats(renderer) {
  try {
    const info = renderer.info;
    if (!info) return null;
    return {
      calls: info.render?.calls ?? info.calls ?? null,
      triangles: info.render?.triangles ?? info.triangles ?? null,
      geometries: info.memory?.geometries ?? info.geometries ?? null,
      textures: info.memory?.textures ?? info.textures ?? null,
    };
  } catch {
    return null;
  }
}

// Size the drawing buffer from CSS size x effective pixel ratio.
// Only touches the renderer when something actually changed.
const scratch = new Vector2();
const fitCache = new WeakMap();
export function fitRenderer(renderer, canvas, renderScale, maxRatio = 2) {
  const w = Math.max(2, Math.floor(canvas.clientWidth || window.innerWidth));
  const h = Math.max(2, Math.floor(canvas.clientHeight || window.innerHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, maxRatio);
  const ratio = Math.max(0.2, dpr * renderScale);
  let ud = fitCache.get(renderer);
  if (!ud) { ud = {}; fitCache.set(renderer, ud); }
  if (typeof renderer.getSize === 'function') renderer.getSize(scratch);
  if (ud.fw !== w || ud.fh !== h || ud.fr !== ratio) {
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    ud.fw = w; ud.fh = h; ud.fr = ratio;
  }
  return {
    cssW: w, cssH: h, ratio,
    bufW: Math.round(w * ratio), bufH: Math.round(h * ratio),
  };
}

export function pushFrameUniforms(stage, state, env) {
  updateUniforms(stage.uniforms, state.current, {
    // Fixed compatibility deliberately keeps the single historical material
    // clock. Canonical flow/lighting clocks remain observable but do not alter
    // Phase 1 shader phase behavior.
    time: state.clocks.animation,
    aspect: env.aspect,
    width: env.bufW,
    height: env.bufH,
    pointer: env.pointer,
    motionWarp: env.motionWarp,
    activeDeformation: env.activeDeformation,
    coordinateShear: env.coordinateShear,
    rippleDisplacement: env.rippleDisplacement,
    mode: DIAG_MODES.indexOf(state.diag),
  });
}
