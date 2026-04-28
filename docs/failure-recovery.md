# Failure Recovery

What to do when an iteration fails, how to read the run root, and how to
recover or retry.

---

## What happens when an iteration fails

When any adapter throws, the orchestrator stops that iteration immediately.
Subsequent iterations do not run. `orchestrator.run()` rejects with the
thrown error.

The `iter-NNN/` directory is **always preserved on failure**. The `current`
symlink is **not updated** — it still points to the last successfully completed
iteration, or does not exist if no iteration has completed.

---

## Reading the run root after failure

The files present in `iter-NNN/` tell you exactly which phase succeeded last:

| Files present | Last successful phase |
|---------------|-----------------------|
| Directory only (empty) | Failed during or before SEED |
| `mini-sim-export.json` + `lisa.db` (seeded_entities rows present) | SEED |
| Same as SEED | VERIFY (read-only, adds nothing) |
| `lisa.db` (behavior_events rows present) | RUN |
| `candidate_flows.yaml` | ANALYZE |
| Generated spec files in adapter-defined location | GENERATE_FLOWS |
| `flow-results.json` | TEST |
| `fabric-score.json` | SCORE |
| `fabric-feedback.json` | FEEDBACK |

All files in a failed run root are **safe to inspect**. None of them will be
overwritten — the next run creates a new `iter-NNN/` directory.

---

## How to tell which phase failed

Check the console log. Each phase logs on entry:

```
[orchestrate] iter-001: → SEED
[orchestrate] iter-001: → VERIFY
[orchestrate] iter-001: → RUN
...
```

The last phase logged before the error is the failed phase. The error message
from the thrown exception follows immediately.

**Example — TEST failure with `allowRegressionFailures: false`:**

```
[orchestrate] iter-001: → TEST
Error: [browser] Playwright exited with code 1 — 3 tests failed
```

**Example — missing `flow-results.json` after Playwright crash:**

```
[orchestrate] TEST(regression): flow-results.json was not written — Playwright
likely failed before running any tests (check browser install, reporter config,
or test imports). Refusing to continue to SCORE with no regression data.
```

---

## Common failure modes and fixes

### SEED fails — missing or invalid `mini-sim-export.json`

**Symptom:** VERIFY or ANALYZE fails with "entities is empty" or similar.

**Cause:** `AppAdapter.seed()` did not write `mini-sim-export.json`, or wrote
it with an invalid shape.

**Fix:** Ensure `seed()` writes `{ entities: SeededEntity[], simulation_id: string }`
to `path.join(iterRoot, 'mini-sim-export.json')` before returning.

---

### VERIFY fails — entity aliases not in `lisa.db`

**Symptom:** `AppAdapter.verify()` throws "alias not found" or similar.

**Cause:** `seed()` did not insert rows into the `seeded_entities` table, or
inserted with the wrong alias format.

**Fix:** Check the `seeded_entities` table in the failed run root:

```bash
sqlite3 /path/to/iter-001/.lisa_memory/lisa.db \
  "SELECT entity_type, entity_id, data FROM seeded_entities;"
```

---

### RUN fails — no behavior events in `lisa.db`

**Symptom:** SCORE produces 0 for `discovery_yield` or `persona_realism`.

**Cause:** `SimulationAdapter.run()` returned without writing events, or wrote
to a different database path.

**Fix:**
1. Check that `LISA_MEMORY_DIR` is set correctly in subprocess env
2. Verify events were written:

```bash
sqlite3 /path/to/iter-001/.lisa_memory/lisa.db \
  "SELECT COUNT(*) FROM behavior_events;"
```

---

### TEST fails — `flow-results.json` not written

**Symptom:**
```
TEST(regression): flow-results.json was not written
```

**Cause:** Playwright crashed before running any tests. Common causes:
- Playwright not installed (`npx playwright install`)
- Playwright config points to wrong base URL
- JSON reporter not configured
- `LISA_DB_ROOT` / `LISA_MEMORY_DIR` not set in Playwright subprocess env

**Fix:** Run Playwright manually against the failed run root:

```bash
LISA_DB_ROOT=/path/to/iter-001 \
LISA_MEMORY_DIR=/path/to/iter-001/.lisa_memory \
npx playwright test --project=regression --reporter=json
```

---

### TEST fails — `flow-results.json` exists but has 0 tests

**Symptom:**
```
TEST(regression): flow-results.json exists but reports 0 tests
```

**Cause:** Playwright ran but collected no specs. Common causes:
- `flows/` directory is empty
- Playwright config `testDir` points to wrong location
- All specs filtered out by `grep` pattern

**Fix:** Check that spec files exist and match the configured `testDir`.

---

### SCORE fails — `fabric-score.json` not written

**Symptom:** `ScoringAdapter.score()` throws, or `fabric-score.json` is absent
after SCORE.

**Cause:** Scoring adapter threw before writing the file.

**Fix:** Ensure `score()` writes `fabric-score.json` before returning, even
if some inputs are missing (return zero-value dimensions rather than throwing
on missing `flow-results.json`).

---

## Can I resume a failed loop?

**Not automatically.** The loop stops on the first iteration failure and does
not retry. To continue:

1. Fix the underlying issue (adapter code, environment, missing binary)
2. Start a new `orchestrator.run()` call

The new run will start from iteration 1 in a new `iter-NNN/` directory. The
failed `iter-NNN/` directory is left in place for debugging.

**Reusing artifacts from a failed run** is not supported — always start from
a fresh seed. Partially written `lisa.db` files may have constraint violations
that cause later phases to behave unexpectedly.

---

## Inspecting the run root

Useful commands for debugging a failed run:

```bash
# List all artifacts in a failed iteration
ls -la /path/to/loop-root/iter-001/

# Check seeded entities
sqlite3 /path/to/iter-001/.lisa_memory/lisa.db \
  "SELECT alias, entity_type, entity_id FROM seeded_entities;"

# Check behavior event count and outcome distribution
sqlite3 /path/to/iter-001/.lisa_memory/lisa.db \
  "SELECT outcome, COUNT(*) FROM behavior_events GROUP BY outcome;"

# Read the score (if SCORE completed)
cat /path/to/iter-001/fabric-score.json | jq '.overall, .dimensions'

# Read the feedback (if FEEDBACK completed)
cat /path/to/iter-001/fabric-feedback.json | jq '.failed_flows[].spec_title'
```
