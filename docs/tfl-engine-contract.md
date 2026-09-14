# TFL Engine control contract

## Scope

This document defines the Phase 2 source-neutral control boundary and the optional spatial-deformation extensions through Phase 3D. The compatibility target is the Phase 1 commit `f7e15a4c458293c9925139887a984ca5034de50f`, tagged `tfl-fixed-baseline`. Phase 3A adds Qwen-inspired passive motion displacement, Phase 3B adds independently gated active press and drag displacement, Phase 3C adds active coordinate shear, and Phase 3D adds timed ripple coordinate displacement. All new responses default off; the historical Fixed response defaults on. These phases add no Qwen ripple thickness or glow, cellular behavior, Mobile behavior, or intentional optical, lighting or preset change.

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

Pause freezes all four clocks and transient-event ages. Parameter smoothing continues while paused, preserving Fixed control behavior. TFL Lab's continuous influence strength and velocity release continues while paused, as do the passive and active response releases driven by explicit `dt`. Resume continues from the stored clocks with no wall-time catch-up.

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

`setSpatialInfluence()` validates and copies this descriptor. TFL Lab translates pointer enter/down/move/up/leave into it and retains Fixed's attack, release and velocity-decay rates. Hover provides a position for the probe and for the optional Phase 3A motion response; its active `strength` target stays zero. `engaged` is the source-neutral gate used by Phase 3B. The Fixed compatibility layer converts the descriptor to the existing shader uniforms.

## Optional motion warp (Phase 3A)

`setMotionWarp({ enabled, gain, radius })` configures one response to the existing continuous spatial influence. The engine concept is motion-driven domain displacement: it has no mouse, hover, button or `PointerEvent` semantics. TFL Lab labels the response **Passive Warp** because its browser adapter supplies canonical motion even when no button is pressed.

| Setting | Unit/range | Default |
| --- | --- | --- |
| `enabled` | boolean | `false` |
| `gain` | dimensionless, 0–2 | `1` |
| `radius` | canonical surface units, 0.03–0.5 | `0.19` |

Configuration is separate from scene parameters and their locks. Presets, Mutate, Randomize and normal Reset do not alter it. Factory Reset returns it to the disabled defaults. Configuration snapshots include it under `interactions.motionWarp`, allowing TFL Lab persistence/export to retain the explicit choice.

The response derives only from canonical speed and direction. It does not reuse Qwen V1's event-count-dependent motion strength:

```text
drive = smoothstep(0.04, 1.5, length(velocity))
targetDisplacement = normalize(velocity) * 0.04 * gain * drive
response = exponential approach(targetDisplacement, 18/s attack or 6/s release)
localDisplacement = response * exp(-distance² / radius²)
```

Velocity is in surface units/second and displacement/radius are in surface units. `0.04` bounds the default maximum displacement to four percent of viewport height; gain 2 permits at most eight percent. The speed bounds and displacement cap deliberately translate, rather than copy, Qwen's `velocity * strength * 0.5 * pointerGain` formula because its strength accumulated per browser event.

The Fixed shader's structural coordinate has twice the canonical extent. The renderer therefore adds `2 * localDisplacement` to that coordinate **before** Fixed flow scale, vortices, nested domain warp and thickness generation. This moves the complete structural field, including the Flow diagnostic. It adds no scalar thickness, interference, glow, specular, lighting or explicit normal term. Normal formulas remain Fixed-compatible in Phase 3A.

`advance(dt)` updates the response deterministically. A stationary or absent influence sets the target displacement to zero, and the stored vector decays smoothly. Like Fixed's existing influence release, this response continues to decay while animation clocks are paused; it never reads wall-clock time. Disabling the response or setting gain to zero clears the displacement immediately, making OFF the explicit compatibility path.

Diagnostics report the configured gain/radius, source speed, canonical displacement vector and its `effectiveStrength` magnitude after decay. Canvas2D fallback reports motion warp as unsupported; it does not fake domain movement with color or glow. Use the GPU Flow or Thickness view to assess structural movement. Surface Probe remains an approximate CPU mirror and does not reproduce this displacement.

## Active press and drag deformation (Phase 3B)

