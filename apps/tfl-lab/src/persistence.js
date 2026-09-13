const STORAGE_KEY = 'thin-film-lab.v1';

export function createLabState() {
  return {
    probe: false,
    panelOpen: true,
    panelCollapsed: {},
  };
}

export function snapshotLab(engine, labState) {
  return {
    ...engine.createSnapshot(),
    probe: labState.probe,
    panelOpen: labState.panelOpen,
  };
}

export function applyLabSnapshot(engine, labState, saved, options = {}) {
  const result = engine.restoreSnapshot(saved, options);
  if (!result.ok) return false;
  labState.probe = saved.probe === true;
  if (typeof saved.panelOpen === 'boolean') labState.panelOpen = saved.panelOpen;
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
}
