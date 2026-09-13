# TFL Engine control contract

## Scope

This document defines the Phase 2 source-neutral control boundary. The compatibility target is the Phase 1 commit `f7e15a4c458293c9925139887a984ca5034de50f`, tagged `tfl-fixed-baseline`. Phase 2 changes state and input plumbing only. It does not add Qwen or Mobile behavior and does not intentionally change Fixed's material graph, optical output, lighting, presets or interaction gains.

The source-neutral entry point is `packages/tfl-engine/src/index.js`. The browser-only rendering integration is `packages/tfl-engine/src/browser.js`; it is the one package boundary that accepts canvas elements. DOM events, viewport rectangles, screen coordinates, local storage and animation-frame scheduling remain in TFL Lab.

## Canonical surface coordinates

Engine space uses this convention:

- The origin is the center of the displayed surface.
- Positive x points right and positive y points up.
- One surface unit equals the logical viewport height.
- The vertical extent is always `[-0.5, 0.5]`.
- For aspect ratio `a = width / height`, the horizontal extent is `[-a/2, a/2]`.
- Radius uses surface units. Velocity uses surface units per second.
- Drawing-buffer resolution, device-pixel ratio and adaptive render scale do not affect this space.

TFL Lab first normalizes a browser position to `nx` from left to right and `ny` from top to bottom, then applies:

```text
x = (nx - 0.5) * aspect
y = 0.5 - ny
```

The input adapter clamps the final position to the displayed surface. It keeps logical normalized position separately so a resize can rebuild canonical x under the new aspect without treating the basis change as source motion.

The Fixed shader still consumes historical UV. The explicit compatibility conversion immediately before rendering is:

```text
fixedU  = x / aspect + 0.5
fixedV  = y + 0.5
fixedVx = velocityX / aspect
fixedVy = velocityY
```

This reconstructs the values previously produced by the Fixed pointer adapter. The shader continues to perform its existing aspect metric and doubled field-coordinate conversion.

## Canonical velocity

Velocity is displacement divided by elapsed seconds in canonical surface space. Event-to-event displacement is never exposed as velocity. Invalid or zero elapsed time retains the previous velocity. The estimator bounds elapsed time to 0.004–0.08 seconds to preserve Fixed's protection against duplicate and stale browser samples.

Smoothing uses an exponential response:

```text
amount = 1 - exp(-32.68363052650032 * dt)
```

This equals Fixed's historical 0.42 blend at 60 events per second while making steady motion converge consistently at other event frequencies. The TFL Lab compatibility adapter retains Fixed's component clamp of ±3 UV/s by expressing it canonically as ±`3 * aspect` on x and ±3 on y. The renderer then converts it back with the formulas above. This clamp is compatibility policy in the Lab adapter, not the canonical velocity definition.

## Thickness units

Nanometres are the engine's thickness unit. In the current Fixed profile:

- `filmBase` is a literal base thickness in nm.
- The rendered thickness remains `filmBase + (field - 0.55) * 950 * thickVar` nm.
- `950 nm` is Fixed's artistic field-to-thickness gain.
- `34 nm` remains the optical lower bound.
- `thickVar` is dimensionless artistic variation, not a thickness in nm.
- `drainage`, `tension`, `warp`, `turbulence`, `fineDetail` and related field controls are normalized artistic coefficients.
- `interf`, `spread`, `fresnel`, lighting strengths and grading controls are artistic response parameters.

The field is procedural and does not claim to be a physical fluid solver. No Mobile or Qwen numeric value is converted in Phase 2.

## Parameter state model

Every numeric parameter has four explicit values:

| Layer | Meaning |
| --- | --- |
| `requested` | Validated, bounded value requested by a scene or controller. |
| `target` | Destination after engine constraints. Fixed currently has no cross-parameter constraints, so it equals `requested`. |
| `current` | Value used after Fixed's existing `min(1, dt * 3.2)` smoothing. |
| `effective` | Runtime value actually applied after backend or budget policy. It normally equals `current`; `renderScale` may differ under adaptation. |

Requested render scale is the user's budget ceiling. Adaptive scale is maintained separately, and `effective.renderScale` reports the scale sent to the browser rendering host. Requested and effective quality are likewise separate engine diagnostics, although Fixed adaptation still changes scale only.

## Parameter transactions and locks

`setParameters(changes, options)` is the authoritative numeric write path. Sliders, single resets, presets, Mutate, Randomize, normal Reset and snapshot import all call the same transaction implementation. A report contains `accepted`, `skipped` and `rejected` entries plus `ok`, `changed` and `source`.

- Unknown names and non-finite values are rejected.
- Finite out-of-range values are accepted after schema clamping and marked `clamped` in the report.
- Locked parameters are skipped without consuming a normal write.
- Accepted values update `requested` and `target`; normal writes retain Fixed smoothing.
- Immediate transition is used for initial baseline setup, factory reset and validated restore, where the historical application already settled current values immediately.
- Fixed has no cross-parameter index or ordering constraint. Future constraints belong inside this path rather than in callers.

Locks remain strict for GUI edits, presets, Mutate, Randomize, normal Reset, imports and future source-neutral controllers. Locking a parameter settles its current value to its target, matching Fixed. A normal caller has no generic force option. Factory Reset is the explicit operation that replaces state, clears locks, restores seeds and reloads Soap Film.

## Clocks and pause

`advance(dt)` is the only engine time advance. It accepts explicit seconds and does not read wall-clock time. TFL Lab owns `requestAnimationFrame`, validates its frame delta and supplies the adaptive-controller timestamp separately to `render()`.

