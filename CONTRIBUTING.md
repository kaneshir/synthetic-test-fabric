# Contributing to synthetic-test-fabric

Thank you for your interest in contributing.

## What this project is

`synthetic-test-fabric` is a generic engine for autonomous synthetic test loops.
It provides the core primitives — schema, recorder, scoring types, feedback types,
adapter interfaces, and persona definitions — that any consumer app can use to run
self-improving QA loops.

**You bring the adapters.** Consumer repos implement the 8 interfaces in `src/adapters.ts`
to connect their app's infrastructure (database seeding, browser runner, scoring logic, etc.)
to the engine.

## What belongs here vs. consumer repos

| Belongs in this repo | Belongs in the consumer repo |
|---|---|
| Generic adapter interfaces (`adapters.ts`) | App-specific implementations (e.g. database seeding) |
| Scoring types and `FabricScore` shape | Custom scoring logic for a specific app |
| `BehaviorEventRecorder` and SQLite schema | App-specific behavior event producers |
| Outcome enum and `classifyOutcome()` | App-specific HTTP client error handling |
| Persona YAML schema and parser | App-specific persona YAML files |
| `normalizeScreenPath`, `resolveLoopPaths` | App-specific screen path vocabularies |

If a change requires importing any app-specific package (a database SDK, a
framework runtime, a cloud provider client), it belongs in the consumer repo.

## Running tests

```bash
npm test
```

## Checking the extraction boundary

This package enforces that no app-specific packages are imported. The boundary
check script lives in `scripts/check-boundary.ts` and is invoked via:

```bash
npm run check:boundary
```

Run this before submitting a PR. The CI gate also runs it automatically.

## Adapter interface stability

The 8 interfaces declared in `src/adapters.ts` are the public API of this package:

- `AppAdapter`
- `SimulationAdapter`
- `ScoringAdapter`
- `FeedbackAdapter`
- `MemoryAdapter`
- `BrowserAdapter`
- `Reporter`
- `ScenarioPlanner`

**Changes to these interfaces require a major version bump** (breaking change for all consumers).
Adding a new optional method is a minor bump. Adding a new required method is a major bump.

Implementation modules (`schema.ts`, `recorder.ts`, `run-root.ts`, etc.) may evolve
between minor versions as long as the exported types do not change.

## PR guidelines

- No imports from app-specific packages — boundary check must pass (see above).
- New adapter methods require a corresponding stub in `src/adapters.test.ts`.
- All tests must pass: `npm test`.
- Keep PRs focused. One concern per PR.
- Commit messages follow conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`.
