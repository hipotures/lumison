# Visual Mapping Tuning

Lumison’s collapsible laboratory isolates the existing MIDI visual mapping. It
does not configure feature extraction, transport, audio, or the source-neutral
TFL engine. Controls apply to the active mapper without recreating these systems.

`visual/visual-tuning.js` declares semantic paths, labels, groups, defaults,
boolean switches, slider bounds/steps, and diagnostic feature bindings. The UI,
validator, serializer, and runtime use this model. Original numeric defaults and
interaction switches come from the unchanged `MUSICAL_FIELD_V1` profile.

The complete JSON envelope has `schema: "lumison-midi-visual-tuning"`, `version: 2`,
`profile: "musical-field-v1"`, and these objects:

- `master`: enabled and sensitivity.
- `transient`: independent note/pitch/velocity/energy/sustain switches, pitch
  bounds, and all ripple shape coefficients.
- `influence`: spatial carrier, position/velocity/span/energy switches, activity
  gate and its sounding/density inputs, and field coefficients.
- `parameterMappings`: per-target enabled and delta/centeredDelta.
- `interactions`: the five mechanisms and their currently configured parameters.
- `temporal`: parameter update interval, the existing smooth/immediate global
  parameter transition mode, and optional continuous-input smoothing.
- `harmony`: local analysis settings and independent, initially disabled tonal
  offsets. See [Harmony / Tonality](harmony-tonality.md).

Export and Copy use the same deterministic, pretty-printed JSON. Import requires
the complete model, rejects unknown properties and incompatible versions/types,
clamps finite numbers to declared ranges, and rejects an inverted pitch range.
Validation finishes before any runtime mutation. No playback state is serialized.
Restore defaults reinstates the original profile; smoothing defaults off.
Version 1 imports migrate explicitly by adding default, neutral harmony settings;
their existing settings are preserved. Version 2 requires the complete harmony object.

Disable all switches off every relationship and interaction while preserving
numeric settings and playback. Solo preserves settings, disables other mappings,
and enables the required carrier (ripple events plus Ripple Displacement for
transients; field plus Membrane Response for spatial mappings). Activity-input
Solo also enables its gate. Global parameter Solo needs no carrier.

Disabled transient position inputs use viewport center; other disabled transient
inputs use their base coefficients. Disabled field position uses a stable center;
velocity still measures register movement independently. Disabled span/energy
inputs retain base radius/strength. Gate off means always engaged; gate on combines
enabled sounding-note and density inputs with OR. Mechanisms need their carrier
enabled to respond. Membrane wave settings are exposed because the profile sets
them, but this mapper emits only ripple events, not membrane-wave events.
Active Deformation and Coordinate Shear configure only enabled state and retain
engine numeric defaults. Engine-owned response calibration remains unchanged.

Transient edits clear existing events so old shapes do not obscure diagnosis;
new notes use the edited settings. Global changes default to the engine’s existing
smooth transition behavior, which can be disabled using its public immediate
transaction mode. Optional exponential smoothing affects only the
mapper’s continuous inputs; monitor values remain the original extracted features.

To add a mapping: add its default to the profile, declare semantic controls and
safe ranges in the tuning schema, consume those controls in the mapper through
public TFL methods, define a neutral disabled contribution and any Solo carrier,
and test default parity, isolation, and JSON round trips. The panel and serialization
pick up schema entries automatically. Bump the version for incompatible formats.
