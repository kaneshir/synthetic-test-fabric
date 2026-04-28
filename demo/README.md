# Demo

A self-contained reference implementation of all eight STF adapter interfaces,
running against a static HTML Taskboard app with no external dependencies.

**Purpose:** Prove the framework loop works end-to-end. Not a template for
production adapters — see `docs/adapter-contract.md` for that.

---

## Running

```bash
# From the repo root — builds first, then runs the full loop
npm run demo

# Multiple iterations
npx tsx demo/run.ts --iterations 3

# Allow regression failures (useful when exploring)
npx tsx demo/run.ts --allow-regression-failures
```

First run installs Playwright's Chromium browser (~170 MB). Subsequent runs
use the cached download.

Expected output: `✓ Demo complete.` with a score report. Full loop takes
under 30 seconds.

---

## What's in here

| File / Dir | What it does |
|---|---|
| `app/index.html` | Static HTML Taskboard app — no server, loaded via `file://` |
| `adapters.ts` | All eight adapter implementations wired to the Taskboard |
| `flows/navigation.spec.ts` | Regression suite (11 specs) — the permanent baseline |
| `playwright.config.ts` | Playwright config for the regression suite |
| `generated-playwright.config.ts` | Playwright config for the GENERATE_FLOWS output |
| `run.ts` | Entry point — wires adapters and calls `FabricOrchestrator.run()` |
| `benchmark.ts` | ApiExecutor vs Playwright latency comparison |
| `.env.example` | Documents all provider env vars |

---

## Architecture

The Taskboard app is loaded via `file://` URLs so Playwright can run without a
running HTTP server. This is intentional — it keeps the demo dependency-free.

The demo adapters intentionally include one known gap:
`task_creation_validation` — the app has no empty-title validation, so this
generated spec fails by design. This exercises the gap-discovery dimension of
the scoring loop.

`@kaneshir/lisa-mcp` is used in `exportEntities` for screen path key mapping
when available. Falls back to a static key map when not installed.

---

## Extending the demo

The demo adapters are the simplest valid implementations of each interface.
To experiment:

- **Change the simulation** — edit `DemoSimulationAdapter.run()` in
  `adapters.ts` to produce different behavior events
- **Add regression specs** — add `.spec.ts` files to `flows/`
- **Change the app** — edit `app/index.html` and update the adapters to match

Do not commit product-specific logic to the demo — it must remain app-neutral.
See `CLAUDE.md` for the invariants.
