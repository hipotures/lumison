# Intended architecture

```text
TFL Lab ─────┐
             ├──> TFL Engine
Lumison ─────┘
```

These arrows describe future dependencies. The current entry points are placeholders and do not wire applications to an engine yet.

## Responsibilities and boundaries

- **TFL Engine** (`packages/tfl-engine/`) owns shared visual simulation and rendering, driven through a future programmatic API. It must not depend on either application or know about MIDI, piano, mouse, touch, or GUI. It must not contain MIDI-specific logic.
- **TFL Lab** (`apps/tfl-lab/`) owns standalone laboratory interaction, mouse/touch/mobile input, debug controls, presets, parameter editing, and mutate/randomize controls. TFL Lab-specific GUI code must stay outside the engine.
- **Lumison** (`apps/lumison/`) owns MIDI input, piano interpretation, musical state/memory, and mapping performance to engine actions. Lumison-specific MIDI/music interpretation must stay outside the engine. Lumison must not depend on the TFL Lab GUI.

Future extraction of TFL Engine and TFL Lab into separate packages/repositories should remain practical. Keep dependencies pointing toward the engine, keep application concerns in their respective directories, and never import application code into the engine. Package manifests and API contracts can be added when implementation makes them necessary.

## Initial scope

Use vanilla modern JavaScript and ES modules. The root package provides only module configuration and a dependency-free syntax check; this is a directory-based monorepo layout without package-manager workspace wiring yet.

The first musical instrument will be a piano using MIDI. Do not create speculative instrument abstractions or class hierarchies. Implement concrete boundaries as needed by the first applications.

`tmp/` is an immutable archive of historical experiments and reference implementations for now. This setup does not modify, rename, delete, move, copy, refactor, migrate, or merge any historical prototype. Migration is a separate task.