`setActiveDeformation(changes)` configures two responses to an engaged continuous spatial influence and controls whether the archived Fixed response reaches the renderer. The engine still receives only `position`, `velocity`, `strength`, `engaged` and related canonical influence fields. TFL Lab decides that a primary browser press sets `engaged`; the engine has no mouse-button or DOM concept.

| Setting | Unit/range | Default |
| --- | --- | --- |
| `legacyFixedEnabled` | boolean | `true` |
| `pressEnabled` | boolean | `false` |
| `pressGain` | signed dimensionless, −2–2 | `1` |
| `dragEnabled` | boolean | `false` |
| `dragGain` | dimensionless, 0–2 | `1` |
| `radius` | canonical surface units, 0.03–0.5 | `0.19` |

The active amplitude is `clamp(strength / 1.55, 0, 1)` only while the influence is both located and engaged. An inactive influence therefore has zero target press and drag response, even if its velocity still represents passive motion. The stored responses release smoothly after disengagement and remain anchored at the last active position until their magnitudes settle to zero.

Active Press produces a signed radial sample-coordinate offset:

```text
pressTarget = 0.075 * pressGain * activeAmplitude
pressResponse = exponential approach(pressTarget, 18/s attack or 7/s release)
radialSampleOffset = -normalize(samplePosition - influencePosition) * pressResponse
```

Positive gain samples toward the influence center; negative gain reverses the radial direction. This sign is explicit in the Lab control. The radial vector is zero exactly at the center and is multiplied by the shared Gaussian envelope.

Active Drag converts canonical speed to bounded displacement:

```text
drive = smoothstep(0.05, 2.0, length(velocity))
dragTarget = normalize(velocity) * 0.08 * dragGain * activeAmplitude * drive
dragResponse = exponential approach(dragTarget, 20/s attack or 7/s release)
dragSampleOffset = -dragResponse
localSampleOffset = (dragSampleOffset + radialSampleOffset)
                    * exp(-distance² / radius²)
```

`dragResponse` points in the requested visible material-motion direction. Rendering uses inverse sampling, so it subtracts that vector from the field coordinate; a feature then moves in the same direction as the canonical velocity. This distinction avoids presenting a same-sign UV offset that would move visible landmarks opposite to the drag.

The Fixed structural coordinate spans twice the canonical extent, so the renderer multiplies `localSampleOffset` by two. It applies the result before Fixed flow scale, vortices, nested domain warp and procedural thickness generation. The Flow and Thickness diagnostic views therefore show structural landmark movement. The new code adds no scalar thickness, normal tilt, glow, light or color response. Existing normal taps evaluate the shifted structural coordinate but do not add a new deformation-Jacobian normal model.

`legacyFixedEnabled` gates the complete existing Fixed input to its shader and Canvas fallback: late velocity push, thickness dent, scalar ripple/shear and explicit normal tilt remain in source but receive zero influence when the gate is off. This provides a direct comparison with the new spatial responses. The Lab's **Fixed baseline** interaction profile disables the optional mechanisms and enables the legacy response. Default configuration already has that compatibility behavior.

Active configuration is independent of motion-warp configuration, scene parameters and parameter locks. Presets, Mutate, Randomize and normal Reset do not change it. Factory Reset restores legacy Fixed on, both new active responses off, gains 1 and radius 0.19. Disabling an active component or setting its gain to zero clears that component immediately. Canvas2D reports active spatial deformation as unavailable. Surface Probe mirrors only the gated legacy approximation; it does not reproduce the new GPU displacement.

## Active coordinate shear (Phase 3C)

`setCoordinateShear(changes)` configures a third active spatial response independently of Passive Warp, Active Press, Active Drag translation and the legacy Fixed response. It consumes the same source-neutral continuous influence and is driven only when that influence is located and engaged. TFL Lab supplies those semantics; the engine still receives no pointer event, mouse button or DOM state.

| Setting | Unit/range | Default |
| --- | --- | --- |
| `enabled` | boolean | `false` |
| `gain` | dimensionless, 0–2 | `1` |

Coordinate Shear deliberately reuses Active Deformation's canonical `radius` setting (0.03–0.5 surface units). There is one local active interaction footprint, while each response retains an independent enable and gain. The configuration remains separate from scene parameters and their locks. Presets, Mutate, Randomize and normal Reset do not alter it; Factory Reset disables it and restores gain 1.

