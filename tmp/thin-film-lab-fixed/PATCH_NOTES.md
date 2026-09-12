# Thin-Film Lab patch notes

This source patch is based on the supplied Muse Spark 1.3 project files.
The original local `vendor/` directory is not included; keep the existing Three.js 0.185.1 vendor files.

## Fixed

- Surface Probe now updates independently from the diagnostics refresh, follows the pointer at a useful rate, appears immediately when possible, and reports probe errors instead of silently failing.
- Pointer interaction now produces an immediate visible deformation on click and a stronger pull/shear deformation while dragging. Hover alone no longer changes the artwork.
- Pointer interaction also works on the Canvas2D fallback canvas.
- Adaptive Quality can step upward at a VSync-capped target FPS. It no longer requires impossible headroom such as >66 FPS for a 60 FPS target.
- Adaptive render scale is now kept separate from the user's manual Render Scale and is no longer persisted as a new manual setting after an automatic downgrade.
- Randomize now creates an independent complete visual configuration instead of multiplying the previous state, preventing repeated dark-state lock-in.
- `R` now triggers Randomize. Reset remains available as an explicit button.
- Grain / Dither has a much smaller range and default, presets use lower values, and the shader uses stable per-pixel dither instead of frame-changing television-like noise.
- Every numeric parameter has a lock checkbox. Presets, Mutate, Randomize, Reset, Import, and adaptive Render Scale respect locked values. Factory Reset clears locks and restores everything.
- Reset now resets every unlocked numeric parameter before applying the Soap Film defaults, including Render Scale.
- UI synchronization now also updates Adaptive Quality and Surface Probe toggles.

## Validation

- All JavaScript and MJS files pass `node --check`.
- `node test/unit.mjs` passes, including lock behavior, independent randomization, bounds, snapshot persistence, smoothing, and VSync-safe adaptive recovery.

## v2
- Adaptive quality no longer switches Low/Medium/High/Ultra automatically; it changes render scale only, preventing abrupt artwork/color changes.
- The app measures the display presentation refresh rate before rendering. A requested 120 fps target remains selectable, but adaptive quality uses the visible presentation ceiling (for example 60 Hz) rather than degrading forever toward an impossible rAF rate.
- Diagnostics now show measured presentation Hz and the effective adaptive target.
- Pointer influence is aspect-correct (circular on wide canvases).
- Click/drag now perturbs surface normals as well as thickness, so interaction reads as a dimple/pull rather than local recoloring only.
