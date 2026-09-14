import { TUNING_SCHEMA, GROUPS, defaultTuning, getTuningValue, setTuningValue, disableAllTuning, soloTuning, serializeTuning, parseTuning } from './visual-tuning.js';

export function createVisualTuningUI({ root, mapper, getFeatures, isActive }) {
  // Native accordion keyboard activation must not bubble to the app's Space
  // transport shortcut. Keep the browser's default control behavior intact.
  root.addEventListener('keydown', (event) => {
    if (event.code === 'Space') event.stopPropagation();
  });
  const controls = new Map();
  const monitors = [];
  const status = document.createElement('output');
  status.className = 'tuning-status';
  status.setAttribute('role', 'status');
  const groups = {};
  const descriptions = {
    transient: 'Disabled position inputs use center; other disabled inputs use their base values. Changes clear existing ripples; new notes use the new shape.',
    influence: 'Position and velocity are independent. Gate combines sounding notes OR density. Gate off means always engaged. Disabled strength/span use base values.',
    interactions: 'Spatial mechanisms require the field. Ripple Displacement requires note events. Membrane wave controls are supported, but this mapper emits no membrane waves. Active Deformation and Coordinate Shear use engine defaults when enabled.',
    temporal: 'Optional smoothing affects continuous mapping inputs only. Off preserves the original response; feature extraction is unchanged.',
  };
  for (const [key, label] of Object.entries(GROUPS)) {
    const group = document.createElement('details');
    group.open = key === 'master';
    const summary = document.createElement('summary');
    summary.textContent = label;
    group.append(summary);
    if (descriptions[key]) {
      const text = document.createElement('p');
      text.textContent = descriptions[key];
      group.append(text);
    }
    root.append(group);
    groups[key] = group;
  }
  function sync() {
    for (const [path, { input, output }] of controls) {
      const value = getTuningValue(mapper.tuning, path);
      if (input.type === 'checkbox') input.checked = value;
      else { input.value = value; output.value = String(value); }
    }
    document.getElementById('mappingEnabled').checked = mapper.tuning.master.enabled;
    document.getElementById('sensitivity').value = mapper.tuning.master.sensitivity;
    document.getElementById('sensitivityValue').value = String(mapper.tuning.master.sensitivity);
  }
  function apply(config) {
    if (!isActive()) { status.value = 'Switch to MIDI File mode to tune visual mapping.'; sync(); return; }
    try {
      mapper.applyTuning(config, getFeatures());
      sync();
      status.value = 'Applied';
    } catch (error) {
      sync();
      status.value = `Not applied: ${error.message}`;
    }
  }
  function button(parent, label, action) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.addEventListener('click', action);
    parent.append(node);
    return node;
  }
  for (const item of TUNING_SCHEMA) {
    const row = document.createElement('div');
    row.className = 'tuning-row';
    const label = document.createElement('label');
    label.textContent = item.label;
    const input = document.createElement('input');
    input.dataset.tuning = item.path;
    const output = document.createElement('output');
    input.type = typeof item.default === 'boolean' ? 'checkbox' : 'range';
    input.setAttribute('aria-label', item.label);
    if (input.type === 'range') {
      input.min = item.minimum; input.max = item.maximum; input.step = item.step;
      label.append(input);
      row.append(label, output);
      button(row, '↺', () => {
        const next = structuredClone(mapper.tuning);
        setTuningValue(next, item.path, item.default);
        apply(next);
      }).setAttribute('aria-label', `Reset ${item.label}`);
    } else {
      label.prepend(input);
      row.append(label);
      if (/^(parameterMappings|transient|influence)\./.test(item.path)) {
        button(row, 'Solo', () => apply(soloTuning(mapper.tuning, item.path)));
      }
    }
    if (item.feature) {
      const monitor = document.createElement('small');
      monitors.push({ node: monitor, feature: item.feature });
      row.append(monitor);
    }
    input.addEventListener('input', () => {
      const next = structuredClone(mapper.tuning);
      setTuningValue(next, item.path, input.type === 'checkbox' ? input.checked : Number(input.value));
      apply(next);
    });
    controls.set(item.path, { input, output });
    groups[item.path.split('.')[0]].append(row);
  }
  const actions = document.createElement('div');
  actions.className = 'tuning-actions';
  groups.master.append(actions, status);
  button(actions, 'Disable all mappings', () => apply(disableAllTuning(mapper.tuning)));
  button(actions, 'Restore defaults', () => apply(defaultTuning()));
  button(actions, 'Export JSON', () => {
    const url = URL.createObjectURL(new Blob([serializeTuning(mapper.tuning)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'lumison-visual-tuning.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.value = 'Exported';
  });
  button(actions, 'Copy JSON', async () => {
    try { await navigator.clipboard.writeText(serializeTuning(mapper.tuning)); status.value = 'Copied'; }
    catch { status.value = 'Clipboard unavailable. Use Export JSON.'; }
  });
  const file = document.createElement('input');
  file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
  file.addEventListener('change', async () => {
    try {
      if (file.files[0]) { apply(parseTuning(await file.files[0].text())); }
    } catch (error) { status.value = `Import failed: ${error.message}`; }
    file.value = '';
  });
  actions.append(file);
  button(actions, 'Import JSON', () => file.click());
  const sensitivity = TUNING_SCHEMA.find((item) => item.path === 'master.sensitivity');
  Object.assign(document.getElementById('sensitivity'), { min: sensitivity.minimum, max: sensitivity.maximum, step: sensitivity.step });
  sync();
  return {
    sync,
    renderFeatures(features) {
      for (const { node, feature } of monitors) node.textContent = `${feature.replace('01', '')}: ${Number.isFinite(features[feature]) ? features[feature].toFixed(2) : '—'}`;
    },
  };
}
