# Fixed TFL compatibility baseline

The Phase 1 reference commit is `f7e15a4c458293c9925139887a984ca5034de50f`, tagged `tfl-fixed-baseline`.

## Scope and provenance

Phase 1 ports the historical implementation at `tmp/thin-film-lab-fixed/` into the real TFL Lab and TFL Engine directories. The visual field, shader constants, optical grading, lighting, pointer response, presets and quality definitions are carried over without intentional tuning. The archive remains read-only.

The runtime dependency is explicitly pinned as `three@0.185.1` in `package.json` and `package-lock.json`. The browser import map resolves `three`, `three/webgpu` and `three/tsl` from that installed package, so the application has no undeclared vendor dependency.

There is a provenance discrepancy in the supplied reference: its `PATCH_NOTES.md` calls for Three.js 0.185.1, while its checked-in `vendor/three.core.js` reports revision 186 and the archived bundles are not byte-identical to the npm 0.185.1 bundles. This phase follows the task's explicit 0.185.1 requirement. Pixel equivalence to a run using the archived revision-186 bundles has not been measured.

## Startup state

A fresh start applies the `Soap Film` preset after constructing defaults. Numeric parameters therefore start at:

| Group | Values |
| --- | --- |
| Simulation | `flowSpeed=.9`, `flowScale=1.2`, `turbulence=.8`, `warp=1`, `vorticity=.9`, `fineDetail=.9`, `filmBase=430`, `thickVar=.85`, `drainage=.55`, `tension=.8` |
| Optics | `interf=1`, `spread=1`, `saturation=1.05`, `exposure=1`, `contrast=1.05`, `fresnel=.9`, `specular=1`, `sharpness=110` |
| Lighting | `azimuth=135`, `elevation=42`, `lightMotion=.3`, `highlight=1`, `ambient=.35` |
| Rendering | `renderScale=1`, `temporal=1`, `grain=.008` |

The initial material quality is High, requested render scale is 1, MSAA is off, adaptive render scale is enabled with a 60 fps target, the diagnostic view is Final, Surface Probe is off, the simulation is running and no parameters are locked. The control panel is open. Numeric parameter changes ease toward their target at the historical `min(1, dt*3.2)` rate.

The other preserved presets are Oil Slick, Deep Violet, Electric Cells, Calm Membrane, Chaotic Laboratory and Mother of Pearl. Their exact values remain in `packages/tfl-engine/src/presets.js`.

## Renderer and viewport assumptions

- The renderer attempts Three.js WebGPU first. After a bounded initialization failure it forces the Three.js WebGL2 backend. If both fail, TFL Lab explicitly reports `Canvas2D fallback`.
- The GPU path uses a fullscreen orthographic plane and the Fixed TSL node material. Three tone mapping remains disabled; Three's output color-space handling remains active.
- Low, Medium, High and Ultra rebuild the material with the original Fixed octave, spectral-sample, normal-tap and detail constants. Automatic adaptation changes effective render scale only and keeps the chosen material quality.
- The canvas fills the viewport. The GPU drawing-buffer ratio is `min(devicePixelRatio, 2) * effectiveRenderScale`, with a lower ratio bound of .2. Pointer coordinates come from the displayed canvas rectangle, use [0,1] UV coordinates with y up, and are aspect-corrected inside the shader.
- MSAA choices remain Off, 2x and 4x in the interface. As in Fixed, either nonzero choice only enables Three's `antialias` constructor option; the historical code does not explicitly request distinct sample counts.
- The display presentation rate is estimated before renderer initialization. Adaptive quality uses the lower of the requested target and measured presentation rate, preventing a 120 fps setting from chasing an impossible target on a 60 Hz display.

## Pointer and fallback policy

Passive hover records position for Surface Probe but sets disturbance strength to zero. Primary pointer-down immediately raises strength to at least .9 and targets 1.55; dragging updates the existing velocity-driven coordinate offset, thickness dent, ripple, scalar shear and explicit normal tilt. Release decays strength and velocity with the Fixed rates. These effects are the Phase 1 baseline even though drag often reads primarily as local optical/thickness change rather than convincing surface transport.

