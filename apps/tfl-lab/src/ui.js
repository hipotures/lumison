// Floating laboratory control panel. Schema-driven sliders (no duplicated
// control code), preset grid, render/view/diagnostics sections. All writes go
// through action callbacks into the single app state; `sync()` re-reads state
// so presets / mutate / import / reset refresh every control consistently.
import {
  PARAM_DEFS, QUALITY_LEVELS, DIAG_MODES, TARGET_FPS_OPTIONS, PRESET_NAMES,
  NORMAL_EVALUATION_MODE_NAMES,
} from '../../../packages/tfl-engine/src/index.js';
import { INTERACTION_PROFILE_NAMES } from './interaction-profiles.js';
import { formatNum } from './util.js';

const GROUPS = [
  ['preset', 'Material Preset'],
  ['sim', 'Film Simulation'],
  ['interaction', 'Experimental Interaction'],
  ['opt', 'Optics'],
  ['lit', 'Lighting'],
  ['ren', 'Rendering'],
  ['view', 'View & Probe'],
];

const GROUP_OF = {};
for (const [k, d] of Object.entries(PARAM_DEFS)) GROUP_OF[k] = d[4];

export function buildUI(root, state, labState, A) {
  root.innerHTML = '';
  const head = el('div', 'panel-head');
  head.append(el('div', 'panel-title', 'Thin-Film Lab'));
  head.append(iconBtn('⛶', 'Fullscreen (F)', () => A.fullscreen()));
  head.append(iconBtn('–', 'Collapse panel', () => {
    root.classList.toggle('collapsed');
  }));
  head.append(iconBtn('✕', 'Hide interface (H)', () => A.hidePanel()));
  root.append(head);

  const fixed = el('div', 'panel-fixed');
  const actions = el('div', 'action-strip');
  let pauseBtn;
  for (const [label, callback] of [
    ['Pause', () => A.togglePause()],
    ['Mutate', () => A.mutate()],
    ['Random', () => A.randomize()],
    ['Capture', () => A.capture()],
  ]) {
    const button = el('button', 'btn', label);
    button.addEventListener('click', callback);
    actions.append(button);
    if (label === 'Pause') {
      pauseBtn = button;
      pauseBtn.id = 'btnPause';
      pauseBtn.title = 'Pause / resume (Space)';
    }
  }
  fixed.append(actions);
  const footer = el('div', 'panel-footer');
  const diag = el('aside', 'diagnostics-hud', 'starting…');
  diag.id = 'diag';
  diag.hidden = true;
  diag.setAttribute('aria-label', 'Diagnostics');
  footer.append(toggleRow('Diagnostics', false, (enabled) => {
    diag.hidden = !enabled;
  }));
  const secondaryActions = el('div', 'action-strip secondary-actions');
  for (const [label, callback] of [
    ['Export', () => A.exportSettings()],
    ['Import', () => A.importSettings()],
    ['Reset', () => A.resetAll()],
    ['Full Reset', () => A.factoryReset()],
  ]) {
    const button = el('button', 'btn', label);
    button.addEventListener('click', callback);
    secondaryActions.append(button);
  }
  fixed.append(secondaryActions);
  root.append(fixed);

  const body = el('div', 'panel-body');
  body.id = 'panelBody';
  root.append(body, footer);

  const sliders = {};   // name -> {input, output}
  const sections = {};

  for (const [gid, title] of GROUPS) {
    const det = document.createElement('section');
    det.className = 'section';
    const sum = el('button', 'section-heading');
    sum.textContent = title;
    sum.id = `heading-${gid}`;
    sum.setAttribute('aria-controls', `section-${gid}`);
    sum.setAttribute('aria-expanded', String(gid === 'preset'));
    det.classList.toggle('expanded', gid === 'preset');
    det.append(sum);
    const wrap = el('div', 'sec-body');
    wrap.id = `section-${gid}`;
    wrap.hidden = gid !== 'preset';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-labelledby', sum.id);
    sum.addEventListener('click', () => {
      const opening = wrap.hidden;
      for (const section of body.children) {
        const expanded = section === det && opening;
        section.classList.toggle('expanded', expanded);
        section.firstElementChild.setAttribute('aria-expanded', String(expanded));
        section.lastElementChild.hidden = !expanded;
      }
    });
    det.append(wrap);
    body.append(det);
    sections[gid] = wrap;
  }

  // ---- presets ----
  const grid = el('div', 'preset-grid');
  const presetBtns = {};
  for (const name of PRESET_NAMES) {
    const b = el('button', 'preset-btn', name);
    b.addEventListener('click', () => A.preset(name));
    grid.append(b);
    presetBtns[name] = b;
  }
  sections.preset.append(grid);
  sections.preset.append(hint('Presets reshape fluid, optics and lighting together. Parameter locks are respected by presets, Mutate, Randomize, Reset and Import.'));

  // ---- sliders ----
  for (const [name, def] of Object.entries(PARAM_DEFS)) {
    const [min, max, step, dflt, group, label] = def;
    const host = sections[group] ?? sections.sim;
    const ctl = el('div', 'ctl');
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.title = `Double-click to reset to ${formatNum(dflt, step)}`;
    const out = document.createElement('output');
    out.textContent = formatNum(state.target[name], step);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(state.target[name]);
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      A.param(name, Number(input.value));
      out.textContent = formatNum(Number(input.value), step);
    });

    const lock = document.createElement('input');
    lock.type = 'checkbox';
    lock.className = 'param-lock';
    lock.checked = state.locks?.[name] === true;
    lock.setAttribute('aria-label', `Lock ${label}`);
    lock.title = 'Lock this value. Only Factory Reset bypasses parameter locks.';
    lock.addEventListener('change', () => A.lockParam(name, lock.checked));

    lab.addEventListener('dblclick', () => A.resetParam(name));
    ctl.append(lab, out, lock, input);
    host.append(ctl);
    sliders[name] = { input, output: out, lock, step };
  }

  // ---- optional source-neutral spatial responses ----
  const interaction = sections.interaction;
  const initialMotionWarp = A.motionWarpConfiguration();
  const initialActiveDeformation = A.activeDeformationConfiguration();
  const initialCoordinateShear = A.coordinateShearConfiguration();
  const initialRippleDisplacement = A.rippleDisplacementConfiguration();
  const initialMembraneResponse = A.membraneResponseConfiguration();
  const initialNormalEvaluation = A.normalEvaluationConfiguration();
  const profileSelect = document.createElement('select');
  profileSelect.id = 'selInteractionProfile';
  profileSelect.setAttribute('aria-label', 'Interaction profile');
  for (const name of INTERACTION_PROFILE_NAMES) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    profileSelect.append(option);
  }
  profileSelect.value = labState.interactionProfile;
  profileSelect.addEventListener('change', () => A.interactionProfile(profileSelect.value));
  interaction.append(kvRow('Interaction profile', profileSelect));
  interaction.append(toggleRow(
    'Passive Warp',
    initialMotionWarp.enabled,
    (enabled) => A.motionWarp({ enabled }),
  ));
  const passiveGain = rangeRow(
    'Passive Strength', 0, 2, 0.05, initialMotionWarp.gain,
    (gain) => A.motionWarp({ gain }),
  );
  const passiveRadius = rangeRow(
    'Passive Radius', 0.03, 0.5, 0.01, initialMotionWarp.radius,
    (radius) => A.motionWarp({ radius }),
  );
  interaction.append(passiveGain.root, passiveRadius.root);
  interaction.append(toggleRow(
    'Active Press',
    initialActiveDeformation.pressEnabled,
    (pressEnabled) => A.activeDeformation({ pressEnabled }),
  ));
  const activePressGain = rangeRow(
    'Press Gain (+ inward)', -2, 2, 0.05, initialActiveDeformation.pressGain,
    (pressGain) => A.activeDeformation({ pressGain }),
  );
  interaction.append(activePressGain.root);
  interaction.append(toggleRow(
    'Active Drag',
    initialActiveDeformation.dragEnabled,
    (dragEnabled) => A.activeDeformation({ dragEnabled }),
  ));
  const activeDragGain = rangeRow(
    'Drag Gain', 0, 2, 0.05, initialActiveDeformation.dragGain,
    (dragGain) => A.activeDeformation({ dragGain }),
  );
  const activeRadius = rangeRow(
    'Active Radius', 0.03, 0.5, 0.01, initialActiveDeformation.radius,
    (radius) => A.activeDeformation({ radius }),
  );
  interaction.append(activeDragGain.root, activeRadius.root);
  interaction.append(toggleRow(
    'Coordinate Shear',
    initialCoordinateShear.enabled,
    (enabled) => A.coordinateShear({ enabled }),
  ));
  const coordinateShearGain = rangeRow(
    'Coordinate Shear Gain', 0, 2, 0.05, initialCoordinateShear.gain,
    (gain) => A.coordinateShear({ gain }),
  );
  interaction.append(coordinateShearGain.root);
  interaction.append(toggleRow(
    'Ripple Displacement',
    initialRippleDisplacement.enabled,
    (enabled) => A.rippleDisplacement({ enabled }),
  ));
  const rippleGain = rangeRow(
    'Ripple Gain', 0, 2, 0.05, initialRippleDisplacement.gain,
    (gain) => A.rippleDisplacement({ gain }),
  );
  interaction.append(rippleGain.root);
  interaction.append(toggleRow(
    'Ripple on Click',
    labState.rippleOnClick,
    (enabled) => A.rippleOnClick(enabled),
  ));
  interaction.append(toggleRow(
    'Ripples During Drag',
    labState.rippleDuringDrag,
    (enabled) => A.rippleDuringDrag(enabled),
  ));
  interaction.append(toggleRow(
    'Mobile Membrane',
    initialMembraneResponse.enabled,
    (enabled) => A.membraneResponse({ enabled }),
  ));
  const membraneRadialGain = rangeRow(
    'Membrane Radial Gain', -2, 2, 0.05, initialMembraneResponse.radialGain,
    (radialGain) => A.membraneResponse({ radialGain }),
  );
  const membraneTangentialGain = rangeRow(
    'Membrane Swirl Gain', -2, 2, 0.05, initialMembraneResponse.tangentialGain,
    (tangentialGain) => A.membraneResponse({ tangentialGain }),
  );
  const membraneRadius = rangeRow(
    'Membrane Radius', 0.12, 0.9, 0.01, initialMembraneResponse.radius,
    (radius) => A.membraneResponse({ radius }),
  );
  interaction.append(
    membraneRadialGain.root,
    membraneTangentialGain.root,
    membraneRadius.root,
  );
  interaction.append(toggleRow(
    'Membrane Wave',
    initialMembraneResponse.waveEnabled,
    (waveEnabled) => A.membraneResponse({ waveEnabled }),
  ));
  const membraneWaveGain = rangeRow(
    'Membrane Wave Gain', 0, 2, 0.05, initialMembraneResponse.waveGain,
    (waveGain) => A.membraneResponse({ waveGain }),
  );
  interaction.append(membraneWaveGain.root);
  interaction.append(toggleRow(
    'Membrane Wave on Press',
    labState.membraneWaveOnPress,
    (enabled) => A.membraneWaveOnPress(enabled),
  ));
  interaction.append(toggleRow(
    'Membrane Waves During Drag',
    labState.membraneWaveDuringDrag,
    (enabled) => A.membraneWaveDuringDrag(enabled),
  ));

  // ---- rendering extras ----
  const rsec = sections.ren;
  rsec.append(kvRow('Quality', qualitySelect()));
  rsec.append(kvRow('MSAA', msaaSelect()));
  rsec.append(toggleRow('Adaptive quality', state.adaptive, (v) => A.adaptive(v)));
  rsec.append(kvRow('Target FPS', fpsSelect()));
  rsec.append(hint('Adaptive steps render scale first, then quality — in both directions, with cooldowns.'));

  // ---- view ----
  const vsec = sections.view;
  const normalModeSelect = document.createElement('select');
  normalModeSelect.id = 'selNormalEvaluation';
  normalModeSelect.setAttribute('aria-label', 'Normal evaluation');
  for (const mode of NORMAL_EVALUATION_MODE_NAMES) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = mode;
    normalModeSelect.append(option);
  }
  normalModeSelect.value = initialNormalEvaluation.mode;
  normalModeSelect.addEventListener('change', () => A.normalEvaluation({
    mode: normalModeSelect.value,
  }));
  vsec.append(kvRow('Normal evaluation', normalModeSelect));
  vsec.append(hint(
    'Legacy Fixed samples around the displaced center. Displaced Geometry derives lighting normals from the same spatially deformed height field; use the Normal view to compare.',
  ));
  vsec.append(kvRow('Diagnostic view (D)', diagSelect()));
  vsec.append(toggleRow('Surface probe', labState.probe, (v) => A.probe(v)));
  vsec.append(hint('Probe: hover the film for a live local thickness / normal readout. Click or drag the film to disturb the surface.'));

  // ---- shortcuts ----
  const shortcuts = el('aside', 'shortcut-strip');
  shortcuts.id = 'shortcuts';
  shortcuts.setAttribute('aria-label', 'Keyboard shortcuts');
  shortcuts.append(hint(
    '<kbd>Space</kbd> pause · <kbd>M</kbd> mutate · <kbd>R</kbd> randomize · ' +
    '<kbd>F</kbd> fullscreen · <kbd>H</kbd> hide UI · <kbd>D</kbd> diagnostic view',
  ));
  document.getElementById('diag')?.remove();
  document.getElementById('shortcuts')?.remove();
  root.after(diag, shortcuts);

  function qualitySelect() {
    const s = document.createElement('select');
    s.setAttribute('aria-label', 'Quality');
    for (const q of QUALITY_LEVELS) {
      const o = document.createElement('option');
      o.value = q; o.textContent = q;
      if (q === state.quality) o.selected = true;
      s.append(o);
    }
    s.addEventListener('change', () => A.quality(s.value));
    s.id = 'selQuality';
    return s;
  }
  function msaaSelect() {
    const s = document.createElement('select');
    s.setAttribute('aria-label', 'MSAA');
    for (const [v, t] of [[0, 'Off'], [2, '2x'], [4, '4x']]) {
      const o = document.createElement('option');
      o.value = String(v); o.textContent = t;
      if (v === state.msaa) o.selected = true;
      s.append(o);
    }
    s.addEventListener('change', () => A.msaa(Number(s.value)));
    s.id = 'selMsaa';
    return s;
  }
  function fpsSelect() {
    const s = document.createElement('select');
    s.setAttribute('aria-label', 'Target FPS');
    for (const f of TARGET_FPS_OPTIONS) {
      const o = document.createElement('option');
      o.value = String(f); o.textContent = `${f} fps`;
      if (f === state.targetFps) o.selected = true;
      s.append(o);
    }
    s.addEventListener('change', () => A.targetFps(Number(s.value)));
    s.id = 'selFps';
    return s;
  }
  function diagSelect() {
    const s = document.createElement('select');
    s.setAttribute('aria-label', 'Diagnostic view');
    for (const d of DIAG_MODES) {
      const o = document.createElement('option');
      o.value = d; o.textContent = d;
      if (d === state.diag) o.selected = true;
      s.append(o);
    }
    s.addEventListener('change', () => A.diag(s.value));
    s.id = 'selDiag';
    return s;
  }

  // Re-read state into every control (presets, mutate, import, reset…).
  function sync() {
    for (const [name, c] of Object.entries(sliders)) {
      const locked = state.locks?.[name] === true;
      c.input.value = String(state.target[name]);
      c.output.textContent = formatNum(state.target[name], c.step);
      c.lock.checked = locked;
      c.input.disabled = locked;
      c.input.closest('.ctl')?.classList.toggle('locked', locked);
    }
    for (const [name, b] of Object.entries(presetBtns)) {
      b.classList.toggle('active', state.preset === name);
    }
    const q = root.querySelector('#selQuality');
    if (q) q.value = state.quality;
    const m = root.querySelector('#selMsaa');
    if (m) m.value = String(state.msaa);
    const f = root.querySelector('#selFps');
    if (f) f.value = String(state.targetFps);
    const d = root.querySelector('#selDiag');
    if (d) d.value = state.diag;
    const aq = root.querySelector('input[aria-label="Adaptive quality"]');
    if (aq) aq.checked = state.adaptive;
    const motionWarp = A.motionWarpConfiguration();
    const passive = root.querySelector('input[aria-label="Passive Warp"]');
    if (passive) passive.checked = motionWarp.enabled;
    passiveGain.input.value = String(motionWarp.gain);
    passiveGain.output.textContent = formatNum(motionWarp.gain, 0.05);
    passiveRadius.input.value = String(motionWarp.radius);
    passiveRadius.output.textContent = formatNum(motionWarp.radius, 0.01);
    const active = A.activeDeformationConfiguration();
    const press = root.querySelector('input[aria-label="Active Press"]');
    if (press) press.checked = active.pressEnabled;
    activePressGain.input.value = String(active.pressGain);
    activePressGain.output.textContent = formatNum(active.pressGain, 0.05);
    const drag = root.querySelector('input[aria-label="Active Drag"]');
    if (drag) drag.checked = active.dragEnabled;
    activeDragGain.input.value = String(active.dragGain);
    activeDragGain.output.textContent = formatNum(active.dragGain, 0.05);
    activeRadius.input.value = String(active.radius);
    activeRadius.output.textContent = formatNum(active.radius, 0.01);
    const coordinateShear = A.coordinateShearConfiguration();
    const shear = root.querySelector('input[aria-label="Coordinate Shear"]');
    if (shear) shear.checked = coordinateShear.enabled;
    coordinateShearGain.input.value = String(coordinateShear.gain);
    coordinateShearGain.output.textContent = formatNum(coordinateShear.gain, 0.05);
    const rippleDisplacement = A.rippleDisplacementConfiguration();
    const ripple = root.querySelector('input[aria-label="Ripple Displacement"]');
    if (ripple) ripple.checked = rippleDisplacement.enabled;
    rippleGain.input.value = String(rippleDisplacement.gain);
    rippleGain.output.textContent = formatNum(rippleDisplacement.gain, 0.05);
    const rippleOnClick = root.querySelector('input[aria-label="Ripple on Click"]');
    if (rippleOnClick) rippleOnClick.checked = labState.rippleOnClick;
    const ripplesDuringDrag = root.querySelector('input[aria-label="Ripples During Drag"]');
    if (ripplesDuringDrag) ripplesDuringDrag.checked = labState.rippleDuringDrag;
    const interactionProfile = root.querySelector('#selInteractionProfile');
    if (interactionProfile) interactionProfile.value = labState.interactionProfile;
    const membraneResponse = A.membraneResponseConfiguration();
    const membrane = root.querySelector('input[aria-label="Mobile Membrane"]');
    if (membrane) membrane.checked = membraneResponse.enabled;
    membraneRadialGain.input.value = String(membraneResponse.radialGain);
    membraneRadialGain.output.textContent = formatNum(membraneResponse.radialGain, 0.05);
    membraneTangentialGain.input.value = String(membraneResponse.tangentialGain);
    membraneTangentialGain.output.textContent = formatNum(membraneResponse.tangentialGain, 0.05);
    membraneRadius.input.value = String(membraneResponse.radius);
    membraneRadius.output.textContent = formatNum(membraneResponse.radius, 0.01);
    const membraneWave = root.querySelector('input[aria-label="Membrane Wave"]');
    if (membraneWave) membraneWave.checked = membraneResponse.waveEnabled;
    membraneWaveGain.input.value = String(membraneResponse.waveGain);
    membraneWaveGain.output.textContent = formatNum(membraneResponse.waveGain, 0.05);
    const membraneWaveOnPress = root.querySelector('input[aria-label="Membrane Wave on Press"]');
    if (membraneWaveOnPress) membraneWaveOnPress.checked = labState.membraneWaveOnPress;
    const membraneWavesDuringDrag = root.querySelector('input[aria-label="Membrane Waves During Drag"]');
    if (membraneWavesDuringDrag) {
      membraneWavesDuringDrag.checked = labState.membraneWaveDuringDrag;
    }
    const normalEvaluation = A.normalEvaluationConfiguration();
    const normalMode = root.querySelector('#selNormalEvaluation');
    if (normalMode) normalMode.value = normalEvaluation.mode;
    const pr = root.querySelector('input[aria-label="Surface probe"]');
    if (pr) pr.checked = labState.probe;
    pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    pauseBtn.setAttribute('aria-pressed', String(state.paused));
  }

  function setDiag(html) {
    diag.innerHTML = html;
  }

  sync();
  return { sync, setDiag };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function iconBtn(text, title, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

function hint(html) {
  const p = document.createElement('p');
  p.className = 'hint';
  p.innerHTML = html;
  return p;
}

function kvRow(label, control) {
  const row = el('div', 'kv');
  const s = el('span', '', label);
  row.append(s, control);
  return row;
}

function toggleRow(label, initial, onChange) {
  const row = el('div', 'toggle-row');
  const lab = document.createElement('label');
  lab.textContent = label;
  const sw = el('span', 'switch');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = initial;
  input.setAttribute('aria-label', label);
  const track = el('span', 'track');
  sw.append(input, track);
  input.addEventListener('change', () => onChange(input.checked));
  row.append(lab, sw);
  return row;
}

function rangeRow(label, minimum, maximum, step, initial, onInput) {
  const root = el('div', 'ctl interaction-ctl');
  const lab = document.createElement('label');
  lab.textContent = label;
  const output = document.createElement('output');
  output.textContent = formatNum(initial, step);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(step);
  input.value = String(initial);
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    onInput(value);
    output.textContent = formatNum(value, step);
  });
  root.append(lab, output, input);
  return { root, input, output };
}
