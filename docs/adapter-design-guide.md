# Adapter Design Guide

The adapter interfaces define what each adapter must do. This document covers how to design adapters that are robust, testable, and maintainable — the "why" behind patterns you'll see in the reference implementations, and the mistakes that are easy to make if no one told you about them.

---

## The fundamental rule: adapters are thin translators

An adapter's job is to translate between the framework's generic concepts
(iterRoot, aliases, FabricScore) and your product's specific concepts
(application IDs, API endpoints, UI element keys). The framework owns the loop;
your product owns the logic.

The moment an adapter starts containing business logic — validating application data, computing match scores, deciding what makes a persona realistic — it has crossed the seam. That logic belongs in the product, not the adapter.

**Good adapter:**

```typescript
async seed(iterRoot, config) {
  const entities = await this.simulationEngine.seed(config.seekers, config.employers);
  await this.writeExport(iterRoot, entities);
  await this.writeAliases(iterRoot, entities);
}
```

**Adapter that crossed the seam:**

```typescript
async seed(iterRoot, config) {
  // ❌ Business logic in the adapter
  const seekers = config.seekers;
  if (seekers > 10) throw new Error('Too many seekers for trial plan');
  const entities = await this.simulationEngine.seed(seekers, config.employers);
  // ...
}
```

The plan limit check belongs in the simulation engine, not the adapter.

---

## AppAdapter: the most critical adapter to get right

### Make `seed()` idempotent

`seed()` may be called multiple times if the loop retries. If your seeding is not idempotent — if calling it twice creates duplicate users — the second run fails with constraint errors.

The simplest approach: always clean up before seeding, or use `reset()` before every `seed()` call.

```typescript
async seed(iterRoot, config) {
  // Clean existing state for this iterRoot first
  await this.simulationEngine.deleteIterationData(iterRoot);

  // Now seed fresh
  const entities = await this.simulationEngine.seed(config);
  // ...
}
```

Alternatively, seed with deterministic IDs keyed to `iterRoot` so the second call is a no-op:

```typescript
const seekerId = `seed-${hash(iterRoot)}-seeker-0`;
await this.db.upsert('users', { id: seekerId, ... });
```

### Make `verify()` actually throw

`verify()` is a fail-closed gate. Its job is to catch bad state before simulation runs. A `verify()` that always returns without checking is worse than no `verify()` at all — it creates false confidence.

Minimum viable `verify()`:

```typescript
async verify(iterRoot) {
  const db = new BetterSqlite3(path.join(iterRoot, '.lisa_memory/lisa.db'));
  const required = ['account.primary_user', 'account.secondary_user'];

  for (const alias of required) {
    const row = db.prepare('SELECT entity_id FROM seeded_entities WHERE alias = ?').get(alias);
    if (!row) {
      throw new Error(`[verify] Required alias '${alias}' not found in lisa.db`);
    }
  }
}
```

Include relationship validation if your product has them: "employer entity exists AND has a company record AND company has at least one job". The VERIFY phase is cheap; a simulation run that fails halfway through because of corrupt state is expensive.

### `validateEnvironment()` must not throw

The interface contract: return `AppHealthResult` with errors and warnings, never throw. The orchestrator calls this before the loop and surfaces the errors cleanly. If `validateEnvironment()` throws, the orchestrator can't give a useful error message.

```typescript
async validateEnvironment(): Promise<AppHealthResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check each service independently — collect all errors, don't short-circuit
  try {
    await this.apiClient.ping();
  } catch {
    errors.push('API server is not reachable at http://localhost:3000');
  }

  if (!process.env.GEMINI_API_KEY && this.options.liveLlm) {
    warnings.push('GEMINI_API_KEY not set — LLM simulation will fall back to deterministic mode');
  }

  return { healthy: errors.length === 0, errors, warnings };
}
```

---

## SimulationAdapter: managing state between ticks

### Write events synchronously if you can

`BehaviorEventRecorder` buffers events and flushes in batches. In most cases this is fine. But if your simulation process exits before the buffer flushes (e.g. an unexpected exception), events are lost.