The Canvas fallback is deliberately approximate. It renders layered gradients and interference-like bands from the same parameters, adds a pointer glow, uses a lower DPR cap, and labels itself clearly. It does not reproduce the TSL field, diagnostic modes, normals, spectral interference or GPU image. Controls remain live when GPU initialization or rendering fails. A failure while loading the main Three-dependent module still shows a labelled Canvas fallback but, matching the historical bootstrap path, cannot construct the full control panel.

## Automated validation boundary

Unit tests cover parameter definitions and bounds, snapshot validation, persistence-compatible lock round trips, lock-preserving imports, every preset, mutation/randomization bounds, lock handling, ordinary reset semantics, factory reset, reduced-motion state, smoothing and adaptive-scale descent/recovery. Syntax checks cover JavaScript under `apps/`, `packages/`, `scripts/` and `test/`. The development server was smoke-tested during Phase 1 by requesting the Lab page and its cross-directory engine/dependency modules.

Phase 2 adds tests for canonical coordinates and velocity, requested/target/current/effective state, transaction reports, explicit clocks and pause, bounded transient allocation/lifetime, deterministic seeds/replay, runtime snapshots and DOM-free use of the source-neutral API.

No browser automation or installed browser was available in the implementation environment. Shader compilation, WebGPU/WebGL2 initialization, interactive input and visual equivalence therefore require manual review. Passing syntax and unit tests is not evidence of visual parity.

## Manual visual acceptance checklist

Run `npm install`, then `npm run dev:tfl`, and open `http://localhost:8000/apps/tfl-lab/`.

- Confirm the temporary status reports WebGPU or WebGL2 rather than Canvas2D fallback.
- Confirm the control panel appears and Soap Film is selected at startup.
- Load every other preset and confirm each changes the scene.
- Run Mutate and Randomize; lock several parameters and confirm both actions preserve them.
- Move the pointer without pressing and confirm the artwork does not deform.
- Click and drag the surface and compare the response with the current Fixed archive, accepting its current transport limitation.
- Enable Surface Probe and confirm its thickness, interference, flow and normal readout follows hover.
- Cycle Final, Thickness, Normal, Flow, Interference and Lighting diagnostics.
- Leave adaptive quality enabled under load and confirm the diagnostic scale can step down and later recover without changing the selected quality.
- Confirm Reset restores unlocked numeric parameters to Soap Film while retaining locks, quality and MSAA.
- Confirm Factory Reset clears locks and restores the complete initial state.
- Reload and confirm ordinary settings, locks, panel visibility and probe preference persist.
- If the GPU path is unavailable, confirm the fallback is visibly labelled and its documented limitations are acceptable.

## Phase 2 manual compatibility gate

Phase 2 replaces the mixed target/current and Fixed-UV control seam with the contracts in `docs/tfl-engine-contract.md`. It deliberately retains the Fixed shader, values and compatibility mapping. Automated state and coordinate tests cannot establish visual equivalence.

Run `npm install`, then `npm run dev:tfl`, open `http://localhost:8000/apps/tfl-lab/`, and compare against the tagged baseline where useful. Verify all of the following before Phase 3:

1. Startup uses WebGPU or WebGL2 and visually matches the tagged Fixed baseline.
2. Soap Film matches the baseline.
3. Oil Slick, Deep Violet, Electric Cells and several other presets match.
4. Mutate retains its existing visual character.
5. Randomize retains its existing behavior.
6. Parameter locks still protect values from presets, Mutate, Randomize, Reset and Import.
7. Hover alone causes no visual disturbance.
8. Click behavior matches Phase 1.
9. Drag behavior matches Phase 1.
10. Release and decay match Phase 1, including while paused.
11. Surface Probe follows the pointer and reports values.
12. All six diagnostic material views still work.
13. Adaptive render scale steps down and recovers without changing the selected material quality.
14. Reset preserves locks/quality/MSAA and Factory Reset clears locks and restores Soap Film.
15. Pause/resume introduces no new flicker, phase jump or catch-up.
16. Resizing and orientation changes do not visibly misalign the interaction position.

No Qwen or Mobile behavior should be visible. Surface Probe remains an approximate CPU mirror rather than an exact GPU readback. Parameter definitions still carry UI group/label metadata to preserve the schema-driven Fixed panel; separating presentation metadata can wait until it has a concrete consumer.
