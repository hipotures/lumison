export const MAX_TRANSIENT_CAPACITY = 16;
export const DEFAULT_TRANSIENT_CAPACITY = MAX_TRANSIENT_CAPACITY;

function inactiveEntry(index) {
  return {
    active: false,
    slot: index,
    sequence: 0,
    type: '',
    position: { x: 0, y: 0 },
    radius: 0,
    strength: 0,
    age: 0,
    lifetime: 0,
    parameters: {},
  };
}

export function createTransientStore(capacity = DEFAULT_TRANSIENT_CAPACITY) {
  const requested = Number.isInteger(capacity) && capacity > 0
    ? capacity
    : DEFAULT_TRANSIENT_CAPACITY;
  const size = Math.min(requested, MAX_TRANSIENT_CAPACITY);
  return {
    capacity: size,
    nextSequence: 0,
    entries: Array.from({ length: size }, (_, index) => inactiveEntry(index)),
  };
}

export function addTransientEvent(store, event) {
  const validation = validateEvent(event);
  if (!validation.ok) return { accepted: false, reason: validation.reason, slot: null, evicted: null };

  let slot = store.entries.findIndex((entry) => !entry.active);
  let evicted = null;
  if (slot < 0) {
    // Oldest allocation wins eviction. Slot index resolves the impossible tie
    // deterministically after imported/runtime snapshots.
    slot = 0;
    for (let index = 1; index < store.entries.length; index++) {
      const candidate = store.entries[index];
      const selected = store.entries[slot];
      if (candidate.sequence < selected.sequence
        || (candidate.sequence === selected.sequence && index < slot)) slot = index;
    }
    evicted = {
      ...store.entries[slot],
      position: { ...store.entries[slot].position },
      parameters: { ...store.entries[slot].parameters },
    };
  }

  const value = validation.value;
  const sequence = store.nextSequence++;
  store.entries[slot] = {
    active: true,
    slot,
    sequence,
    type: value.type,
    position: { ...value.position },
    radius: value.radius,
    strength: value.strength,
    age: 0,
    lifetime: value.lifetime,
    parameters: { ...value.parameters },
  };
  return { accepted: true, reason: null, slot, sequence, evicted };
}

export function advanceTransientStore(store, dt, { paused = false } = {}) {
  if (paused || !(typeof dt === 'number' && Number.isFinite(dt)) || dt <= 0) return store;
  for (let index = 0; index < store.entries.length; index++) {
    const entry = store.entries[index];
    if (!entry.active) continue;
    entry.age += dt;
    if (entry.age >= entry.lifetime) store.entries[index] = inactiveEntry(index);
  }
  return store;
}

export function activeTransientCount(store) {
  return store.entries.reduce((count, entry) => count + (entry.active ? 1 : 0), 0);
}

export function snapshotTransientStore(store) {
  return {
    capacity: store.capacity,
    nextSequence: store.nextSequence,
    entries: store.entries.map((entry) => ({
      ...entry,
      position: { ...entry.position },
      parameters: { ...entry.parameters },
    })),
  };
}

export function restoreTransientStore(saved) {
  if (!saved || !Number.isInteger(saved.capacity) || saved.capacity <= 0
    || saved.capacity > MAX_TRANSIENT_CAPACITY
    || !Number.isSafeInteger(saved.nextSequence) || saved.nextSequence < 0
    || !Array.isArray(saved.entries) || saved.entries.length !== saved.capacity) return null;
  const store = createTransientStore(saved.capacity);
  store.nextSequence = saved.nextSequence;
  let maximumSequence = -1;
  for (let index = 0; index < saved.entries.length; index++) {
    const entry = saved.entries[index];
    if (!entry?.active) continue;
    const validation = validateEvent({ ...entry, lifetime: entry.lifetime });
    if (!validation.ok || !(typeof entry.age === 'number' && Number.isFinite(entry.age)
      && entry.age >= 0 && entry.age < entry.lifetime)
      || !Number.isSafeInteger(entry.sequence) || entry.sequence < 0) return null;
    maximumSequence = Math.max(maximumSequence, entry.sequence);
    store.entries[index] = {
      active: true,
      slot: index,
      sequence: entry.sequence,
      type: validation.value.type,
      position: { ...validation.value.position },
      radius: validation.value.radius,
      strength: validation.value.strength,
      age: entry.age,
      lifetime: validation.value.lifetime,
      parameters: { ...validation.value.parameters },
    };
  }
  if (store.nextSequence <= maximumSequence) return null;
  return store;
}

function validateEvent(event) {
  if (!event || typeof event !== 'object') return { ok: false, reason: 'event-must-be-an-object' };
  const values = [event.position?.x, event.position?.y, event.radius, event.strength, event.lifetime];
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    return { ok: false, reason: 'event-values-must-be-finite' };
  }
  if (event.radius < 0 || event.strength < 0 || event.lifetime <= 0) {
    return { ok: false, reason: 'event-radius-strength-and-lifetime-out-of-range' };
  }
  const parameters = event.parameters ?? {};
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return { ok: false, reason: 'event-parameters-must-be-an-object' };
  }
  const parameterEntries = Object.entries(parameters);
  if (parameterEntries.length > 16
    || parameterEntries.some(([name, value]) => !name
      || typeof value !== 'number' || !Number.isFinite(value))) {
    return { ok: false, reason: 'event-parameters-must-be-finite-numbers' };
  }
  return {
    ok: true,
    value: {
      type: typeof event.type === 'string' && event.type ? event.type : 'excitation',
      position: { x: event.position.x, y: event.position.y },
      radius: event.radius,
      strength: event.strength,
      lifetime: event.lifetime,
      parameters: Object.fromEntries(parameterEntries),
    },
  };
}