Call `BehaviorEventRecorder.getInstance().flush()` at the end of `run()`:

```typescript
async run(iterRoot, options) {
  try {
    await this.runTicks(iterRoot, options);
  } finally {
    BehaviorEventRecorder.getInstance().flush();
  }
  return { simulationId, ticksCompleted, behaviorEventsWritten };
}
```

### Reset the singleton between iterations

`BehaviorEventRecorder` is a singleton. If your adapter implementation runs multiple iterations in-process (rather than spawning a subprocess per iteration), call `BehaviorEventRecorder.reset()` between them:

```typescript
async run(iterRoot, options) {
  BehaviorEventRecorder.reset(); // close previous connection if any
  BehaviorEventRecorder.getInstance(dbPath, 'fabric');

  // ... run simulation ...

  BehaviorEventRecorder.getInstance().flush();
}
```

### Return accurate counts

The `SimulationRunResult` includes `behaviorEventsWritten`. Return the actual count:

```typescript
return {
  simulationId: options.simulationId ?? randomUUID(),
  ticksCompleted: options.ticks,
  behaviorEventsWritten: db
    .prepare('SELECT COUNT(*) as c FROM behavior_events WHERE simulation_id = ?')
    .get(simulationId).c,
};
```

The orchestrator doesn't fail on a zero count, but the SCORE phase will produce a low `persona_realism` if there are no events. A wrong count in `behaviorEventsWritten` makes the dashboard misleading.

---

## BrowserAdapter: the adapter with the most surface area

### `runSpecs()` must set `LISA_DB_ROOT` and `LISA_MEMORY_DIR`

Every Playwright worker needs to know where `lisa.db` is. Set these before invoking Playwright:

```typescript
async runSpecs(options) {
  const env = {
    ...process.env,
    LISA_DB_ROOT: options.iterRoot,
    LISA_MEMORY_DIR: path.join(options.iterRoot, '.lisa_memory'),
  };

  const result = execSync(`npx playwright test --project ${options.project}`, {
    env,
    cwd: this.playwrightRoot,
  });
  // ...
}
```

### When `allowFailures: false`, still write `flow-results.json`

The framework reads `flow-results.json` after TEST regardless of whether flows passed or failed. Your `runSpecs()` must write this file even when Playwright exits non-zero. Pass `--reporter json` to Playwright and write the output.

```typescript
async runSpecs(options) {
  const resultsPath = path.join(options.iterRoot, 'flow-results.json');

  try {
    execSync(`npx playwright test --reporter json > ${resultsPath}`, { ... });
  } catch {
    // execSync throws on non-zero exit. Catch it — flow-results.json was still written.
    if (!fs.existsSync(resultsPath)) {
      throw new Error('Playwright did not write flow-results.json');
    }
  }

  const raw = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  return {
    passed: raw.stats.expected,
    failed: raw.stats.unexpected,
    total: raw.stats.expected + raw.stats.unexpected,
    resultsPath,
  };
}
```

### Use `allowFailures: true` for newly generated flows

On the first run of a newly generated spec, failures are expected — the spec may have inaccurate locators, or the path it's testing may not be fully stable yet. The orchestrator passes `allowFailures: true` for new flows. Your adapter must not throw in this case — return the failure count in `BrowserRunResult.failed` and let the framework decide what to do with it.

---

## ScoringAdapter: make it deterministic

The scoring adapter must produce the same score given the same inputs. No randomness, no timestamps used as inputs, no LLM calls.

The score affects the planner, the CI gate, and the feedback loop. A non-deterministic scorer will produce inconsistent feedback and a confusing score trend.

### Avoid reading outside the run root

A scoring adapter that reads from Postgres, Redis, or any external store introduces a dependency that can produce different scores on different machines. Read only from `iterRoot`:

