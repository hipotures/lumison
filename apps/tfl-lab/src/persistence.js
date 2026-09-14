const STORAGE_KEY = 'thin-film-lab.v1';

export function createLabState() {
  return {
    probe: false,
    panelOpen: true,
    panelCollapsed: {},
    rippleOnClick: true,
    rippleDuringDrag: false,
    membraneWaveOnPress: true,
    membraneWaveDuringDrag: false,
    interactionProfile: 'Custom',
  };
}

export function snapshotLab(engine, labState) {
  return {
    ...engine.createSnapshot(),
    probe: labState.probe,
    panelOpen: labState.panelOpen,
    rippleOnClick: labState.rippleOnClick,
    rippleDuringDrag: labState.rippleDuringDrag,
    membraneWaveOnPress: labState.membraneWaveOnPress,
    membraneWaveDuringDrag: labState.membraneWaveDuringDrag,
    interactionProfile: labState.interactionProfile,
  };
}

export function applyLabSnapshot(engine, labState, saved, options = {}) {
  const result = engine.restoreSnapshot(saved, options);
  if (!result.ok) return false;
  labState.probe = saved.probe === true;
  if (typeof saved.panelOpen === 'boolean') labState.panelOpen = saved.panelOpen;
  if (typeof saved.rippleOnClick === 'boolean') labState.rippleOnClick = saved.rippleOnClick;
  if (typeof saved.rippleDuringDrag === 'boolean') {
    labState.rippleDuringDrag = saved.rippleDuringDrag;
  }
  if (typeof saved.membraneWaveOnPress === 'boolean') {
    labState.membraneWaveOnPress = saved.membraneWaveOnPress;
  }
  if (typeof saved.membraneWaveDuringDrag === 'boolean') {
    labState.membraneWaveDuringDrag = saved.membraneWaveDuringDrag;
  }
  if (['Qwen-like', 'Mobile-like', 'Custom'].includes(saved.interactionProfile)) {
    labState.interactionProfile = saved.interactionProfile;
  } else if (saved.interactions) {
    // Phase 3A-D snapshots predate named profiles and may contain arbitrary
    // accepted settings. Preserve them and label them honestly.
    labState.interactionProfile = 'Custom';
  }
  return true;
}

export function loadLabSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLabState(engine, labState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotLab(engine, labState)));
  } catch {
    // Persistence is optional; rendering must continue when storage is blocked.
  }
}

export function clearLabState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function resetLabUiState(labState) {
  labState.probe = false;
  labState.panelOpen = true;
  labState.panelCollapsed = {};
  labState.rippleOnClick = true;
  labState.rippleDuringDrag = false;
  labState.membraneWaveOnPress = true;
  labState.membraneWaveDuringDrag = false;
  labState.interactionProfile = 'Custom';
}
