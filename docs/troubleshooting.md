# Troubleshooting

Problems during a fabric run usually surface in one of four places: the SEED/VERIFY phase (bad state before simulation starts), the RUN phase (simulation not writing events), the TEST phase (Playwright failures), or scoring (the score is wrong or missing).

---

## Before you dig in: read the run root

The run root is your primary diagnostic tool. Before chasing logs, check what's actually in the iteration directory:

```bash
ls -la /tmp/fabric-runs/loop-XXX/iter-001/

# Look for:
# mini-sim-export.json   ← did SEED complete?
# candidate_flows.yaml   ← did ANALYZE complete?
# flow-results.json      ← did TEST complete?
# fabric-score.json      ← did SCORE complete?
```

Which file is missing tells you which phase failed. Start there.

---

## SEED / VERIFY failures

### `alias 'account.primary_user' not found in lisa.db`

SEED completed but the alias wasn't written. Causes:

1. **`AppAdapter.seed()` wrote to a different `lisa.db`** — confirm you're writing to the path at `${iterRoot}/.lisa_memory/lisa.db`, not a hardcoded path. The orchestrator sets `LISA_DB_ROOT` and `LISA_MEMORY_DIR` in the environment; use those.

2. **`applyLisaDbMigrations()` was never called** — the `seeded_entities` table doesn't exist. Confirm your `MemoryAdapter.migrate()` or direct call to `applyLisaDbMigrations()` runs before any writes.

3. **Seed script exited early** — check stdout/stderr of the seed subprocess. If `seed()` calls an external script, that script may be swallowing errors.

**Quick check:**

```bash
sqlite3 /tmp/fabric-runs/loop-XXX/iter-001/.lisa_memory/lisa.db \
  "SELECT alias, type FROM seeded_entities;"
```

If this returns nothing, seed wrote zero rows. If it returns some rows but not the expected alias, your alias naming doesn't match what VERIFY is looking for.

---

### `mini-sim-export.json is empty or missing`

`AppAdapter.seed()` did not write the file. This file must be written by your `seed()` implementation — the framework does not write it automatically. Confirm:

```typescript
// In AppAdapter.seed():
const exportPath = path.join(iterRoot, 'mini-sim-export.json');
await fs.writeFile(exportPath, JSON.stringify({ entities: seededEntities }));
```

---

### `VERIFY threw: relationship broken — entity.primary_job has no owner`

Your `verify()` implementation found an inconsistency in the seeded state — an entity exists but a required relationship (foreign key, ownership record) is missing. This is VERIFY doing exactly its job: failing closed before bad state runs through simulation.

Fix: trace back through `seed()` and confirm the relationship is created. If seed is partially failing (creating the user but not the associated company record), this is where it surfaces.

---

## RUN failures

### `behaviorEventsWritten: 0` after simulation

Simulation ran but no events were written. Causes:

1. **`simulation_id` is missing** — `BehaviorEventRecorder.record()` drops events with no `simulation_id`. Confirm you're passing `simulationId` to `run()`, or that the simulation agent sets `LISA_SIMULATION_ID` in its environment.

2. **Recorder in simulation mode, not fabric mode** — in simulation mode, recorder warnings are non-fatal (events drop silently). In fabric mode, missing `simulation_id` throws. Check which mode your `BehaviorEventRecorder` instance is initialized with.

3. **Recorder queue never flushed** — events sit in the write queue and are lost if the process exits before `flush()`. Call `BehaviorEventRecorder.getInstance().flush()` at the end of your simulation run.

**Quick check:**

```bash
sqlite3 /tmp/fabric-runs/loop-XXX/iter-001/.lisa_memory/lisa.db \
  "SELECT COUNT(*), tick FROM behavior_events GROUP BY tick ORDER BY tick;"
```

Zero rows = recorder not writing. Some rows per tick = recorder working.

---

### `SQLITE_BUSY: database is locked`

Another process is holding a write lock on `lisa.db`. Causes:

1. **Previous iteration didn't clean up** — a zombie simulation process is still running. Find and kill it: `ps aux | grep simulation` or `lsof | grep lisa.db`.

2. **`BehaviorEventRecorder.reset()` wasn't called between runs** — the singleton holds the connection open. Call `BehaviorEventRecorder.reset()` at the end of each iteration.