The response converts canonical velocity in surface units per second to a bounded vector:

```text
activeAmplitude = clamp(strength / 1.55, 0, 1)
drive = smoothstep(0.05, 2.0, length(velocity))
shearTarget = normalize(velocity) * 0.12 * gain * activeAmplitude * drive
shearResponse = exponential approach(shearTarget, 20/s attack or 7/s release)
```

Zero or near-zero speed produces a zero target before normalization. The maximum coefficient is 0.12 canonical surface units at gain 1 (0.24 at gain 2). The response remains anchored at the last driven position during release and advances only from explicit `advance(dt)`, including its Fixed-compatible release while animation clocks are paused.

For canonical local coordinates `q = samplePosition - influencePosition` and shared radius `r`, the CPU reference and shader apply this localized off-diagonal inverse-sampling transform:

```text
falloff = exp(-dot(q, q) / r²)
cross = clamp((q.y, q.x) / r, -1, 1)
sampleOffset = -(shearResponse.x * cross.x,
                 shearResponse.y * cross.y) * falloff
```

Thus horizontal motion makes sampled X depend on local Y, vertical motion makes sampled Y depend on local X, and diagonal motion combines both terms into a skew/stretch. Reversing canonical velocity negates the response and therefore negates the transform. The cross coordinates, speed drive, response coefficient and Gaussian footprint are bounded; the transform is exactly zero at the center and finite at the radius edge.

The Fixed structural coordinate has twice the canonical extent, so rendering multiplies `sampleOffset` by two and adds it before Fixed flow scale, vortices, nested domain warp and procedural thickness. This moves structural landmarks in Flow and Thickness diagnostic views. It is separate from Active Drag's locally uniform translation and from Fixed's late `dragShear`, which remains a scalar thickness term. Coordinate Shear adds no thickness, explicit normal tilt, interference, glow, lighting or color term. Existing normal taps receive the transformed structural coordinate, but Phase 3C does not introduce a deformation-Jacobian normal model.

Canvas2D reports Coordinate Shear as unavailable instead of imitating it with color. Surface Probe remains an approximate Fixed CPU probe and does not reproduce the GPU transform. Diagnostics expose enable/gain, shared radius, canonical source velocity and speed, response vector and effective magnitude.

## Bounded transient events

The neutral transient store has a fixed maximum and default capacity of 16; constructors may request a smaller capacity for focused tests. Entries are explicitly active or inactive and contain type, canonical position, radius, strength, age, lifetime, allocation sequence and an optional flat map of finite numeric event parameters.

- Allocation selects the lowest inactive slot first.
- When full, it evicts the event with the oldest allocation sequence; slot index resolves a tie.
- Age advances deterministically from explicit `dt` while running.
- An entry becomes inactive when `age >= lifetime`.
- Pause freezes age.
- Invalid, infinite or nonpositive lifetime data is rejected.

The store was infrastructure only in Phase 2. Phase 3D consumes entries of type `ripple-displacement`; Phase 3E independently consumes `membrane-wave`. The production store remains one shared 16-slot pool. Each mechanism filters those entries into a matching 16-slot renderer packet, and its statically unrolled TSL loop uses that same capacity. Smaller stores remain available to source-neutral tests and are padded with inactive render entries. This avoids both Qwen V1's allocator, which could overwrite an active slot while inactive slots existed, and Aggressive's four-entry storage/six-iteration mismatch.

## Timed ripple displacement (Phase 3D)

`setRippleDisplacement({ enabled, gain })` configures the spatial ripple response. Its default is `{ enabled: false, gain: 1 }`; gain is validated in the range 0–2. Configuration is independent of parameters, locks, presets and the continuous mechanisms from Phases 3A–3C. Normal Reset, presets, Mutate and Randomize do not alter it. Factory Reset disables it, restores gain 1 and clears transient events. The **Fixed baseline** Lab profile also disables it.

TFL Lab creates a source-neutral descriptor with `createRippleDisplacementEvent()` and submits it through the existing `emitTransientEvent()` boundary. The stored event has an immutable canonical `position` as its origin plus these semantics:

