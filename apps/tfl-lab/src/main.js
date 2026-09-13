// TFL Lab shell for the Fixed compatibility baseline. Browser input, UI,
// persistence and presentation stay here; rendering and visual state use the
// TFL Engine facade.
import { createState, DIAG_MODES, TflEngine } from '../../../packages/tfl-engine/src/index.js';
import { createPointer } from './input.js';
import { buildUI } from './ui.js';
import { copyText, downloadBlob, toast, toggleFullscreen } from './util.js';
import {
  addLabState, applyLabSnapshot, clearLabState, loadLabSnapshot,
  resetLabUiState, saveLabState, snapshotLab,
} from './persistence.js';

const bootMsg = (text) => {
  const message = document.getElementById('bootMsg');
  if (message) message.textContent = text;
};

async function measurePresentationHz(sampleCount = 24) {
  if (document.hidden || typeof requestAnimationFrame !== 'function') return 60;
  return new Promise((resolve) => {
    const deltas = [];
    let last = 0;
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
    };
    const timeout = setTimeout(() => finish(60), 1600);
    const sample = (time) => {
      if (finished) return;
      if (last > 0) {
        const delta = time - last;
        if (delta > 2 && delta < 80) deltas.push(delta);
      }
      last = time;
      if (deltas.length >= sampleCount) {
        clearTimeout(timeout);
        const sorted = [...deltas].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const raw = 1000 / Math.max(1, median);
        const standards = [30, 50, 60, 75, 90, 100, 120, 144, 165, 180, 200, 240, 360];
        let nearest = standards[0];
        for (const hz of standards) {
          if (Math.abs(hz - raw) < Math.abs(nearest - raw)) nearest = hz;
        }
        finish(Math.abs(nearest - raw) / nearest < 0.08 ? nearest : Math.round(raw));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

function setStatus(html, ok = false) {
  const bar = document.getElementById('statusbar');
  if (!bar) return;
  bar.hidden = false;
  bar.innerHTML = html;
  bar.classList.toggle('ok', ok);
}

async function boot() {
  const reduceMotion = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = addLabState(createState({ reduceMotion }));
  const canvas = document.getElementById('stage');
  const fallbackCanvas = document.getElementById('fallback2d');
  const panel = document.getElementById('panel');
  const fab = document.getElementById('panelFab');
  const probeTip = document.getElementById('probeTip');
  const app = {
    ui: null,
    pointer: null,
    displayHz: 60,
    lastFrame: performance.now(),
    diagnosticTimer: 0,
    probeTimer: 0,
    persistTimer: 0,
  };

  const engine = new TflEngine({
    canvas,
    fallbackCanvas,
    state,
    onBackendChange: ({ backend, fallback, quality, reason }) => {
      canvas.hidden = fallback;
      fallbackCanvas.hidden = !fallback;
      if (fallback) {
        setStatus(`${reason}<br>Backend: <b>Canvas2D fallback</b> — controls remain live.`);
      } else {
        setStatus(`Backend: <b>${backend}</b> · quality ${quality}`, true);
        setTimeout(() => {
          const bar = document.getElementById('statusbar');
          if (bar && engine.backend !== 'Canvas2D fallback') bar.hidden = true;
        }, 5000);
      }
    },
  });

  const saved = loadLabSnapshot();
  if (!saved || !applyLabSnapshot(engine, state, saved)) {
    engine.applyPreset('Soap Film');
    state.current = { ...state.target };
  }

  const persistSoon = () => {
    clearTimeout(app.persistTimer);
    app.persistTimer = setTimeout(() => saveLabState(engine, state), 600);
  };

  function applyPanelVisibility() {
    panel.classList.toggle('hidden-panel', !state.panelOpen);
    fab.hidden = state.panelOpen;
  }

  function captureFrame() {
    try {
      engine.renderCurrentFrame();
      const captureCanvas = engine.captureCanvas();
      if (!captureCanvas) return;
      captureCanvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `thin-film-${Date.now()}.png`);
        else toast('Capture failed (empty frame)');
      }, 'image/png');
    } catch {
      toast('Capture failed');
    }
  }

  function updateProbe(force = false) {
    if (!state.probe || !probeTip) {
      if (probeTip) probeTip.hidden = true;
      return;
    }
    let sample;
    try {
      sample = engine.sampleSurface(app.pointer, force ? 0 : 55);
    } catch (error) {
      console.warn('Surface probe update failed:', error);
      sample = null;
    }
    if (sample === 'throttled') return;
    if (!sample) {
      probeTip.hidden = true;
      return;
    }
    if (sample.error) {
      probeTip.textContent = `probe error: ${sample.error}`;
    } else {
      const [nx, ny, nz] = sample.normal;
      probeTip.innerHTML =
        `film <b>${sample.thicknessNm.toFixed(0)} nm</b> (${(sample.thickness01 * 100).toFixed(0)}%)\n` +
        `interf <b>${sample.interference.toFixed(2)}</b>  flow <b>${sample.flow.toFixed(2)}</b>\n` +
        `normal <b>${nx.toFixed(2)}, ${ny.toFixed(2)}, ${nz.toFixed(2)}</b>`;
    }
    probeTip.hidden = false;
    const px = Math.min(window.innerWidth - 210, (sample.px ?? 0) + 18);
    const py = Math.min(window.innerHeight - 94, (sample.py ?? 0) + 16);
    probeTip.style.left = `${Math.max(8, px)}px`;
    probeTip.style.top = `${Math.max(8, py)}px`;
  }

  function updateDiagnostics() {
    if (!app.ui) return;
    const diagnostic = engine.diagnostics(app.displayHz);
    const statistics = diagnostic.stats;
    const lines = [
      `backend  <b>${diagnostic.backend}</b>`,
      `fps      <b>${diagnostic.fps.toFixed(1)}</b>  frame <b>${diagnostic.frameMs.toFixed(2)} ms</b>`,
      `buffer   ${diagnostic.bufferWidth === null ? 'n/a (2d)' : `${diagnostic.bufferWidth}×${diagnostic.bufferHeight} px`}  ratio <b>${diagnostic.ratio === null ? '—' : diagnostic.ratio.toFixed(2)}</b>`,
      `dpr      ${(window.devicePixelRatio || 1).toFixed(2)}  scale <b>${diagnostic.effectiveScale.toFixed(2)}</b>`,
      `present  <b>${app.displayHz} Hz</b>${state.adaptive && state.targetFps > app.displayHz ? `  requested ${state.targetFps} fps · adaptive uses ${app.displayHz}` : ''}`,
      `quality  <b>${diagnostic.effectiveQuality ?? '—'}</b>${state.adaptive ? ` (auto scale only · ${diagnostic.adaptiveAction})` : ' (manual)'}`,
      statistics && statistics.calls !== null
        ? `calls    ${statistics.calls}  tris ${statistics.triangles ?? '—'}`
        : null,
      `mode     ${state.diag}${state.paused ? '  ·  PAUSED' : ''}`,
    ].filter(Boolean).join('\n');
    app.ui.setDiag(lines);
  }

  const actions = {
    persistSoon,
    param: (name, value) => { if (engine.setParameter(name, value)) persistSoon(); },
    resetParam: (name) => {
      if (engine.resetParameter(name)) { app.ui?.sync(); persistSoon(); }
    },
    lockParam: (name, locked) => {
      if (engine.setParameterLock(name, locked)) { app.ui?.sync(); persistSoon(); }
    },
    preset: (name) => {
      if (engine.applyPreset(name)) { app.ui?.sync(); persistSoon(); }
    },
    mutate: () => { engine.mutate(); app.ui?.sync(); persistSoon(); },
    randomize: () => { engine.randomize(); app.ui?.sync(); persistSoon(); },
    resetAll: () => {
      engine.reset();
      app.ui?.sync();
      persistSoon();
      toast(Object.keys(state.locks).length
        ? 'Unlocked parameters reset to Soap Film defaults'
        : 'Parameters reset to Soap Film defaults');
    },
    factoryReset: () => {
      clearLabState();
      engine.factoryReset();
      resetLabUiState(state);
      applyPanelVisibility();
      app.ui?.sync();
      saveLabState(engine, state);
      toast('Factory reset complete');
    },
    togglePause: () => { engine.togglePaused(); app.ui?.sync(); persistSoon(); },
    fullscreen: () => { toggleFullscreen(); },
    hidePanel: () => { state.panelOpen = false; applyPanelVisibility(); persistSoon(); },
    showPanel: () => { state.panelOpen = true; applyPanelVisibility(); persistSoon(); },
    quality: (quality) => {
      if (engine.setQuality(quality)) { app.ui?.sync(); persistSoon(); }
    },
    msaa: (value) => {
      if (state.msaa === value || !engine.setMsaa(value)) return;
      saveLabState(engine, state);
      location.reload();
    },
    adaptive: (enabled) => { engine.setAdaptive(enabled); app.ui?.sync(); persistSoon(); },
    targetFps: (value) => {
      if (engine.setTargetFps(value)) { app.ui?.sync(); persistSoon(); }
    },
    diag: (view) => {
      if (engine.setDiagnosticView(view)) { app.ui?.sync(); persistSoon(); }
    },
    cycleDiag: () => {
      const index = DIAG_MODES.indexOf(state.diag);
      actions.diag(DIAG_MODES[(index + 1) % DIAG_MODES.length]);
    },
    probe: (enabled) => {
      state.probe = enabled;
      if (probeTip) probeTip.hidden = true;
      if (enabled) setTimeout(() => updateProbe(true), 0);
      persistSoon();
    },
    capture: captureFrame,
    exportSettings: async () => {
      const json = JSON.stringify(snapshotLab(engine, state));
      const copied = await copyText(json);
      const dialog = document.getElementById('settingsDialog');
      const text = document.getElementById('settingsText');
      if (text) text.value = json;
      if (!copied && dialog?.showModal) dialog.showModal();
      else toast(copied ? 'Settings copied to clipboard' : 'Settings shown — copy manually');
    },
    importSettings: () => {
      const dialog = document.getElementById('settingsDialog');
      const text = document.getElementById('settingsText');
      if (text) text.value = '';
      text?.setAttribute('placeholder', 'Paste settings JSON here, then press Apply');
      dialog?.showModal?.();
    },
  };

  app.ui = buildUI(panel, state, actions);
  applyPanelVisibility();
  fab.addEventListener('click', () => actions.showPanel());

  const dialog = document.getElementById('settingsDialog');
  document.getElementById('settingsCopy')?.addEventListener('click', async () => {
    const text = document.getElementById('settingsText');
    const copied = await copyText(text.value);
    toast(copied ? 'Copied' : 'Copy failed — select the text manually');
  });
  document.getElementById('settingsApply')?.addEventListener('click', () => {
    const text = document.getElementById('settingsText');
    try {
      const parsed = JSON.parse(text.value);
      if (applyLabSnapshot(engine, state, parsed, { preserveLocks: true })) {
        applyPanelVisibility();
        app.ui?.sync();
        saveLabState(engine, state);
        dialog?.close?.();
        toast('Settings applied');
      } else {
        toast('Invalid settings (version mismatch or bad shape) — live state untouched');
      }
    } catch {
      toast('Malformed JSON — live state untouched');
    }
  });

  app.pointer = createPointer(canvas, [fallbackCanvas]);
  for (const target of [canvas, fallbackCanvas]) {
    target.addEventListener('pointermove', () => { if (state.probe) updateProbe(false); });
    target.addEventListener('pointerdown', () => { if (state.probe) updateProbe(true); });
  }

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (event.code === 'Space') { event.preventDefault(); actions.togglePause(); }
    else if (event.key === 'm' || event.key === 'M') actions.mutate();
    else if (event.key === 'r' || event.key === 'R') actions.randomize();
    else if (event.key === 'f' || event.key === 'F') actions.fullscreen();
    else if (event.key === 'h' || event.key === 'H') {
      (state.panelOpen ? actions.hidePanel : actions.showPanel)();
    } else if (event.key === 'd' || event.key === 'D') actions.cycleDiag();
    else if (event.key === 'Escape' && state.panelOpen) actions.hidePanel();
  });

  const observer = new ResizeObserver(() => engine.resizeFallback());
  observer.observe(document.body);
  window.addEventListener('orientationchange', () => engine.resizeFallback());
  document.addEventListener('fullscreenchange', () => setTimeout(() => engine.resizeFallback(), 60));
  document.addEventListener('visibilitychange', () => { app.lastFrame = performance.now(); });

  bootMsg('Measuring display refresh…');
  app.displayHz = await measurePresentationHz();
  bootMsg('Initializing WebGPU renderer…');
  await engine.initialize({ onProgress: bootMsg });
  document.getElementById('boot')?.classList.add('done');

  const frame = () => {
    const now = performance.now();
    let dt = (now - app.lastFrame) / 1000;
    app.lastFrame = now;
    if (!(dt >= 0) || dt > 0.25) dt = 0.025;
    if (document.hidden) { requestAnimationFrame(frame); return; }

    app.pointer.update(dt);
    engine.renderFrame(dt, app.pointer, now, app.displayHz);
    app.diagnosticTimer += dt;
    if (app.diagnosticTimer > 0.5) {
      app.diagnosticTimer = 0;
      updateDiagnostics();
    }
    if (state.probe) {
      app.probeTimer += dt;
      if (app.probeTimer > 0.08) {
        app.probeTimer = 0;
        updateProbe(false);
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((error) => {
  console.error(error);
  bootMsg(`Startup failed: ${error?.message ?? error}`);
});
