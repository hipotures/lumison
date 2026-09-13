# Lumison

Lumison is a planned piano/MIDI-driven audiovisual application powered by a shared thin-film visual engine. The repository currently includes the first implementation phase: a runnable TFL Lab that preserves the historical Fixed prototype behind a reusable engine boundary.

- `apps/tfl-lab/`: standalone Thin-Film Lab with the Fixed control panel, pointer adapter, persistence, diagnostics, presets and mutation actions.
- `apps/lumison/`: piano/MIDI application, eventually interpreting performance, maintaining musical state/memory, and mapping it to engine actions without depending on the TFL Lab GUI.
- `packages/tfl-engine/`: reusable Fixed-compatible simulation/rendering engine, parameter policy and lifecycle, independent of application input and GUI code.
- `docs/architecture.md`: intended boundaries and dependency direction.
- `tmp/`: immutable historical/reference experiments. Phase 1 was ported from `tmp/thin-film-lab-fixed/`; the archive itself remains unchanged.

The code uses vanilla JavaScript and ES modules with Three.js pinned to 0.185.1. Install and start the static development server from the repository root:

```sh
npm install
npm run dev:tfl
```

Then open `http://localhost:8000/apps/tfl-lab/`. Run `npm run check` for JavaScript syntax checks and `npm test` for source-neutral state, preset, lock, snapshot and adaptive-scale tests.

See [the architecture notes](docs/architecture.md), [Fixed baseline](docs/tfl-fixed-baseline.md), and [merge plan](docs/tfl-merge-plan.md) for boundaries, validation and later phases.