| Field | Unit/default | Meaning |
| --- | --- | --- |
| `strength` / amplitude | dimensionless, 1 | Per-event wave amplitude. |
| `age` | seconds, 0 at allocation | Advanced from explicit engine `dt`. |
| `lifetime` | seconds, 2.4 | Finite interval before the slot becomes inactive. |
| `parameters.wavelength` | surface units, 0.11 | Radial carrier wavelength. |
| `parameters.propagationSpeed` | surface units/second, 0.28 | Wave-front speed. |
| `parameters.width` | surface units, 0.10 | Gaussian width around the moving front. |
| `parameters.displacementGain` | dimensionless, 1 | Per-event spatial gain, independent of the global gain. |
| `radius` | surface units, derived | Maximum intended footprint: `speed * lifetime + 2 * width`. |

These defaults translate Qwen V1's travelling phase `sin(distance * 46 - age * 7.4)` into canonical units. They do not copy Qwen's constants literally: Phase 3D uses an explicit localized front and finite smooth envelope. For sample position `p`, event origin `o`, distance `d = length(p-o)` and age `a`:

```text
frontRadius = propagationSpeed * a
fromFront = d - frontRadius
phase = 2π * fromFront / wavelength
frontEnvelope = exp(-fromFront² / (2 * width²))
lifetimeFade = (1 - clamp(a / lifetime, 0, 1))²
eventOffset = normalize(p-o) * sin(phase) * frontEnvelope * lifetimeFade
              * 0.018 * globalGain * amplitude * eventDisplacementGain
```

The direction is defined as zero at the exact origin. Contributions from all active events add independently, then their combined magnitude is capped at 0.09 surface units. Rendering converts the result to Fixed's doubled field extent and applies it before flow scale, vortices, nested domain warp and thickness construction. Flow and Thickness diagnostics therefore receive displaced structural landmarks. Phase 3D adds no scalar thickness oscillation, interference term, emission, glow, light or explicit normal response. Existing Fixed pointer ripple/thickness behavior remains part of the separately gated legacy response.

Event age advances on the Phase 2 transient-event clock and never from frame count or wall time. Pause freezes the event clock and ages; resume continues without catch-up. Expiration occurs at `age >= lifetime`. The origin never follows the continuous influence after allocation, and several events retain independent positions, ages and parameters. Identical initial state, allocation sequence and `dt` sequence reproduce the same event and CPU reference displacement state.

The Lab owns trigger policy. **Ripple on Click** emits one event at active engagement. **Ripples During Drag** emits interpolated origins every 0.075 canonical surface units along the travelled path, so a low browser event frequency does not collapse the trail onto the latest position. Both trigger toggles are Lab persistence state and create events only while Ripple Displacement is enabled. The engine receives no click, drag, pointer or DOM semantics.

Diagnostics expose ripple enable/gain, active ripple count and the 16-slot render capacity. Canvas2D reports the mechanism as unavailable rather than imitating it with color. Surface Probe remains the approximate Fixed CPU probe and does not reproduce the GPU transform; use Flow or Thickness view for manual structural verification.

## Broad membrane response (Phase 3E)

`setMembraneResponse(changes)` configures an analytic response inspired by [Mobile 2.2](../tmp/thin_film_lab_v2_2_mobile.html). Its default is disabled, so the accepted Phase 3D path is unchanged. The configuration is independent of the Fixed legacy response, Passive Warp, Active Press/Drag, Coordinate Shear and Qwen Ripple Displacement. No Mobile optical, palette, touch, motion-sensor, UI or backend code is part of this mechanism.

| Setting | Range/default | Meaning |
| --- | --- | --- |
| `enabled` | boolean, `false` | Gates the complete continuous and timed membrane mechanism. |
| `radialGain` | −2–2, `1` | Signed broad radial coordinate displacement. |
| `tangentialGain` | −2–2, `1` | Signed tangential coordinate displacement; positive is counter-clockwise in canonical y-up space. |
| `radius` | 0.12–0.9 su, `0.48` | Gaussian radius of the continuous response. |
| `waveEnabled` | boolean, `true` | Allows `membrane-wave` events while the main mechanism is enabled. |
| `waveGain` | 0–2, `1` | Global spatial gain for membrane waves. |

