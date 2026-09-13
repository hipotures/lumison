// TFL Lab policy for translating an active browser gesture into source-neutral
// event origins. This module deliberately has no DOM or engine dependency so
// click and distance-spaced drag behavior can be tested deterministically.

export const RIPPLE_DRAG_SPACING = 0.075;

export function createRippleTriggerPolicy(configuration = {}) {
  const state = {
    configuration: {
      clickEnabled: configuration.clickEnabled !== false,
      dragEnabled: configuration.dragEnabled === true,
      spacing: finitePositive(configuration.spacing)
        ? configuration.spacing
        : RIPPLE_DRAG_SPACING,
    },
    engaged: false,
    lastPosition: { x: 0, y: 0 },
    distanceSinceEvent: 0,
  };

  return {
    configure(changes = {}) {
      if (typeof changes.clickEnabled === 'boolean') {
        state.configuration.clickEnabled = changes.clickEnabled;
      }
      if (typeof changes.dragEnabled === 'boolean') {
        state.configuration.dragEnabled = changes.dragEnabled;
      }
      if (finitePositive(changes.spacing)) state.configuration.spacing = changes.spacing;
      return { ...state.configuration };
    },

    begin(position) {
      if (!finitePoint(position)) return [];
      state.engaged = true;
      state.lastPosition = { ...position };
      state.distanceSinceEvent = 0;
      return state.configuration.clickEnabled ? [{ ...position }] : [];
    },

    move(position) {
      if (!state.engaged || !finitePoint(position)) return [];
      const from = state.lastPosition;
      const dx = position.x - from.x;
      const dy = position.y - from.y;
      const segmentLength = Math.hypot(dx, dy);
      state.lastPosition = { ...position };
      if (!state.configuration.dragEnabled || segmentLength <= 1e-12) return [];

      const result = [];
      const spacing = state.configuration.spacing;
      let distanceToEvent = spacing - state.distanceSinceEvent;
      while (distanceToEvent <= segmentLength + 1e-12) {
        const fraction = Math.min(1, distanceToEvent / segmentLength);
        result.push({ x: from.x + dx * fraction, y: from.y + dy * fraction });
        distanceToEvent += spacing;
      }
      state.distanceSinceEvent = (state.distanceSinceEvent + segmentLength) % spacing;
      if (state.distanceSinceEvent < 1e-12 || spacing - state.distanceSinceEvent < 1e-12) {
        state.distanceSinceEvent = 0;
      }
      return result;
    },

    end() {
      state.engaged = false;
      state.distanceSinceEvent = 0;
    },

    snapshot() {
      return {
        configuration: { ...state.configuration },
        engaged: state.engaged,
        lastPosition: { ...state.lastPosition },
        distanceSinceEvent: state.distanceSinceEvent,
      };
    },
  };
}

function finitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finitePoint(value) {
  return typeof value?.x === 'number' && Number.isFinite(value.x)
    && typeof value?.y === 'number' && Number.isFinite(value.y);
}
