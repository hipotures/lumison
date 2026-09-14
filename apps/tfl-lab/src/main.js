// TFL Lab shell for the Fixed compatibility baseline. Browser input, UI,
// persistence and presentation stay here; rendering and visual state use the
// TFL Engine facade.
import {
  createMembraneWaveEvent,
  createRippleDisplacementEvent,
  createState,
  DIAG_MODES,
  TflEngine,
} from '../../../packages/tfl-engine/src/index.js';
import { createBrowserRenderHost } from '../../../packages/tfl-engine/src/browser.js';
import { isWebGPUAvailable } from '../../../packages/tfl-engine/src/renderer.js';
import { createFpsHistory } from './fps-history.js';
import { createBenchmarkResults, runBenchmark } from './benchmark.js';
import { createPointerAdapter } from './input.js';
import { createSpatialEventTriggerPolicy } from './ripple-trigger.js';
import {
  applyInteractionProfile,
  markInteractionProfileCustom,
  MEMBRANE_WAVE_DRAG_SPACING,
} from './interaction-profiles.js';
import { buildUI } from './ui.js';
import { copyText, downloadBlob, toast, toggleFullscreen } from './util.js';
import {
  applyLabSnapshot, clearLabState, createLabState, loadLabSnapshot,
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
  const state = createState({ reduceMotion });
  const labState = createLabState();
  let canvas = document.getElementById('stage');
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
    rippleTriggers: null,
    membraneTriggers: null,
  };
  const fpsHistory = createFpsHistory();
  const benchmarkResults = createBenchmarkResults();
  let benchmarkController = null;
  let webgpuAvailable = false;

  const renderHost = createBrowserRenderHost({ canvas, fallbackCanvas });
  const engine = new TflEngine({
    renderHost,
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
  if (!saved || !applyLabSnapshot(engine, labState, saved)) {
    engine.applyPreset('Soap Film', { transition: 'immediate' });
  }
  app.rippleTriggers = createSpatialEventTriggerPolicy({
    clickEnabled: labState.rippleOnClick,
    dragEnabled: labState.rippleDuringDrag,
  });
  app.membraneTriggers = createSpatialEventTriggerPolicy({
    clickEnabled: labState.membraneWaveOnPress,
    dragEnabled: labState.membraneWaveDuringDrag,
    spacing: MEMBRANE_WAVE_DRAG_SPACING,
  });

  function configureEventTriggers() {
    app.rippleTriggers.configure({
      clickEnabled: labState.rippleOnClick,
      dragEnabled: labState.rippleDuringDrag,
    });
    app.membraneTriggers.configure({
      clickEnabled: labState.membraneWaveOnPress,
      dragEnabled: labState.membraneWaveDuringDrag,
      spacing: MEMBRANE_WAVE_DRAG_SPACING,
    });
  }

  const persistSoon = () => {
    clearTimeout(app.persistTimer);
    app.persistTimer = setTimeout(() => saveLabState(engine, labState), 600);
  };

  function applyPanelVisibility() {
    panel.classList.toggle('hidden-panel', !labState.panelOpen);
    fab.hidden = labState.panelOpen;
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
    if (!labState.probe || !probeTip) {
      if (probeTip) probeTip.hidden = true;
      return;
    }
    let sample;
    try {
      sample = engine.sampleSurface({
        now: performance.now() / 1000,
        minIntervalSeconds: force ? 0 : 0.055,
      });
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
    const px = Math.min(window.innerWidth - 210, app.pointer.screenPosition.x + 18);
    const py = Math.min(window.innerHeight - 94, app.pointer.screenPosition.y + 16);
    probeTip.style.left = `${Math.max(8, px)}px`;
    probeTip.style.top = `${Math.max(8, py)}px`;
  }

  function updateDiagnostics() {
    if (!app.ui) return;
    const diagnostic = engine.diagnostics(app.displayHz);
    const statistics = diagnostic.stats;
    const lines = [
      `fps      <b>${diagnostic.fps.toFixed(1)}</b>  frame <b>${diagnostic.frameMs.toFixed(2)} ms</b>`,
      `buffer   ${diagnostic.bufferWidth === null ? 'n/a (2d)' : `${diagnostic.bufferWidth}×${diagnostic.bufferHeight} px`}  ratio <b>${diagnostic.ratio === null ? '—' : diagnostic.ratio.toFixed(2)}</b>`,
      `dpr      ${(window.devicePixelRatio || 1).toFixed(2)}  scale req/cur/eff <b>${diagnostic.requestedScale.toFixed(2)} / ${diagnostic.currentScale.toFixed(2)} / ${diagnostic.effectiveScale.toFixed(2)}</b>`,
      `present  <b>${app.displayHz} Hz</b>${state.adaptive && state.targetFps > app.displayHz ? `  requested ${state.targetFps} fps · adaptive uses ${app.displayHz}` : ''}`,
      `quality  <b>${diagnostic.effectiveQuality ?? '—'}</b>${state.adaptive ? ` (auto scale only · ${diagnostic.adaptiveAction})` : ' (manual)'}`,
      statistics && statistics.calls !== null
        ? `calls    ${statistics.calls}  tris ${statistics.triangles ?? '—'}`
        : null,
      `input    pos <b>${diagnostic.influence.position.x.toFixed(3)}, ${diagnostic.influence.position.y.toFixed(3)}</b>  vel <b>${diagnostic.influence.velocity.x.toFixed(2)}, ${diagnostic.influence.velocity.y.toFixed(2)}</b>  strength <b>${diagnostic.influence.strength.toFixed(2)}</b>`,
      `warp     <b>${diagnostic.motionWarp.enabled ? 'on' : 'off'}</b>  gain <b>${diagnostic.motionWarp.gain.toFixed(2)}</b>  radius <b>${diagnostic.motionWarp.radius.toFixed(2)}</b>  effect <b>${diagnostic.motionWarp.effectiveStrength.toFixed(4)} su</b>${diagnostic.capabilities?.motionWarp === false ? '  (GPU unavailable)' : ''}`,
      `active   amplitude <b>${diagnostic.activeDeformation.sourceAmplitude.toFixed(2)}</b>  radius <b>${diagnostic.activeDeformation.radius.toFixed(2)}</b>`,
      `press    <b>${diagnostic.activeDeformation.pressEnabled ? 'on' : 'off'}</b>  gain <b>${diagnostic.activeDeformation.pressGain.toFixed(2)}</b>  effect <b>${diagnostic.activeDeformation.pressDisplacement.toFixed(4)} su</b>`,
      `drag     <b>${diagnostic.activeDeformation.dragEnabled ? 'on' : 'off'}</b>  gain <b>${diagnostic.activeDeformation.dragGain.toFixed(2)}</b>  vector <b>${diagnostic.activeDeformation.dragDisplacement.x.toFixed(4)}, ${diagnostic.activeDeformation.dragDisplacement.y.toFixed(4)} su</b>${diagnostic.capabilities?.activeDeformation === false ? '  (GPU unavailable)' : ''}`,
      `shear    <b>${diagnostic.coordinateShear.enabled ? 'on' : 'off'}</b>  gain <b>${diagnostic.coordinateShear.gain.toFixed(2)}</b>  speed <b>${diagnostic.coordinateShear.sourceSpeed.toFixed(2)} su/s</b>  vector <b>${diagnostic.coordinateShear.displacement.x.toFixed(4)}, ${diagnostic.coordinateShear.displacement.y.toFixed(4)} su</b>${diagnostic.capabilities?.coordinateShear === false ? '  (GPU unavailable)' : ''}`,
      `ripple   <b>${diagnostic.rippleDisplacement.enabled ? 'on' : 'off'}</b>  gain <b>${diagnostic.rippleDisplacement.gain.toFixed(2)}</b>  active <b>${diagnostic.rippleDisplacement.activeEventCount}/${diagnostic.rippleDisplacement.capacity}</b>${diagnostic.capabilities?.rippleDisplacement === false ? '  (GPU unavailable)' : ''}`,
      `membrane <b>${diagnostic.membraneResponse.enabled ? 'on' : 'off'}</b>  radial/tangent <b>${diagnostic.membraneResponse.radialDisplacement.toFixed(4)} / ${diagnostic.membraneResponse.tangentialDisplacement.toFixed(4)} su</b>  radius <b>${diagnostic.membraneResponse.radius.toFixed(2)}</b>  waves <b>${diagnostic.membraneResponse.activeWaveCount}/${diagnostic.membraneResponse.waveCapacity}</b>${diagnostic.capabilities?.membraneResponse === false ? '  (GPU unavailable)' : ''}`,
      `normals  <b>${diagnostic.normalEvaluation.mode}</b>  height taps <b>${diagnostic.normalEvaluation.normalHeightSamples}</b>  displacement evals <b>${diagnostic.normalEvaluation.displacementEvaluations}</b>${diagnostic.capabilities?.displacedGeometryNormals === false && diagnostic.normalEvaluation.displacedGeometry ? '  (GPU unavailable)' : ''}`,
      `clocks   animation ${diagnostic.clocks.animation.toFixed(2)}  flow ${diagnostic.clocks.flow.toFixed(2)}  light ${diagnostic.clocks.lighting.toFixed(2)}  events ${diagnostic.clocks.events.toFixed(2)}`,
      `events   ${diagnostic.transientEventCount}/${diagnostic.transientCapacity}  locks ${diagnostic.lockCount}  tx ${diagnostic.lastTransaction.accepted}/${diagnostic.lastTransaction.skipped}/${diagnostic.lastTransaction.rejected}`,
      `mode     ${state.diag}${state.paused ? '  ·  PAUSED' : ''}`,
    ].filter(Boolean).join('\n');
    app.ui.setDiag(lines);
  }

  const actions = {
    benchmarkRunning: () => benchmarkController !== null,
    stopBenchmark: () => benchmarkController?.abort(),
    runBenchmark: async () => {
      if (benchmarkController) return;
      let session;
      try { session = renderHost.beginBenchmark(); }
      catch (error) { toast(error.message); return; }
      benchmarkController = new AbortController();
      const started = performance.now();
      const oldCanvasInert = canvas.inert;
      const oldFallbackInert = fallbackCanvas.inert;
      canvas.inert = fallbackCanvas.inert = true;
      fpsHistory.suspend();
      app.ui.setBenchmark({ running: true, ...session.configuration, phase: 'warm-up', elapsedMs: 0, durationMs: 2000 });
      // Suspend both engine.advance and engine.render in the existing loop.
      // This disables adaptive evaluation without setAdaptive(false), which
      // would reset the effective scale and change the workload being tested.
      // Parameters, clocks, pause and the user's adaptive setting stay intact.
      try {
        const statistics = await runBenchmark({
          renderBatch: session.renderBatch,
          synchronize: session.synchronize,
          signal: benchmarkController.signal,
          onProgress: (progress) => app.ui.setBenchmark({ running: true, ...session.configuration, ...progress }),
        });
        const result = { ...session.configuration, ...statistics };
        benchmarkResults.save(result);
        app.ui.setBenchmark({ ...result, phase: 'complete' }, benchmarkResults.values());
      } catch (error) {
        const cancelled = error.name === 'AbortError';
        app.ui.setBenchmark({ ...session.configuration, phase: cancelled ? 'cancelled' : 'failed', error: cancelled ? '' : error.message });
        if (!cancelled) toast(`Benchmark failed: ${error.message}`);
      } finally {
        session.end();
        // Keep the adaptive controller's wall-clock window frozen as well.
        if (engine.adaptive.active) engine.adaptive.windowStart += performance.now() - started;
        canvas.inert = oldCanvasInert;
        fallbackCanvas.inert = oldFallbackInert;
        benchmarkController = null;
        fpsHistory.suspend();
        app.lastFrame = performance.now();
        app.ui.finishBenchmark();
        updateDiagnostics();
      }
    },
    backend: () => renderHost.backend,
    webgpuAvailable: () => webgpuAvailable,
    switchBackend: async (backend) => {
      try {
        canvas = await renderHost.switchBackend(backend, {
          msaa: state.msaa, quality: state.quality,
        });
        app.pointer.rebind(canvas, [fallbackCanvas]);
        bindPointerEvents();
        updateDiagnostics();
      } catch (error) {
        toast(`Backend switch failed: ${error?.message ?? error}`);
        if (backend === 'WebGPU') webgpuAvailable = await isWebGPUAvailable();
      }
    },
    persistSoon,
    param: (name, value) => { if (engine.setParameter(name, value).changed) persistSoon(); },
    resetParam: (name) => {
      if (engine.resetParameter(name).changed) { app.ui?.sync(); persistSoon(); }
    },
    lockParam: (name, locked) => {
      if (engine.setParameterLock(name, locked)) { app.ui?.sync(); persistSoon(); }
    },
    motionWarpConfiguration: () => engine.getMotionWarpConfiguration(),
    motionWarp: (changes) => {
      const report = engine.setMotionWarp(changes);
      if (report.changed) {
        markInteractionProfileCustom(labState);
        app.ui?.sync(); persistSoon();
      }
      return report;
    },
    activeDeformationConfiguration: () => engine.getActiveDeformationConfiguration(),
    activeDeformation: (changes) => {
      const report = engine.setActiveDeformation(changes);
      if (report.changed) {
        markInteractionProfileCustom(labState);
        app.ui?.sync(); persistSoon();
      }
      return report;
    },
    coordinateShearConfiguration: () => engine.getCoordinateShearConfiguration(),
    coordinateShear: (changes) => {
      const report = engine.setCoordinateShear(changes);
      if (report.changed) {
        markInteractionProfileCustom(labState);
        app.ui?.sync(); persistSoon();
      }
      return report;
    },
    rippleDisplacementConfiguration: () => engine.getRippleDisplacementConfiguration(),
    rippleDisplacement: (changes) => {
      const report = engine.setRippleDisplacement(changes);
      if (report.changed) {
        markInteractionProfileCustom(labState);
        app.ui?.sync(); persistSoon();
      }
      return report;
    },
    membraneResponseConfiguration: () => engine.getMembraneResponseConfiguration(),
    membraneResponse: (changes) => {
      const report = engine.setMembraneResponse(changes);
      if (report.changed) {
        markInteractionProfileCustom(labState);
        app.ui?.sync(); persistSoon();
      }
      return report;
    },
    normalEvaluationConfiguration: () => engine.getNormalEvaluationConfiguration(),
    normalEvaluation: (changes) => {
      const report = engine.setNormalEvaluation(changes);
      if (report.changed) {
        app.ui?.sync(); persistSoon();
      }
      return report;
    },
    interactionProfile: (name) => {
      const report = applyInteractionProfile(engine, labState, name);
      if (report.ok) {
        configureEventTriggers();
        app.ui?.sync();
        persistSoon();
      }
      return report;
    },
    rippleOnClick: (enabled) => {
      labState.rippleOnClick = enabled === true;
      app.rippleTriggers.configure({ clickEnabled: labState.rippleOnClick });
      markInteractionProfileCustom(labState);
      app.ui?.sync();
      persistSoon();
    },
    rippleDuringDrag: (enabled) => {
      labState.rippleDuringDrag = enabled === true;
      app.rippleTriggers.configure({ dragEnabled: labState.rippleDuringDrag });
      markInteractionProfileCustom(labState);
      app.ui?.sync();
      persistSoon();
    },
    membraneWaveOnPress: (enabled) => {
      labState.membraneWaveOnPress = enabled === true;
      app.membraneTriggers.configure({ clickEnabled: labState.membraneWaveOnPress });
      markInteractionProfileCustom(labState);
      app.ui?.sync();
      persistSoon();
    },
    membraneWaveDuringDrag: (enabled) => {
      labState.membraneWaveDuringDrag = enabled === true;
      app.membraneTriggers.configure({ dragEnabled: labState.membraneWaveDuringDrag });
      markInteractionProfileCustom(labState);
      app.ui?.sync();
      persistSoon();
    },
    preset: (name) => {
      if (engine.applyPreset(name).ok) { app.ui?.sync(); persistSoon(); }
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
      resetLabUiState(labState);
      configureEventTriggers();
      applyPanelVisibility();
      app.ui?.sync();
      saveLabState(engine, labState);
      toast('Factory reset complete');
    },
    togglePause: () => { engine.togglePaused(); app.ui?.sync(); persistSoon(); },
    fullscreen: () => { toggleFullscreen(); },
    hidePanel: () => { labState.panelOpen = false; applyPanelVisibility(); persistSoon(); },
    showPanel: () => { labState.panelOpen = true; applyPanelVisibility(); persistSoon(); },
    quality: (quality) => {
      if (engine.setQuality(quality)) { app.ui?.sync(); persistSoon(); }
    },
    msaa: async (value) => {
      if (state.msaa === value || ![0, 2, 4].includes(value)) return;
      app.ui?.sync();
      try {
        if (renderHost.hasGpu()) {
          canvas = await renderHost.switchBackend(renderHost.backend, {
            msaa: value, quality: state.quality,
          });
          app.pointer.rebind(canvas, [fallbackCanvas]);
          bindPointerEvents();
        }
        engine.setMsaa(value);
        persistSoon();
        updateDiagnostics();
      } catch (error) {
        toast(`MSAA change failed: ${error?.message ?? error}`);
      } finally {
        app.ui?.sync();
      }
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
      labState.probe = enabled;
      if (probeTip) probeTip.hidden = true;
      if (enabled) setTimeout(() => updateProbe(true), 0);
      persistSoon();
    },
    capture: captureFrame,
    exportSettings: async () => {
      const json = JSON.stringify(snapshotLab(engine, labState));
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

  app.ui = buildUI(panel, state, labState, actions);
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
      if (applyLabSnapshot(engine, labState, parsed, { preserveLocks: true })) {
        configureEventTriggers();
        applyPanelVisibility();
        app.ui?.sync();
        saveLabState(engine, labState);
        dialog?.close?.();
        toast('Settings applied');
      } else {
        toast('Invalid settings (version mismatch or bad shape) — live state untouched');
      }
    } catch {
      toast('Malformed JSON — live state untouched');
    }
  });

  app.pointer = createPointerAdapter(canvas, [fallbackCanvas]);
  const submitInfluence = () => {
    engine.setViewport({ aspect: app.pointer.aspect });
    engine.setSpatialInfluence(app.pointer.influence);
  };
  const emitRippleOrigins = (origins) => {
    if (!engine.getRippleDisplacementConfiguration().enabled) return;
    for (const origin of origins) {
      engine.emitTransientEvent(createRippleDisplacementEvent({ origin }));
    }
  };
  const emitMembraneOrigins = (origins) => {
    const configuration = engine.getMembraneResponseConfiguration();
    if (!configuration.enabled || !configuration.waveEnabled) return;
    for (const origin of origins) {
      engine.emitTransientEvent(createMembraneWaveEvent({ origin }));
    }
  };
  let pointerBindings;
  function bindPointerEvents() {
    pointerBindings?.abort();
    pointerBindings = new AbortController();
    const options = { signal: pointerBindings.signal };
    for (const target of [canvas, fallbackCanvas]) {
      target.addEventListener('pointermove', () => {
        submitInfluence();
        if (app.pointer.influence.engaged) {
          emitRippleOrigins(app.rippleTriggers.move(app.pointer.influence.position));
          emitMembraneOrigins(app.membraneTriggers.move(app.pointer.influence.position));
        }
        if (labState.probe) updateProbe(false);
      }, options);
      target.addEventListener('pointerdown', () => {
        submitInfluence();
        if (app.pointer.influence.engaged) {
          emitRippleOrigins(app.rippleTriggers.begin(app.pointer.influence.position));
          emitMembraneOrigins(app.membraneTriggers.begin(app.pointer.influence.position));
        }
        if (labState.probe) updateProbe(true);
      }, options);
      target.addEventListener('pointerup', () => {
        app.rippleTriggers.end();
        app.membraneTriggers.end();
      }, options);
      target.addEventListener('pointercancel', () => {
        app.rippleTriggers.end();
        app.membraneTriggers.end();
      }, options);
    }
  }
  bindPointerEvents();

  window.addEventListener('keydown', (event) => {
    if (benchmarkController) {
      if (event.key === 'Escape') benchmarkController.abort();
      return;
    }
    const target = event.target;
    if (target && ((target.tagName === 'INPUT' && target.type !== 'range') || target.tagName === 'TEXTAREA'
      || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (event.code === 'Space') { event.preventDefault(); actions.togglePause(); }
    else if (event.key === 'm' || event.key === 'M') actions.mutate();
    else if (event.key === 'r' || event.key === 'R') actions.randomize();
    else if (event.key === 'f' || event.key === 'F') actions.fullscreen();
    else if (event.key === 'h' || event.key === 'H') {
      (labState.panelOpen ? actions.hidePanel : actions.showPanel)();
    } else if (event.key === 'd' || event.key === 'D') actions.cycleDiag();
    else if (event.key === 'Escape' && labState.panelOpen) actions.hidePanel();
  });

  const observer = new ResizeObserver(() => engine.resize());
  window.addEventListener('resize', () => benchmarkController?.abort());
  observer.observe(document.body);
  window.addEventListener('orientationchange', () => engine.resize());
  document.addEventListener('fullscreenchange', () => setTimeout(() => engine.resize(), 60));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) benchmarkController?.abort();
    app.lastFrame = performance.now();
    fpsHistory.suspend();
  });

  bootMsg('Measuring display refresh…');
  app.displayHz = await measurePresentationHz();
  bootMsg('Initializing WebGPU renderer…');
  await engine.initialize({ onProgress: bootMsg });
  webgpuAvailable = renderHost.backend === 'WebGPU';
  updateDiagnostics();
  if (!webgpuAvailable) {
    isWebGPUAvailable().then((available) => {
      webgpuAvailable = available;
      updateDiagnostics();
    });
  }
  document.getElementById('boot')?.classList.add('done');

  const frame = () => {
    const now = performance.now();
    let dt = (now - app.lastFrame) / 1000;
    app.lastFrame = now;
    if (!(dt >= 0) || dt > 0.25) dt = 0.025;
    if (document.hidden || benchmarkController) {
      fpsHistory.suspend();
      requestAnimationFrame(frame);
      return;
    }
    if (fpsHistory.frame(now)) app.ui.setFpsHistory(fpsHistory.samples);

    app.pointer.advance(dt);
    submitInfluence();
    engine.advance(dt);
    engine.render({ now, displayHz: app.displayHz });
    app.diagnosticTimer += dt;
    if (app.diagnosticTimer > 0.5) {
      app.diagnosticTimer = 0;
      updateDiagnostics();
    }
    if (labState.probe) {
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
