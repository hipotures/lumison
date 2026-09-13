const STORAGE_KEY = 'thin-film-lab.v1';

export function addLabState(state) {
  state.probe = false;
  state.panelOpen = true;
  state.panelCollapsed = {};
  return state;
}

export function snapshotLab(engine, state) {
  return {
    ...engine.createSnapshot(),
    probe: state.probe,
    panelOpen: state.panelOpen,
  };
}

export function applyLabSnapshot(engine, state, saved, options = {}) {
  if (!engine.restoreSnapshot(saved, options)) return false;
  state.probe = saved.probe === true;
  if (typeof saved.panelOpen === 'boolean') state.panelOpen = saved.panelOpen;
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

export function saveLabState(engine, state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotLab(engine, state)));
  } catch {
    // Persistence is optional; rendering must continue when storage is blocked.
  }
}

export function clearLabState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function resetLabUiState(state) {
  state.probe = false;
  state.panelOpen = true;
  state.panelCollapsed = {};
}
