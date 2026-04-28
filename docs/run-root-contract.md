# Run Root Contract

Every iteration of the fabric loop writes its artifacts to a single directory
called the **run root**. All adapters and the orchestrator share this path.

---

## Layout

```
<loop-root>/
  current -> iter-002/      ← symlink, updated by orchestrator after each completed iteration
  iter-001/
    .lisa_memory/
      lisa.db               ← seeded entities, behaviour events, persona goals
    mini-sim-export.json    ← seeded entity list + simulation_id
    candidate_flows.yaml    ← discovered screen paths for flow generation
    flow-results.json       ← Playwright JSON reporter output (regression run)
    generated-flow-results.json  ← Playwright JSON output (generated-flows run)
    fabric-score.json       ← FabricScore output
    fabric-feedback.json    ← FabricFeedback output
  iter-002/
    ...
```

## Artifact ownership

| Artifact | Writer | Phase | Notes |
|----------|--------|-------|-------|
| `<loop-root>/` | Orchestrator | Before first iteration | Created by `orchestrator.run()` |
| `iter-NNN/` | Orchestrator | Before SEED | Created per iteration |
| `.lisa_memory/` | Orchestrator | Before SEED | Created per iteration |
| `current` symlink | Orchestrator | After each completed iteration | Updated after IMPORT; not updated on failure |
| `mini-sim-export.json` | `AppAdapter.seed()` | SEED | Must contain `{ entities: SeededEntity[] }`. `simulation_id` is optional — if absent the RUN watcher uses an empty ID |
| `lisa.db` — seeded_entities | `AppAdapter.seed()` | SEED | Via `applyLisaDbMigrations()` |
| `lisa.db` — behavior_events | `SimulationAdapter.run()` | RUN | Via `BehaviorEventRecorder` |
| `candidate_flows.yaml` | `SimulationAdapter.exportEntities()` | ANALYZE | Optional; absence skips GENERATE_FLOWS |
| `flow-results.json` | `BrowserAdapter.runSpecs()` | TEST (regression) | Must be Playwright JSON reporter output |
| `generated-flow-results.json` | `BrowserAdapter.runSpecs()` | TEST (generated-flows) | Optional; adapter-defined location |
| `fabric-score.json` | `ScoringAdapter.score()` | SCORE | |
| `fabric-feedback.json` | `FeedbackAdapter.feedback()` | FEEDBACK | Read by next iteration's SEED |
| `.fabric-sealed` | `sealRunRoot()` helper | Verify Mode B only | **Not written by the orchestrator loop** — CLI-only |

---

## Environment variables

Two environment variables describe the run root to subprocesses:

| Variable | Value |
|----------|-------|
| `LISA_DB_ROOT` | `<run-root>` |
| `LISA_MEMORY_DIR` | `<run-root>/.lisa_memory` |

These two must always describe the same run. Never point `LISA_MEMORY_DIR` at
a different root than `LISA_DB_ROOT`.

---

## Fixture identity

Named fixtures live in `lisa.db` in the `seeded_entities` table.

Consumers resolve them by `entity_type` + `entity_id` alias. They must not
treat the following as authoritative:

- first row for a given `entity_type`
- hardcoded database IDs
- any source outside `seeded_entities`

The `AppAdapter.verify()` call is the fail-closed gate that proves aliases are
populated before the browser adapter runs.

---

## Lifecycle

A loop root persists across all iterations:

```
/tmp/fabric-loop/<loop-id>/
  iter-001/               ← run root for iteration 1
    .lisa_memory/lisa.db
    mini-sim-export.json
    ...
  iter-002/               ← run root for iteration 2
    ...
```

Each iteration gets its own `iter-NNN` subdirectory. The loop root is the
parent.

`FabricOrchestrator` creates the loop root and each iteration root
automatically. Adapters receive the `iterRoot` path and must not create or
manage directories above it.

---

## Artifact exclusions

The following must never be committed to git or included in npm tarballs:

```
.lisa_memory/lisa.db
.lisa_memory/*.db-shm
.lisa_memory/*.db-wal
fabric-score.json
fabric-feedback.json
*.last-run.json
mini-sim-export.json
test-results/
```

The `.gitignore` in `kaneshir/synthetic-test-fabric` enforces this. Product
repos must add equivalent entries.