The continuous response uses only an engaged source-neutral influence. Strength is normalized against the existing Fixed full active amplitude of 1.55. Radial displacement is capped at 0.055 su per unit gain. Tangential drive rises smoothly with canonical speed from 0.04 to 1.6 su/s and is capped at 0.048 su per unit gain. Both use a 10/s exponential attack and a slower 2.4/s exponential release. The release stays anchored at the last driven position, producing analytic recovery without a persistent membrane or fluid state.

For sample position `p`, influence position `o`, signed radial coefficient `r`, signed tangential coefficient `t`, and configured radius `R`:

```text
q = p - o
n = normalize(q)
tangent = (-n.y, n.x)
falloff = exp(-dot(q, q) / R²)
continuousOffset = (n * r + tangent * t) * falloff
```

The zero direction at the exact center is explicit. The sum of continuous and timed membrane offsets is capped at 0.13 su. Rendering converts canonical offsets to Fixed's doubled structural extent and applies them before flow, vortices, domain warp and film thickness construction. This moves structural landmarks and adds no thickness, emission, glow, light, color, optical or explicit normal term.

The timed part uses a separate `membrane-wave` event rather than reinterpreting Qwen's `ripple-displacement`. Its defaults are lifetime 3.6 s, wavelength 0.34 su, propagation speed 0.36 su/s, front width 0.25 su, amplitude 1 and per-event gain 1. Each event contributes at most 0.036 su; their sum is capped at 0.12 su. The travelling carrier and broad front are:

```text
frontRadius = age * propagationSpeed
fromFront = distance - frontRadius
phase = 2π * fromFront / wavelength
frontEnvelope = exp(-fromFront² / (2 * width²))
recovery = (1 - clamp(age / lifetime, 0, 1))²
waveOffset = radialDirection * sin(phase) * frontEnvelope * recovery * gain
```

The origin is immutable after allocation. Age uses the explicit transient clock, freezes while paused and expires at its lifetime. Continuous response and release still advance from explicit application `dt` while animation is paused, matching the earlier continuous mechanisms. The slower, wider calibration translates Mobile 2.2's geometry and envelope into canonical units; it does not copy Mobile's accelerated event clock or claim numerical equivalence. TFL Lab emits a wave on active engagement and can emit distance-spaced drag waves at 0.14 su. Those policies remain in the Lab and the engine receives no press, drag, mouse or browser semantics.

Canvas2D reports the membrane mechanism as unavailable. Surface Probe remains the Fixed approximation and does not include it; Flow and Thickness views are the structural acceptance views. Diagnostics expose the continuous radial/tangential coefficients, radius, source speed/amplitude and active wave count.

## TFL Lab interaction profiles

TFL Lab provides a lightweight **Interaction profile** selector. Profiles write only the five source-neutral mechanism configurations and the Lab's event trigger toggles, then clear old transient interaction events for an unambiguous comparison. They never write film parameters, the scene preset, optics, lighting, quality, adaptive settings or locks.

- **Fixed baseline** restores the accepted legacy Fixed interaction and disables every optional spatial mechanism.
- **Qwen-like** enables Passive Warp, Active Press/Drag, Coordinate Shear and Qwen Ripple Displacement with their calibrated defaults; Mobile Membrane remains off.
- **Mobile-like** enables the broader membrane response and membrane waves, disables Qwen ripple and the point-focused active mechanisms, and keeps the Fixed-derived optical pipeline.
- **Custom** preserves the current mechanism values. Any manual interaction control change selects Custom automatically.

The selector replaces the earlier ambiguous **Fixed baseline** action button. Choosing a named profile is an explicit configuration action; selecting or editing Custom does not reset the current values. Profile choice and Lab trigger toggles are persisted alongside the engine configuration.

## Seeds and replay

The state separates a Fixed visual seed, a mutation/randomization seed and transient allocation sequence. The current Fixed shader retains its hard-coded deterministic hashes; the visual seed is recorded but intentionally not wired to the shader because doing so would change the baseline. Mutate and Randomize use a counter-based seeded sequence unless a test or caller supplies an explicit random function. Event allocation owns a separate sequence.

Given the same initial snapshot, seeds, parameter transactions, influence/event sequence and `dt` sequence, the source-neutral state evolves identically. This is state replay, not a claim of pixel-identical GPU output across backends.

