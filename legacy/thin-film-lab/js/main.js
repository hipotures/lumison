// Application lifecycle: boot -> restore -> UI -> GPU -> loop.
// All state transitions converge on the single state object; UI actions,
// keyboard shortcuts, adaptive quality and persistence all write through it.
import {
  createState, smoothState, snapshot, applySnapshot, persist, restore,
  factoryReset, clampParam, PARAM_DEFS, QUALITY_LEVELS, DIAG_MODES,
} from './state.js';
import { applyPreset, mutate, randomize } from './presets.js';
import {
  createRenderer, createFilmStage, rebuildStageQuality, backendName,
  fitRenderer, rendererStats, pushFrameUniforms,
} from './renderer.js';
import { createFallback } from './fallback.js';
import { buildUI } from './ui.js';
import { createPointer, probeSample } from './input.js';
import { createPerf, perfTick, createAdaptive, adaptiveTick } from './perf.js';
import { toast, copyText, downloadBlob, toggleFullscreen } from './util.js';

const bootMsg = (t) => {
  const m = document.getElementById('bootMsg');
  if (m) m.textContent = t;
};
const bootDone = () => {
  document.getElementById('boot')?.classList.add('done');
};
function statusBar(html, ok = false) {
  const bar = document.getElementById('statusbar');
  if (!bar) return;
  bar.hidden = false;
  bar.innerHTML = html;
  bar.classList.toggle('ok', ok);
}

