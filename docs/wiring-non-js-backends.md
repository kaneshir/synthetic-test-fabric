# Wiring Non-JS Backends

Adapter implementations must be JavaScript or TypeScript — they are called
in-process by the orchestrator. But the logic your adapters invoke can be in
any language. This doc shows three concrete patterns.

---

## Which adapters typically call out-of-process

| Adapter | Typical implementation |
|---------|----------------------|
| `SimulationAdapter.run()` | Subprocess or HTTP — simulation engines are usually a separate service |
| `AppAdapter.seed()` / `verify()` | HTTP — calls your product's REST API or admin DB |
| `AppAdapter.reset()` | HTTP or subprocess |
| `BrowserAdapter.runSpecs()` | Always spawns Playwright as a subprocess |
| `ScoringAdapter` | Usually in-process — reads files, computes score |
| `FeedbackAdapter` | Usually in-process — reads files, writes JSON |
| `Reporter` | Usually in-process — formats and writes output |

---

## Pattern A — HTTP / REST service

Your backend (Go, Python, Ruby, etc.) runs as an HTTP server. The adapter
calls it with `fetch()`.

```typescript
import type { SimulationAdapter, SimulationRunResult } from 'synthetic-test-fabric';

export class MySimulationAdapter implements SimulationAdapter {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.SIM_SERVICE_URL ?? 'http://localhost:8080') {
    this.baseUrl = baseUrl;
  }

  async run(iterRoot: string, options: { ticks: number; liveLlm: boolean; simulationId?: string }):
      Promise<SimulationRunResult> {
    const res = await fetch(`${this.baseUrl}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000),   // 2-minute timeout
      body: JSON.stringify({
        iter_root: iterRoot,
        ticks: options.ticks,
        live_llm: options.liveLlm,
        simulation_id: options.simulationId,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`[sim] HTTP ${res.status}: ${body}`);
    }

    return res.json() as Promise<SimulationRunResult>;
  }

  async exportEntities(iterRoot: string, entities: import('synthetic-test-fabric').SeededEntity[]):
      Promise<void> {
    // write candidate_flows.yaml or similar — can also be in-process
  }

  async clean(iterRoot: string): Promise<void> {}
}
```

**Go server counterpart (minimal):**

```go
http.HandleFunc("/simulate", func(w http.ResponseWriter, r *http.Request) {
    var req struct {
        IterRoot     string `json:"iter_root"`
        Ticks        int    `json:"ticks"`
        SimulationID string `json:"simulation_id"`
    }
    json.NewDecoder(r.Body).Decode(&req)

    // ... run your simulation, write behavior events to lisa.db at req.IterRoot ...

    json.NewEncoder(w).Encode(map[string]any{
        "simulationId":          req.SimulationID,
        "ticksCompleted":        req.Ticks,
        "behaviorEventsWritten": 42,
    })
})
http.ListenAndServe(":8080", nil)
```

**Error handling rules:**
- Non-2xx response → throw with status + body so the orchestrator logs
  the real error
- Network timeout → `AbortSignal.timeout()` throws `DOMException` — let it
  propagate; orchestrator will abort the iteration with a clear message
- Never swallow errors and return fake results — the orchestrator trusts the
  return value

---

## Pattern B — Subprocess (compiled binary or script)

Your backend runs as a short-lived process invoked per adapter call. Use
`execFileSync` for simplicity or `spawn` for streaming output.

```typescript
import { execFileSync } from 'child_process';
import * as path from 'path';
import type { SimulationAdapter, SimulationRunResult } from 'synthetic-test-fabric';

export class MySimulationAdapter implements SimulationAdapter {
  async run(iterRoot: string, options: { ticks: number; liveLlm: boolean; simulationId?: string }):
      Promise<SimulationRunResult> {
    const lisaMemoryDir = path.join(iterRoot, '.lisa_memory');

    let stdout: Buffer;
    try {
      stdout = execFileSync('./bin/sim', [
        '--iter-root', iterRoot,
        '--ticks', String(options.ticks),
        '--simulation-id', options.simulationId ?? '',
      ], {
        timeout: 120_000,
        env: {
          ...process.env,
          // These are NOT set by the framework — the adapter must inject them
          LISA_DB_ROOT:     iterRoot,
          LISA_MEMORY_DIR:  lisaMemoryDir,
        },
      });
    } catch (err: any) {
      // execFileSync throws on non-zero exit — include stderr in the message
      const stderr = err.stderr?.toString() ?? '';
      throw new Error(`[sim] process exited with code ${err.status}: ${stderr}`);
    }

    try {
      return JSON.parse(stdout.toString()) as SimulationRunResult;
    } catch {
      throw new Error(`[sim] invalid JSON from subprocess: ${stdout.toString().slice(0, 200)}`);
    }
  }