```typescript
async score(iterRoot): Promise<FabricScore> {
  const flowResults = JSON.parse(
    fs.readFileSync(path.join(iterRoot, 'flow-results.json'), 'utf8')
  );
  const db = new BetterSqlite3(
    path.join(iterRoot, '.lisa_memory/lisa.db'),
    { readonly: true }  // scoring should never write to lisa.db
  );

  // Compute entirely from these two sources
}
```

---

## MemoryAdapter: start with a no-op

The `MemoryAdapter` interface exists for products that need a custom memory backend (e.g., Postgres instead of SQLite). For most products, the framework's built-in SQLite implementation is sufficient.

Start with a no-op and only implement it when you have a specific reason:

```typescript
export class NoOpMemoryAdapter implements MemoryAdapter {
  migrate(dbPath: string) {}
  writeEvent(dbPath: string, event: RecorderInput) {}
  resolveEntity(dbPath: string, alias: string): SeededEntity | null { return null; }
  listEntities(dbPath: string, simulationId: string): SeededEntity[] { return []; }
}
```

---

## Testing adapters in isolation

Each adapter can be tested independently without running the full loop. Use a real temporary directory as `iterRoot`:

```typescript
import os from 'os';
import path from 'path';
import fs from 'fs';
import { applyLisaDbMigrations } from 'synthetic-test-fabric';
import BetterSqlite3 from 'better-sqlite3';

describe('MyAppAdapter', () => {
  let iterRoot: string;

  beforeEach(() => {
    iterRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-test-'));
    fs.mkdirSync(path.join(iterRoot, '.lisa_memory'));
    const db = new BetterSqlite3(path.join(iterRoot, '.lisa_memory/lisa.db'));
    applyLisaDbMigrations(db);
  });

  afterEach(() => {
    fs.rmSync(iterRoot, { recursive: true });
  });

  it('seed writes required aliases to lisa.db', async () => {
    const adapter = new MyAppAdapter();
    await adapter.seed(iterRoot, { seekers: 1, employers: 1, employees: 0 });

    const db = new BetterSqlite3(path.join(iterRoot, '.lisa_memory/lisa.db'));
    const seeker = db.prepare('SELECT * FROM seeded_entities WHERE alias = ?')
      .get('account.primary_user');

    expect(seeker).toBeDefined();
    expect(seeker.entity_id).toBeTruthy();
  });

  it('verify throws if seed was skipped', async () => {
    const adapter = new MyAppAdapter();
    // No seed() call
    await expect(adapter.verify(iterRoot)).rejects.toThrow('not found in lisa.db');
  });
});
```

Test each adapter phase in isolation with real filesystem I/O. Don't mock the filesystem — the adapter's job is precisely to read and write files in the correct format.

---

## Common mistakes

**Writing to hardcoded paths instead of `iterRoot`**
All writes must go to paths derived from `iterRoot`. Hardcoded paths break parallel runs and make cleanup impossible.

**Calling `new BetterSqlite3(dbPath)` with the wrong `dbPath`**
The `lisa.db` path is always `path.join(iterRoot, '.lisa_memory/lisa.db')`. Reading from `process.env.LISA_DB_ROOT` works too — but never hardcode it.

**Swallowing errors in `seed()`**
If your seed subprocess fails and you catch the error without re-throwing, VERIFY will throw and the error will be confusing. Let seed failures propagate cleanly.

**Not writing `fabric-score.json` from `ScoringAdapter.score()`**
The framework reads this file after `score()` returns. If the file isn't written, FEEDBACK and the score gate have nothing to read.

**Not handling `SQLITE_CONSTRAINT_UNIQUE` in custom event writers**
If you write events to `lisa.db` outside of `BehaviorEventRecorder`, handle duplicate detection yourself. The recorder handles it internally via `writeWithRetry` — custom writers need to implement the same pattern.

**Using `exec` / `execSync` without capturing stderr**
Simulation and seed scripts often fail silently with a non-zero exit code. Always capture stderr and include it in the error message:

```typescript
try {
  execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] });
} catch (err: any) {
  throw new Error(`[seed] Command failed:\n${err.stderr?.toString()}`);
}
```
