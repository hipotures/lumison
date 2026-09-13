# Fixed TFL compatibility baseline

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

## Compatibility debt deferred to Phase 2

The public engine still uses the Fixed parameter names and mixed target/current state shape. Its numeric interaction descriptor still uses Fixed UV fields (`x`, `y`, `vx`, `vy`, `strength`) and the renderer still accesses browser viewport/DPR globals. Parameter definitions retain UI labels/group identifiers so the historical schema-driven panel stays exact. The v1 snapshot format combines engine configuration with Lab preferences in the Lab persistence adapter. Surface Probe is an approximate CPU mirror rather than an exact GPU readback. These are documented seams for Phase 2; this phase does not introduce canonical coordinates, units, clocks or a redesigned interaction API.