## Snapshot policy

Snapshot schema version 2 stores requested/target parameters, locks, scene/render configuration, seeds and mutation sequence. Version 1 Phase 1 snapshots are accepted and migrated. Invalid known parameter values reject the snapshot before changing live state; unknown historical keys are ignored.

Normal configuration snapshots exclude clocks, `current`, `effective`, continuous influence, response runtime and transient events. They include passive configuration under `interactions.motionWarp`, active press/drag configuration under `interactions.activeDeformation`, shear configuration under `interactions.coordinateShear`, ripple configuration under `interactions.rippleDisplacement`, and membrane configuration under `interactions.membraneResponse`. Applying one immediately settles validated parameter values as Fixed import/restore already did, respects live locks when `preserveLocks` is selected, and leaves live pause, clocks, influence and events alone. TFL Lab separately persists its interaction profile and event trigger toggles.

`createSnapshot({ includeRuntime: true })` explicitly adds current/effective values, clocks, pause, influence, passive, active translation/press, coordinate-shear and continuous membrane responses, transient store, viewport aspect, adaptive scale and effective quality. `restoreSnapshot(..., { restoreRuntime: true })` restores that state for deterministic replay and testing. TFL Lab persistence uses the normal configuration form.

## Public boundary

The main `TflEngine` surface now covers:

- lifecycle: `initialize`, `dispose`
- validated controls: `setParameter`, `setParameters`, `applyPreset`, `mutate`, `randomize`, `reset`, `factoryReset`, locks and render settings
- time: `advance`, `setPaused`, `togglePaused`
- spatial control: `setViewport`, `setSpatialInfluence`, `clearSpatialInfluence`, `setMotionWarp`, `getMotionWarpConfiguration`, `setActiveDeformation`, `getActiveDeformationConfiguration`, `setCoordinateShear`, `getCoordinateShearConfiguration`, `setRippleDisplacement`, `getRippleDisplacementConfiguration`, `setMembraneResponse`, `getMembraneResponseConfiguration`
- timed infrastructure: `emitTransientEvent`, `clearTransientEvents`
- rendering budget: quality, MSAA, adaptive mode, target FPS and `render`
- inspection: `diagnostics`, `sampleSurface`
- state transfer: configuration and optional runtime snapshots

The controller accepts a rendering-host interface rather than canvases. TFL Lab creates the browser host with its DOM canvases, then supplies that host to the engine. TFL Lab keeps `probe`, panel visibility and panel-collapse preferences in a separate application-state object; they are no longer properties of engine state. The UI reads engine state but sends every numeric change back through engine methods. The engine controller and its state/spatial/clock/event modules contain no PointerEvent, mouse-button, localStorage, keyboard, touch, MIDI or piano concepts.

Diagnostics expose canonical influence values, passive response, active amplitude, press displacement, drag translation vector, coordinate-shear vector, ripple configuration/count, membrane response/wave count, all clocks, requested/current/effective scale, active transient count, lock count and the last transaction counts. `frameMs` remains the smoothed application frame interval; it is not labelled as GPU execution time.

## Fixed compatibility seam and deferred Phase 3 work

Phase 2 made no shader formula or constant changes. Phase 3A adds only its gated early coordinate displacement. Phase 3B adds the separately zeroed active offset before the same structural stages. Phase 3C adds a separately zeroed off-diagonal coordinate transform at that boundary. Phase 3D adds a separately zeroed bounded sum of timed ripple offsets. Phase 3E adds separately gated continuous radial/tangential and timed membrane-wave offsets. With Passive Warp, Active Press, Active Drag, Coordinate Shear, Ripple Displacement and Mobile Membrane disabled and `legacyFixedEnabled` enabled, all new offsets are zero and the historical Fixed coordinates and influence uniforms receive their previous values. Browser rendering still maps the influence descriptor to historical Fixed UV and UV/s immediately before upload.

Later work must decide how a future normal architecture handles deformation Jacobians and whether canonical flow/lighting clocks replace Fixed master-clock multiplication. Qwen ripple thickness/glow and cells, Mobile touch/gesture/device-motion input, Mobile optics and persistent simulation remain absent.
