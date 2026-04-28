# Demo Limitations

`demo/adapters.ts` is a working reference implementation, but it is written to
run offline against a static HTML file with no external dependencies. Every
hard part of a real integration is stubbed.

This doc lists what the demo omits and what a real product implementation
needs in its place.

---

## `AppAdapter.validateEnvironment()` — always returns healthy

**Demo:** Returns `{ healthy: true, errors: [], warnings: [] }` unconditionally.

**Real implementation needs:**
- Check that your product's API is reachable
- Check that required env vars are set (`APP_URL`, `APP_API_KEY`, `DATABASE_URL`, etc.)
- Check that required CLI tools are installed (Playwright, your simulation binary)
- Return specific errors so the operator knows what to fix before running

```typescript
async validateEnvironment(): Promise<AppHealthResult> {
  const errors: string[] = [];
  if (!process.env.APP_URL) errors.push('APP_URL is not set');
  try {
    const res = await fetch(`${process.env.APP_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) errors.push(`App health endpoint returned ${res.status}`);
  } catch {
    errors.push(`App unreachable at ${process.env.APP_URL}`);
  }
  return { healthy: errors.length === 0, errors, warnings: [] };
}
```

---

## `AppAdapter.seed()` — writes to a static HTML file

**Demo:** Seeds synthetic data by writing a `seed-data.js` file that the demo
app loads from disk. No network calls, no real database.

**Real implementation needs:**
- Call your product's admin/test API to create real users and state
- Insert into a test database (or test tenant in your product)
- Write `mini-sim-export.json` with real entity IDs from the created records

The demo also does not seed entities for a scenario (`scenarioName` is ignored).
A real implementation should branch on `config.scenarioName` to seed different
entity configurations per scenario.

---

## `AppAdapter.reset()` — no-op

**Demo:** Does nothing.

**Real implementation notes:**
`AppAdapter.reset()` is not called by the orchestrator loop. It is available
as a callable method for use in your own scripts or test harness. If you want
cleanup between iterations, call it manually or add cleanup logic to
`SimulationAdapter.clean()` (which is called by the orchestrator).

---

## `SimulationAdapter.run()` — generates fake events

**Demo:** Generates scripted agent actions against the demo HTML app. Every
event is hardcoded — no real LLM, no real business logic.

**Real implementation needs:**
- Invoke your real simulation engine (in-process or out-of-process)
- Pass `LISA_DB_ROOT` and `LISA_MEMORY_DIR` to any subprocess
- Write real behavior events reflecting actual agent decisions
- Return accurate `ticksCompleted` and `behaviorEventsWritten` counts

---

## `BrowserAdapter.runSpecs()` — missing subprocess env vars

**Demo:** Calls Playwright with `LISA_MEMORY_DIR` set but does not set
`LISA_DB_ROOT`. Uses `file://` base URL — no running server required.

**Real implementation needs:**
- Set both `LISA_DB_ROOT` and `LISA_MEMORY_DIR` in the Playwright subprocess env
- Point `baseURL` at your running product (not `file://`)
- Handle authentication (session cookies, bearer tokens) in a global setup file
- Configure `PLAYWRIGHT_JSON_OUTPUT_NAME` to write results where the adapter expects

```typescript
async runSpecs(options: { iterRoot: string; project: string; allowFailures: boolean }):
    Promise<BrowserRunResult> {
  const lisaMemoryDir = path.join(options.iterRoot, '.lisa_memory');
  const resultsPath = path.join(options.iterRoot, 'flow-results.json');

  try {
    execFileSync('npx', ['playwright', 'test', `--project=${options.project}`], {
      env: {
        ...process.env,
        LISA_DB_ROOT:             options.iterRoot,   // not set by framework
        LISA_MEMORY_DIR:          lisaMemoryDir,       // not set by framework
        PLAYWRIGHT_JSON_OUTPUT_NAME: resultsPath,
      },
    });
  } catch (err: any) {
    if (!options.allowFailures) throw err;
  }

  const result = parsePlaywrightResults(resultsPath);
  return { passed: result.passed, failed: result.failed, total: result.total, resultsPath };
}
```

---

## No error handling or retry logic

**Demo:** No `try/catch`, no retries, no partial failure recovery anywhere.

**Real implementation needs:**
- Catch network timeouts in `seed()` and `run()` and throw with clear messages
- Use `INSERT OR IGNORE` / `UPSERT` in database writes (idempotency — SEED may
  be called again on a retry)
- `validateEnvironment()` should test connectivity with a short timeout, not
  assume services are up

---

## No multi-iteration state cleanup

**Demo:** Each iteration creates a fresh run root, so there is nothing to clean.

**Real implementation needs:**
- If your product accumulates state across iterations (e.g. seeded users
  persist in a shared test database), implement cleanup in a script you call
  between runs
- `AppAdapter.reset()` is the conventional place for this — call it explicitly
  from your orchestration script before starting a new loop

---

## `ScoringAdapter` — returns hardcoded/simplified scores

**Demo:** Reads `flow-results.json` and computes a basic pass/fail ratio.
Most dimensions are partially computed or constant.

**Real implementation needs:**
- Compute `coverage_delta` by comparing discovered screen paths across iterations
- Compute `persona_realism` from behavior event outcomes vs persona goals
- Read `fabric-feedback.json` from the previous iteration to compute trend data

---

## Summary — what to replace when wiring a real product

| Demo stub | Replace with |
|-----------|-------------|
| `validateEnvironment()` returns healthy | Real health check + env var validation |
| `seed()` writes to static HTML | API call to create real test entities |
| `SimulationAdapter.run()` fake events | Real simulation engine (subprocess or HTTP) |
| `BrowserAdapter` missing `LISA_DB_ROOT` | Set both `LISA_DB_ROOT` and `LISA_MEMORY_DIR` in subprocess env |
| `file://` base URL in Playwright config | Real product URL with auth setup |
| No error handling | `try/catch` + clear error messages at every external call |
| `ScoringAdapter` simplified scores | Real dimension computation from behavior events |