3. **Playwright workers and the simulation are racing** — if TEST and RUN overlap (shouldn't happen in the normal loop but can in custom orchestration), both try to write simultaneously. WAL mode handles concurrent reads, but concurrent writes still lock. The recorder has 5-second busy timeout and exponential-backoff retry — if this exceeds 3 attempts, there's a structural issue with your orchestration.

---

### Simulation ticks complete but persona goals not reached

`persona_realism` is low and agents aren't hitting their goals. Three causes:

1. **Goals require product state that wasn't seeded** — if the goal is "apply to a job" but `seed()` created no jobs, the agent can't reach it. Check `mini-sim-export.json` for the `entity.primary_job` alias.

2. **Goals are too vague for the LLM agent** — in liveLlm mode, the agent uses the goal text to decide what to do. "Find a job" is too vague. "Find a journeyman electrician role within 30 miles of Portland" is actionable. Rewrite the goal.

3. **Tick count is too low** — complex goals require multiple ticks to reach. If `ticks: 5` and the goal path takes 8 steps, the agent runs out of ticks. Increase `--ticks`.

---

## TEST failures

### `Error: browserType.launch: Executable doesn't exist`

Playwright's browser binary is missing. Run:

```bash
npx playwright install chromium
```

In CI, this needs to run before the fabric commands. See [ci-integration.md](./ci-integration.md).

---

### `Timed out waiting for [data-key="login_email_input"]`

The Playwright spec is looking for an element key that doesn't exist or isn't visible. Causes:

1. **App isn't running** — check that your test server is up before running `fab flows`. The `validateEnvironment()` check should catch this, but confirm your implementation actually tests the URL.

2. **`showKeys=true` not in URL** — if the spec navigates to a URL without `?showKeys=true`, the `data-key` attributes won't be rendered. Check the generated spec's `page.goto()` call.

3. **Key was renamed in the app** — the spec was generated with an old key. Regenerate: delete the failing spec from `flows/` and run `fab analyze && fab orchestrate --iterations 1` to regenerate it from fresh simulation.

4. **Timing issue** — the element exists but the page isn't stable yet. Add `await page.waitForLoadState('networkidle')` after navigation.

---

### `resolveCredentials('account.primary_user') returned null`

The Playwright spec can't find the fixture alias. Causes:

1. **`LISA_DB_ROOT` not set** — the spec reads `LISA_DB_ROOT` from the environment. Confirm your `BrowserAdapter.runSpecs()` implementation sets this variable in the Playwright subprocess environment.

2. **Wrong `iterRoot`** — the `LISA_DB_ROOT` points to a different iteration's run root. Each iteration has its own `lisa.db` at a different path.

3. **Alias doesn't exist** — SEED didn't write this alias. Run `fab verify --root <iterRoot>` to confirm which aliases are present.

---

### All flows fail with `Error: net::ERR_CONNECTION_REFUSED`

The app isn't running or isn't accessible from the Playwright subprocess. The framework does not manage your test server. Your `BrowserAdapter.runSpecs()` must start (or confirm running) the app before invoking Playwright.

**Confirm the app is up:**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
# Should return 200
```

---

## SCORE failures

### `fabric-score.json is missing` after TEST

`ScoringAdapter.score()` did not write the file, or threw silently. The scorer must write `fabric-score.json` to `iterRoot`. Check:

1. Is `flow-results.json` present? The scorer reads it. If TEST didn't write it, the scorer has nothing to work with.
2. Did `score()` throw? Check stderr. If your scorer throws, the orchestrator logs the error but continues.

---

### Score is unexpectedly 0.0 across all dimensions

Almost always means `flow-results.json` is empty or malformed. The scorer can't compute coverage, regression health, or flow coverage without flow results. Run `fab flows --root <iterRoot>` manually and check what Playwright outputs.

---

### `overall` score is high but `regression_health` is very low

This is the most important combination to watch. It means everything else is fine but previously passing flows are now failing — a real regression. Check `flow-results.json` for the specific failing flows, then check git log for changes to those flows' code paths.

Do not quarantine flows to fix `regression_health`. Quarantine is for flaky tests. A regression needs to be investigated.

---

## lisa-mcp issues

See [lisa-mcp.md](./lisa-mcp.md#troubleshooting) for MCP-specific troubleshooting: binary permissions, platform support, empty key discovery, and stale locators.

---

## Getting more information

**Verbose logging:**

```bash
DEBUG=fabric:* npx fab orchestrate
```

**Manual phase inspection:**

```bash
# Run just the failing phase against an existing run root
npx fab seed --root /tmp/debug-001
npx fab verify --root /tmp/debug-001
npx fab flows --root /tmp/debug-001 --grep failing-flow-name
npx fab score --root /tmp/debug-001
```

**Inspect `lisa.db` directly:**

```bash
sqlite3 /tmp/fabric-runs/loop-XXX/iter-001/.lisa_memory/lisa.db

# Useful queries:
.tables
SELECT * FROM seeded_entities;
SELECT tick, action, screen_path, outcome FROM behavior_events ORDER BY tick, sequence_in_tick;
SELECT * FROM behavior_events WHERE event_kind = 'adversarial_probe';
```

**File an issue:**

If you've checked the above and are still stuck, [open a bug report](https://github.com/kaneshir/synthetic-test-fabric/issues/new?template=bug_report.md). Paste the relevant section of your run root artifacts — `fabric-score.json` and the failing phase's output are usually enough to diagnose.