async function boot() {
  const state = createState();
  const restored = restore(state);
  if (restored) {
    // Smoothed values start at restored targets to avoid a long drift.
    state.current = { ...state.target };
  } else {
    // Fresh start: apply the default preset so values match the active label.
    applyPreset(state, 'Soap Film');
    state.current = { ...state.target };
  }

  const canvas = document.getElementById('stage');
  const panel = document.getElementById('panel');
  const fab = document.getElementById('panelFab');
  const probeTip = document.getElementById('probeTip');

  const app = {
    state,
    backend: 'starting',
    renderer: null,
    stage: null,
    fallback: null,
    ui: null,
    ptr: null,
    perf: createPerf(),
    adaptive: createAdaptive(),
    manualQuality: state.quality,
    manualScale: state.target.renderScale,
    effQuality: state.quality,
    effScale: state.target.renderScale,
    lastFrame: performance.now(),
    diagTimer: 0,
    probeTimer: 0,
    persistTimer: 0,
    msaaNote: '',
  };

  const persistSoon = () => {
    clearTimeout(app.persistTimer);
    app.persistTimer = setTimeout(() => persist(state), 600);
  };

  // ------------------------------------------------------------ actions
  const A = {
    persistSoon,
    param: (name, v) => {
      if (state.locks?.[name]) return;
      state.target[name] = clampParam(name, v);
      if (name === 'renderScale') {
        app.manualScale = state.target.renderScale;
        app.effScale = state.target.renderScale;
        app.adaptive.active = false;
      }
      state.preset = 'Custom';
      persistSoon();
    },
    resetParam: (name) => {
      if (state.locks?.[name]) return;
      state.target[name] = PARAM_DEFS[name][3];
      if (name === 'renderScale') {
        app.manualScale = state.target.renderScale;
        app.effScale = state.target.renderScale;
      }
      app.ui?.sync();
      persistSoon();
    },
    lockParam: (name, locked) => {
      if (!PARAM_DEFS[name]) return;
      if (locked) {
        state.locks[name] = true;
        state.current[name] = state.target[name];
      } else {
        delete state.locks[name];
      }
      if (name === 'renderScale' && locked) {
        app.effScale = state.target.renderScale;
        app.adaptive.active = false;
      }
      app.ui?.sync();
      persistSoon();
    },
    preset: (name) => {
      if (applyPreset(state, name)) { app.ui?.sync(); persistSoon(); }
    },
    mutate: () => { mutate(state); app.ui?.sync(); persistSoon(); },
    randomize: () => { randomize(state); app.ui?.sync(); persistSoon(); },
    resetAll: () => {
      const keepQ = state.quality, keepMsaa = state.msaa;
      // Reset every unlocked numeric parameter, then apply the Soap Film
      // material preset. Render settings no longer retain stale random values.
      for (const [name, def] of Object.entries(PARAM_DEFS)) {
        if (!state.locks?.[name]) state.target[name] = def[3];
      }
      applyPreset(state, 'Soap Film');
      state.quality = keepQ; state.msaa = keepMsaa;
      app.manualQuality = keepQ;
      app.effQuality = keepQ;
      app.manualScale = state.target.renderScale;
      app.effScale = state.target.renderScale;
      app.adaptive.active = false;
      rebuildQuality();
      app.ui?.sync();
      persistSoon();
      toast(Object.keys(state.locks).length ? 'Unlocked parameters reset to Soap Film defaults' : 'Parameters reset to Soap Film defaults');
    },
    factoryReset: () => {
      factoryReset(state);
      applyPreset(state, 'Soap Film');
      state.current = { ...state.target };
      app.manualQuality = state.quality;
      app.manualScale = state.target.renderScale;
      app.effQuality = state.quality;
      app.effScale = state.target.renderScale;
      rebuildQuality();
      applyPanelVisibility();
      app.ui?.sync();
      persist(state);
      toast('Factory reset complete');
    },
    togglePause: () => {
      state.paused = !state.paused;
      app.ui?.sync();
      persistSoon();
    },
    fullscreen: () => { toggleFullscreen(); },
    hidePanel: () => {
      state.panelOpen = false;
      applyPanelVisibility();
      persistSoon();
    },
    showPanel: () => {
      state.panelOpen = true;
      applyPanelVisibility();
      persistSoon();
    },
    quality: (q) => {
      if (!QUALITY_LEVELS.includes(q)) return;
      state.quality = q;
      app.manualQuality = q;
      app.effQuality = q;
      rebuildQuality();
      app.ui?.sync();
      persistSoon();
    },
    msaa: (v) => {
      if (state.msaa === v) return;
      state.msaa = v;
      // MSAA is a canvas-context attribute: it only takes effect on a fresh
      // context. Persist and reload for a clean re-initialization instead of
      // attempting fragile in-place context surgery on a live renderer.
      persist(state);
      location.reload();
    },
    adaptive: (v) => {
      state.adaptive = v;
      if (!v) { // return control to the user immediately
        app.effQuality = app.manualQuality;
        app.effScale = app.manualScale;
        state.target.renderScale = app.manualScale;
        rebuildQuality();
        app.ui?.sync();
      }
      persistSoon();
    },
    targetFps: (v) => {
      state.targetFps = v;
      app.adaptive.active = false;
      app.ui?.sync();
      persistSoon();
    },
    diag: (d) => {
      if (!DIAG_MODES.includes(d)) return;
      state.diag = d;
      app.ui?.sync();
      persistSoon();
    },
    cycleDiag: () => {
      const i = DIAG_MODES.indexOf(state.diag);
      A.diag(DIAG_MODES[(i + 1) % DIAG_MODES.length]);
    },
    probe: (v) => {
      state.probe = v;
      if (probeTip) probeTip.hidden = true;
      if (v) setTimeout(() => updateProbe(true), 0);
      persistSoon();
    },
    capture: () => captureFrame(),
    exportSettings: async () => {
      const json = JSON.stringify(snapshot(state));
      const ok = await copyText(json);
      const dlg = document.getElementById('settingsDialog');
      const ta = document.getElementById('settingsText');
      if (ta) ta.value = json;
      if (!ok && dlg?.showModal) dlg.showModal();
      else toast(ok ? 'Settings copied to clipboard' : 'Settings shown — copy manually');
      if (ok && dlg && !dlg.open) { /* keep dialog closed on success */ }
    },
    importSettings: () => {
      const dlg = document.getElementById('settingsDialog');
      const ta = document.getElementById('settingsText');
      if (ta) ta.value = '';
      ta?.setAttribute('placeholder', 'Paste settings JSON here, then press Apply');
      dlg?.showModal?.();
    },
  };

  function applyPanelVisibility() {
    panel.classList.toggle('hidden-panel', !state.panelOpen);
    fab.hidden = state.panelOpen;
  }

  function rebuildQuality() {
    if (!app.stage || !app.renderer) return;
    if (app.stage.quality === app.effQuality) return;
    try {
      rebuildStageQuality(app, app.renderer, app.effQuality);
    } catch (err) {
      statusBar(`Material rebuild failed (${app.effQuality}): ${err?.message ?? err}`);
    }
  }

  function captureFrame() {
    try {
      if (app.renderer && app.stage) {
        app.renderer.render(app.stage.scene, app.stage.camera);
        canvas.toBlob((blob) => {
          if (blob) downloadBlob(blob, `thin-film-${Date.now()}.png`);
          else toast('Capture failed (empty frame)');
        }, 'image/png');
      } else if (app.fallback) {
        const fc = document.getElementById('fallback2d');
        fc.toBlob((blob) => {
          if (blob) downloadBlob(blob, `thin-film-${Date.now()}.png`);
          else toast('Capture failed');
        }, 'image/png');
      }
    } catch {
      toast('Capture failed');
    }
  }

  // ------------------------------------------------------------ GPU init
  async function initGPU() {
    try {
      bootMsg('Initializing WebGPU renderer…');
      const renderer = await createRenderer(canvas, {
        msaa: state.msaa,
        onProgress: (t) => bootMsg(t),
      });
      app.renderer = renderer;
      app.backend = backendName(renderer);
      app.stage = createFilmStage(renderer, app.effQuality);
      canvas.hidden = false;
      document.getElementById('fallback2d').hidden = true;
      statusBar(`Backend: <b>${app.backend}</b> · quality ${app.effQuality}` + (app.msaaNote ? ` · ${app.msaaNote}` : ''), true);
      setTimeout(() => {
        const bar = document.getElementById('statusbar');
        if (bar && app.backend !== 'Canvas2D fallback') bar.hidden = true;
      }, 5000);
    } catch (err) {
      console.error(err);
      startFallback(`GPU renderer unavailable (${err?.message ?? err}). Canvas2D fallback active.`);
    }
  }

  function startFallback(why) {
    try { app.stage?.dispose(); } catch { /* ignore */ }
    app.renderer = null;
    app.stage = null;
    app.backend = 'Canvas2D fallback';
    canvas.hidden = true;
    const fc = document.getElementById('fallback2d');
    fc.hidden = false;
    app.fallback = createFallback(fc);
    app.fallback?.resize();
    statusBar(`${why}<br>Backend: <b>Canvas2D fallback</b> — controls remain live.`);
  }

  // ------------------------------------------------------------ UI shell
  app.ui = buildUI(panel, state, A);
  applyPanelVisibility();
  fab.addEventListener('click', () => A.showPanel());

  // Settings dialog wiring (export fallback + import apply).
  const dlg = document.getElementById('settingsDialog');
  document.getElementById('settingsCopy')?.addEventListener('click', async () => {
    const ta = document.getElementById('settingsText');
    const ok = await copyText(ta.value);
    toast(ok ? 'Copied' : 'Copy failed — select the text manually');
  });
  document.getElementById('settingsApply')?.addEventListener('click', () => {
    const ta = document.getElementById('settingsText');
    try {
      const parsed = JSON.parse(ta.value);
      if (applySnapshot(state, parsed, { preserveLocks: true })) {
        state.current = { ...state.target };
        app.manualQuality = state.quality;
        app.manualScale = state.target.renderScale;
        app.effQuality = state.quality;
        app.effScale = state.target.renderScale;
        rebuildQuality();
        applyPanelVisibility();
        app.ui?.sync();
        persist(state);
        dlg?.close?.();
        toast('Settings applied');
      } else {
        toast('Invalid settings (version mismatch or bad shape) — live state untouched');
      }
    } catch {
      toast('Malformed JSON — live state untouched');
    }
  });

  // ------------------------------------------------------------ input
  const fallbackCanvas = document.getElementById('fallback2d');
  app.ptr = createPointer(canvas, [fallbackCanvas]);
  for (const target of [canvas, fallbackCanvas]) {
    target?.addEventListener('pointermove', () => { if (state.probe) updateProbe(false); });
    target?.addEventListener('pointerdown', () => { if (state.probe) updateProbe(true); });
  }

  // ------------------------------------------------------------ keyboard
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.code === 'Space') { e.preventDefault(); A.togglePause(); }
    else if (e.key === 'm' || e.key === 'M') A.mutate();
    else if (e.key === 'r' || e.key === 'R') A.randomize();
    else if (e.key === 'f' || e.key === 'F') A.fullscreen();
    else if (e.key === 'h' || e.key === 'H') (state.panelOpen ? A.hidePanel() : A.showPanel());
    else if (e.key === 'd' || e.key === 'D') A.cycleDiag();
    else if (e.key === 'Escape' && state.panelOpen) A.hidePanel();
  });

  // ------------------------------------------------------------ resize
  const ro = new ResizeObserver(() => {
    app.fallback?.resize();
    // GPU path re-fits lazily each frame via fitRenderer (change-detected).
  });
  ro.observe(document.body);
  window.addEventListener('orientationchange', () => app.fallback?.resize());
  document.addEventListener('fullscreenchange', () => {
    setTimeout(() => app.fallback?.resize(), 60);
  });
  document.addEventListener('visibilitychange', () => {
    // Clamp the next delta so returning to the tab cannot jump the sim.
    app.lastFrame = performance.now();
  });

  // ------------------------------------------------------------ main loop
  await initGPU();
  bootDone();

  function frame() {
    const now = performance.now();
    let dt = (now - app.lastFrame) / 1000;
    app.lastFrame = now;
    if (!(dt >= 0) || dt > 0.25) dt = 0.025; // clamp pathological stalls
    if (document.hidden) {
      requestAnimationFrame(frame);
      return;
    }

    smoothState(state, dt);
    if (!state.paused) {
      state.simTime += dt * state.current.temporal;
    }
    app.ptr.update(dt);
    perfTick(app.perf, dt * 1000);

    // Adaptive quality (GPU path only).
    if (app.renderer && state.adaptive) {
      const action = adaptiveTick(app.adaptive, app.perf.fps, now, {
        enabled: true,
        targetFps: state.targetFps,
        manualQuality: app.manualQuality,
        manualScale: app.manualScale,
      });
      if (action) {
        let changed = false;
        if (action.quality !== app.effQuality) {
          app.effQuality = action.quality;
          rebuildQuality();
          changed = true;
        }
        if (!state.locks?.renderScale && Math.abs(action.scale - app.effScale) > 1e-6) {
          app.effScale = action.scale;
          changed = true;
        }
        if (changed) app.ui?.sync();
      }
    } else if (!state.adaptive) {
      app.adaptive.active = false;
    }

    try {
      if (app.renderer && app.stage) {
        try { app.renderer.info?.reset?.(); } catch { /* stats only */ }
        const renderScale = state.adaptive ? app.effScale : state.current.renderScale;
        const fit = fitRenderer(app.renderer, canvas, renderScale);
        pushFrameUniforms(app.stage, state, {
          aspect: fit.cssW / Math.max(1, fit.cssH),
          bufW: fit.bufW, bufH: fit.bufH,
          pointer: app.ptr,
        });
        app.renderer.render(app.stage.scene, app.stage.camera);
      } else if (app.fallback) {
        app.fallback.frame(state, state.simTime, app.ptr);
      }
    } catch (err) {
      // A per-frame render fault must not blank the app permanently.
      console.error(err);
      if (app.renderer) startFallback(`Render fault (${err?.message ?? err}). Canvas2D fallback active.`);
    }

    // Diagnostics stay cheap; probe follows the pointer at a useful rate.
    app.diagTimer += dt;
    if (app.diagTimer > 0.5) {
      app.diagTimer = 0;
      updateDiag();
    }
    if (state.probe) {
      app.probeTimer += dt;
      if (app.probeTimer > 0.08) {
        app.probeTimer = 0;
        updateProbe(false);
      }
    }
    requestAnimationFrame(frame);
  }

  function updateDiag() {
    if (!app.ui) return;
    const fit = app.renderer
      ? { bufW: Math.round(canvas.clientWidth * (app.renderer.getPixelRatio?.() ?? 1)), ratio: app.renderer.getPixelRatio?.() ?? 1 }
      : null;
    const st = rendererStats(app.renderer);
    const effScale = state.adaptive ? app.effScale : state.target.renderScale;
    const lines = [
      `backend  <b>${app.backend}</b>`,
      `fps      <b>${app.perf.fps.toFixed(1)}</b>  frame <b>${app.perf.frameMs.toFixed(2)} ms</b>`,
      `buffer   ${fit ? `${fit.bufW}×${Math.round((canvas.clientHeight || 1) * fit.ratio)} px` : 'n/a (2d)'}  ratio <b>${fit ? fit.ratio.toFixed(2) : '—'}</b>`,
      `dpr      ${(window.devicePixelRatio || 1).toFixed(2)}  scale <b>${effScale.toFixed(2)}</b>`,
      `quality  <b>${app.renderer ? app.effQuality : '—'}</b>${state.adaptive ? ` (auto→${state.targetFps}fps ${app.adaptive.lastAction})` : ' (manual)'}`,
      st && (st.calls !== null) ? `calls    ${st.calls}  tris ${st.triangles ?? '—'}` : null,
      `mode     ${state.diag}${state.paused ? '  ·  PAUSED' : ''}`,
    ].filter(Boolean).join('\n');
    app.ui.setDiag(lines);
  }

  function updateProbe(force = false) {
    if (!state.probe || !probeTip) {
      if (probeTip) probeTip.hidden = true;
      return;
    }
    let s;
    try {
      s = probeSample(app.ptr, state.current, state.simTime, force ? 0 : 55);
    } catch (err) {
      console.warn('Surface probe update failed:', err);
      s = null;
    }
    if (s === 'throttled') return;
    if (!s) {
      probeTip.hidden = true;
      return;
    }
    if (s.error) {
      probeTip.textContent = `probe error: ${s.error}`;
    } else {
      const [nx, ny, nz] = s.normal;
      probeTip.innerHTML =
        `film <b>${s.thicknessNm.toFixed(0)} nm</b> (${(s.thickness01 * 100).toFixed(0)}%)\n` +
        `interf <b>${s.interference.toFixed(2)}</b>  flow <b>${s.flow.toFixed(2)}</b>\n` +
        `normal <b>${nx.toFixed(2)}, ${ny.toFixed(2)}, ${nz.toFixed(2)}</b>`;
    }
    probeTip.hidden = false;
    const px = Math.min(window.innerWidth - 210, (s.px ?? 0) + 18);
    const py = Math.min(window.innerHeight - 94, (s.py ?? 0) + 16);
    probeTip.style.left = `${Math.max(8, px)}px`;
    probeTip.style.top = `${Math.max(8, py)}px`;
  }

  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  bootMsg(`Startup failed: ${err?.message ?? err}`);
});