| Clock | Advancement while running | Phase 2 use |
| --- | --- | --- |
| `animation` | `dt * temporal` | Drives Fixed's unchanged single `uTime` uniform. |
| `flow` | `dt * temporal * flowSpeed` | Canonical diagnostic/replay clock; not wired into Fixed field math yet. |
| `lighting` | `dt * temporal * lightMotion` | Canonical diagnostic/replay clock; not wired into Fixed lighting math yet. |
| `events` | `dt` | Ages future transient events independently of visual temporal rate. |

Pause freezes all four clocks and transient-event ages. Parameter smoothing continues while paused, preserving Fixed control behavior. TFL Lab's continuous influence strength and velocity release also continues while paused, preserving Fixed's release behavior. Resume continues from the stored clocks with no wall-time catch-up.

The Fixed material still multiplies its animation time by the current flow and light rates internally. Using the separately integrated clocks in that shader would change phase during parameter transitions, so that visual change is deliberately deferred.

## Spatial influence

The engine stores one continuous source-neutral descriptor for the current Fixed compatibility path:

```js
{
  id,
  position: { x, y },
  velocity: { x, y },
  radius,
  strength,
  engaged,
  positionValid
}
```

`position` and `radius` use surface units; `velocity` uses surface units per second. `strength` is a nonnegative response amplitude. `engaged` expresses an active continuous source without naming a mouse button. `positionValid` allows Surface Probe to distinguish a located source from one outside the view.

`setSpatialInfluence()` validates and copies this descriptor. TFL Lab translates pointer enter/down/move/up/leave into it and retains Fixed's attack, release and velocity-decay rates. Hover provides a position for the probe but strength stays zero, so it creates no visual disturbance. The Fixed compatibility layer converts the descriptor to the existing shader uniforms. Phase 2 does not add passive warp, press profiles, shear controls or new ripples.

## Bounded transient events

The neutral transient store has a default finite capacity of 16. Entries are explicitly active or inactive and contain type, canonical position, radius, strength, age, lifetime and allocation sequence.

- Allocation selects the lowest inactive slot first.
- When full, it evicts the event with the oldest allocation sequence; slot index resolves a tie.
- Age advances deterministically from explicit `dt` while running.
- An entry becomes inactive when `age >= lifetime`.
- Pause freezes age.
- Invalid, infinite or nonpositive lifetime data is rejected.

The store is infrastructure only in Phase 2. Its entries do not affect Fixed rendering. This avoids both Qwen's faulty slot selection and Aggressive's capacity/loop mismatch before their visual mechanisms are considered.

## Seeds and replay

The state separates a Fixed visual seed, a mutation/randomization seed and transient allocation sequence. The current Fixed shader retains its hard-coded deterministic hashes; the visual seed is recorded but intentionally not wired to the shader because doing so would change the baseline. Mutate and Randomize use a counter-based seeded sequence unless a test or caller supplies an explicit random function. Event allocation owns a separate sequence.

Given the same initial snapshot, seeds, parameter transactions, influence/event sequence and `dt` sequence, the source-neutral state evolves identically. This is state replay, not a claim of pixel-identical GPU output across backends.

## Snapshot policy

Snapshot schema version 2 stores requested/target parameters, locks, scene/render configuration, seeds and mutation sequence. Version 1 Phase 1 snapshots are accepted and migrated. Invalid known parameter values reject the snapshot before changing live state; unknown historical keys are ignored.

Normal configuration snapshots exclude clocks, `current`, `effective`, continuous influence and transient events. Applying one immediately settles validated parameter values as Fixed import/restore already did, respects live locks when `preserveLocks` is selected, and leaves live pause, clocks, influence and events alone.

`createSnapshot({ includeRuntime: true })` explicitly adds current/effective values, clocks, pause, influence, transient store, viewport aspect, adaptive scale and effective quality. `restoreSnapshot(..., { restoreRuntime: true })` restores that state for deterministic replay and testing. TFL Lab persistence uses the normal configuration form.

## Public boundary

The main `TflEngine` surface now covers:

- lifecycle: `initialize`, `dispose`
- validated controls: `setParameter`, `setParameters`, `applyPreset`, `mutate`, `randomize`, `reset`, `factoryReset`, locks and render settings
- time: `advance`, `setPaused`, `togglePaused`
- spatial control: `setViewport`, `setSpatialInfluence`, `clearSpatialInfluence`
- timed infrastructure: `emitTransientEvent`, `clearTransientEvents`
- rendering budget: quality, MSAA, adaptive mode, target FPS and `render`
- inspection: `diagnostics`, `sampleSurface`
- state transfer: configuration and optional runtime snapshots

The controller accepts a rendering-host interface rather than canvases. TFL Lab creates the browser host with its DOM canvases, then supplies that host to the engine. TFL Lab keeps `probe`, panel visibility and panel-collapse preferences in a separate application-state object; they are no longer properties of engine state. The UI reads engine state but sends every numeric change back through engine methods. The engine controller and its state/spatial/clock/event modules contain no PointerEvent, mouse-button, localStorage, keyboard, touch, MIDI or piano concepts.

Diagnostics expose canonical influence values, all clocks, requested/current/effective scale, active transient count, lock count and the last transaction counts. `frameMs` remains the smoothed application frame interval; it is not labelled as GPU execution time.

## Fixed compatibility seam and Phase 3 boundary

No shader formula or constant changes in Phase 2. `film.js` remains byte-identical to the tagged baseline. Renderer plumbing reads `clocks.animation` where it previously read `simTime`; both advance with the same Fixed formula. Browser rendering maps the canonical descriptor back to historical Fixed UV and UV/s immediately before uniform upload and Canvas fallback drawing.

Phase 3 must intentionally add and independently gate passive warp, active spatial displacement, shear controls and timed ripple effects. It must decide how canonical flow/lighting clocks replace the Fixed master-clock multiplication, reconcile displaced normal sampling, and use transient events visually. None of those changes is present or enabled here.
