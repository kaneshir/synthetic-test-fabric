# Adapter Testing

How to test adapters in isolation — before wiring them into the full loop.

> **Compiled reference implementations** live in `docs/fixtures/adapter-stubs.ts`.
> Every adapter interface is implemented there with correct method signatures
> and verified to compile against the package on every CI run.

---

## Why test adapters in isolation

The orchestrator calls adapters sequentially and stops on the first throw.
Testing each adapter independently lets you:

- Verify file I/O contracts (correct files written to `iterRoot`)
- Confirm `lisa.db` is written correctly before running the full loop
- Iterate quickly without the cost of a full SEED→TEST→SCORE run

---

## The minimal test harness

Every adapter method receives an `iterRoot` path. In tests, point that at a
temporary directory:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyLisaDbMigrations } from 'synthetic-test-fabric';

let iterRoot: string;

beforeEach(() => {
  iterRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-test-'));
  // Create .lisa_memory/ so adapters that open lisa.db have a directory
  fs.mkdirSync(path.join(iterRoot, '.lisa_memory'));
  // Set env vars the way the orchestrator would
  process.env.LISA_DB_ROOT    = iterRoot;
  process.env.LISA_MEMORY_DIR = path.join(iterRoot, '.lisa_memory');
});

afterEach(() => {
  fs.rmSync(iterRoot, { recursive: true, force: true });
  delete process.env.LISA_DB_ROOT;
  delete process.env.LISA_MEMORY_DIR;
});
```

---

## Testing a ScoringAdapter

The scoring adapter reads files from `iterRoot` and writes `fabric-score.json`.
Seed the inputs manually, then assert the output:

```typescript
import { MyScoringAdapter } from './adapters/my-scoring-adapter'; // your adapter path

it('writes fabric-score.json with expected shape', async () => {
  // Arrange — write the inputs the scorer reads
  fs.writeFileSync(
    path.join(iterRoot, 'flow-results.json'),
    JSON.stringify({ stats: { total: 10, passed: 9, failed: 1 }, suites: [] })
  );

  // Act
  const adapter = new MyScoringAdapter();
  const score = await adapter.score(iterRoot);

  // Assert return value
  expect(score.overall).toBeGreaterThanOrEqual(0);
  expect(score.overall).toBeLessThanOrEqual(10);
  expect(score.simulationId).toBeDefined();

  // Assert file written
  const written = JSON.parse(
    fs.readFileSync(path.join(iterRoot, 'fabric-score.json'), 'utf8')
  );
  expect(written.overall).toBe(score.overall);
});
```

---

## Testing a FeedbackAdapter

```typescript
import { MyFeedbackAdapter } from './adapters/my-feedback-adapter'; // your adapter path
import type { FabricScore } from 'synthetic-test-fabric';

it('writes fabric-feedback.json with correct PersonaAdjustment shape', async () => {
  const score: FabricScore = {
    simulationId: 'test-sim',
    generatedAt: new Date().toISOString(),
    overall: 6.5,
    dimensions: {
      persona_realism: 7,
      coverage_delta: 1,
      fixture_health: 9,
      discovery_yield: 2,
      regression_health: 6,
      flow_coverage: 8,
    },
    details: {},
  };

  const adapter = new MyFeedbackAdapter();
  const feedback = await adapter.feedback(iterRoot, {
    score,
    loopId: 'loop-001',
    iteration: 1,
    previousIterRoot: null,
  });

  // Assert PersonaAdjustment shape
  for (const adj of feedback.persona_adjustments) {
    expect(['pressure.urgency', 'pressure.financial', 'trade']).toContain(adj.field);
    expect(typeof adj.persona_id).toBe('string');
    expect(typeof adj.reason).toBe('string');
  }

  // Assert failed_flows shape
  for (const flow of feedback.failed_flows) {
    expect(typeof flow.spec_title).toBe('string');
    expect(typeof flow.spec_file).toBe('string');
    expect(typeof flow.failure_reason).toBe('string');
  }
});
```

---

## Testing an AppAdapter (seed + verify)

`seed()` must write `mini-sim-export.json` and populate `lisa.db`. Test both:

```typescript
import { applyLisaDbMigrations } from 'synthetic-test-fabric';
import BetterSqlite3 from 'better-sqlite3';
import { MyAppAdapter } from './adapters/my-app-adapter'; // your adapter path

it('seed() writes mini-sim-export.json and populates seeded_entities', async () => {
  // Migrate the db first — same as orchestrator does before calling seed()
  const dbPath = path.join(iterRoot, '.lisa_memory', 'lisa.db');
  const db = new BetterSqlite3(dbPath);
  applyLisaDbMigrations(db);
  db.close();

  const adapter = new MyAppAdapter();
  const entities = await adapter.seed(iterRoot, {
    seekers: 1, employers: 1, employees: 0,
  });

  // mini-sim-export.json must exist and have the right shape
  const exportPath = path.join(iterRoot, 'mini-sim-export.json');
  expect(fs.existsSync(exportPath)).toBe(true);
  const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  expect(Array.isArray(exported.entities)).toBe(true);
  expect(exported.entities.length).toBeGreaterThan(0);

  // seeded_entities rows must exist in lisa.db
  const db2 = new BetterSqlite3(dbPath);
  const rows = db2.prepare('SELECT * FROM seeded_entities').all();
  expect(rows.length).toBeGreaterThan(0);
  db2.close();
});
```

---

## When to use unit tests vs integration tests

| Adapter | Recommended approach |
|---------|---------------------|
| `ScoringAdapter` | Unit — reads/writes local files only |
| `FeedbackAdapter` | Unit — reads/writes local files only |
| `Reporter` | Unit — reads local files, writes output |
| `MemoryAdapter` | Unit — reads/writes `lisa.db` locally |
| `SimulationAdapter` | Integration — calls your simulation service |
| `AppAdapter.seed()` / `verify()` | Integration — calls your product API |
| `AppAdapter.reset()` | Integration — calls your product API |
| `BrowserAdapter.runSpecs()` | Integration — spawns Playwright |

For integration tests, run the full service stack locally (docker-compose,
dev server, etc.) and point `APP_URL` at it. Treat the adapter as a black box:
assert on the files written to `iterRoot`, not on internal state.

---

## Type-checking your adapter implementations

After writing your adapters, run:

```bash
npx tsc --noEmit
```

This catches shape mismatches (wrong `PersonaAdjustment.field`, missing
`PlaywrightFailedFlow` fields, etc.) before you run the loop.

If you maintain a separate `tsconfig` that excludes your adapter files, create
an explicit type-check script that includes them:

```bash
npx tsc --project tsconfig.adapters.json --noEmit
```