  async exportEntities(iterRoot: string, entities: import('synthetic-test-fabric').SeededEntity[]):
      Promise<void> {}

  async clean(iterRoot: string): Promise<void> {}
}
```

**Env var injection — critical:** The orchestrator does not inject
`LISA_DB_ROOT` or `LISA_MEMORY_DIR` into subprocess environments. Any
subprocess that needs to open `lisa.db` must receive these vars from the
adapter (as shown above). Forgetting this is the most common wiring mistake.

**Python script counterpart:**

```python
#!/usr/bin/env python3
import json, os, sys

iter_root = None
ticks = 5
simulation_id = ''

args = sys.argv[1:]
for i, a in enumerate(args):
    if a == '--iter-root':   iter_root = args[i+1]
    if a == '--ticks':       ticks = int(args[i+1])
    if a == '--simulation-id': simulation_id = args[i+1]

lisa_db = os.path.join(os.environ['LISA_MEMORY_DIR'], 'lisa.db')

# ... run simulation, write events to lisa_db ...

print(json.dumps({
    "simulationId": simulation_id,
    "ticksCompleted": ticks,
    "behaviorEventsWritten": 0,
}))
```

---

## Pattern C — gRPC

Use when your simulation service already exposes a gRPC API.

```typescript
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { SimulationAdapter, SimulationRunResult } from 'synthetic-test-fabric';

const pkgDef = protoLoader.loadSync('sim.proto');
const SimService = (grpc.loadPackageDefinition(pkgDef) as any).sim.SimService;

export class MySimulationAdapter implements SimulationAdapter {
  private readonly client: any;

  constructor(address = 'localhost:50051') {
    this.client = new SimService(address, grpc.credentials.createInsecure());
  }

  async run(iterRoot: string, options: { ticks: number; liveLlm: boolean; simulationId?: string }):
      Promise<SimulationRunResult> {
    return new Promise((resolve, reject) => {
      this.client.Run(
        { iterRoot, ticks: options.ticks, simulationId: options.simulationId },
        (err: Error | null, res: SimulationRunResult) => {
          if (err) reject(err);
          else resolve(res);
        }
      );
    });
  }

  async exportEntities(iterRoot: string, entities: any[]): Promise<void> {}
  async clean(iterRoot: string): Promise<void> {}
}
```

---

## AppAdapter wiring patterns

`AppAdapter.seed()` typically calls your product's admin API to create test
users and state. The API call pattern is the same as Pattern A:

```typescript
export class MyAppAdapter implements AppAdapter {
  private readonly apiUrl = process.env.APP_URL ?? 'http://localhost:3000';
  private readonly apiKey = process.env.APP_API_KEY;

  async validateEnvironment(): Promise<AppHealthResult> {
    const errors: string[] = [];
    if (!this.apiKey) errors.push('APP_API_KEY is not set');
    try {
      const res = await fetch(`${this.apiUrl}/health`, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) errors.push(`App health check returned ${res.status}`);
    } catch (err) {
      errors.push(`App unreachable at ${this.apiUrl}: ${err}`);
    }
    return { healthy: errors.length === 0, errors, warnings: [] };
  }

  async seed(iterRoot: string, config: { seekers: number; employers: number; employees: number }):
      Promise<SeededEntity[]> {
    const res = await fetch(`${this.apiUrl}/admin/seed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error(`[seed] HTTP ${res.status}`);
    const { entities } = await res.json();

    // Write mini-sim-export.json — required for downstream phases
    const exportPath = path.join(iterRoot, 'mini-sim-export.json');
    fs.writeFileSync(exportPath, JSON.stringify({ entities, simulation_id: entities[0]?.id }));

    return entities;
  }
  // ...
}
```

---

## Common mistakes

**Not injecting `LISA_DB_ROOT` / `LISA_MEMORY_DIR` into subprocess env**
The framework does not set these. Subprocesses that try to open `lisa.db`
without them will either fail or create a db at the wrong path.

**Swallowing subprocess stderr**
Always include stderr in thrown errors. The orchestrator logs the error
message — if it's empty, debugging takes much longer.

**Not writing `mini-sim-export.json` in `AppAdapter.seed()`**
The ANALYZE phase reads this file. If it's absent, `exportEntities()` receives
an empty entity list and `candidate_flows.yaml` will be empty or missing.

**Returning fake results on failure**
Return shapes are trusted. A `SimulationRunResult` with `ticksCompleted: 5`
when the simulation actually failed half-way will produce misleading scores.
Throw instead.
