# Lumison

Lumison is a planned piano/MIDI-driven audiovisual application powered by a shared thin-film visual engine. This repository currently contains only the initial project structure; no application or engine functionality is implemented.

- `apps/tfl-lab/`: standalone Thin-Film Lab, eventually providing mouse/touch/mobile interaction, laboratory/debug controls, presets, parameter editing, and mutate/randomize actions.
- `apps/lumison/`: piano/MIDI application, eventually interpreting performance, maintaining musical state/memory, and mapping it to engine actions without depending on the TFL Lab GUI.
- `packages/tfl-engine/`: reusable simulation/rendering engine, eventually exposing a programmatic API independent of application inputs and GUI.
- `docs/architecture.md`: intended boundaries and dependency direction.
- `tmp/`: immutable historical/reference experiments for now. Do not modify, rename, delete, move, or copy implementation code from this archive during the structural setup.

The new code uses vanilla JavaScript and ES modules, with no framework, build system, or dependencies. With Node.js and npm installed, run `npm run check` for JavaScript syntax checks; no install step is needed. The application HTML files are static placeholders with module entry points.

See [the architecture notes](docs/architecture.md) for the intended design.
