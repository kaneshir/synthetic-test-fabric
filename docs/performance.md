# Performance Guide

How fast is Synthetic Test Fabric? What are the levers? When should you use `ApiExecutor` vs. Playwright? How does run time scale with ticks and iterations?

---

## Benchmark: ApiExecutor vs. Playwright

The most important performance decision in the framework is whether your simulation agents use `ApiExecutor` or a real browser.

We benchmarked this directly. The setup: a mock HTTP server with login and dashboard endpoints, 50 sequential requests, measured median latency per request.

| Runner | Median latency | P95 latency | Notes |
|--------|---------------|-------------|-------|
| `ApiExecutor` | 3ms | 8ms | HTTP only, no DOM, no JS execution |
| Playwright (headless) | 241ms | 380ms | Full browser, page evaluation, screenshots |

**80× faster.** This compounds across ticks. A 20-tick simulation with 3 actions per tick:

| Runner | Estimated time |
|--------|---------------|
| `ApiExecutor` | ~180ms |
| Playwright (headless) | ~14.5s |

Run the benchmark yourself:

```bash
npm run benchmark
# or
npx tsx demo/benchmark.ts
```

---

## When to use `ApiExecutor` vs. Playwright in simulation

The simulation phase (RUN) is about generating behavior events — recording what paths agents take through the product. The TEST phase is about executing flows against the real UI.

**Use `ApiExecutor` for simulation when:**
- Your simulation agents interact through a REST/GraphQL API
- You want maximum throughput (many agents, many ticks)
- You don't need visual state from the browser
- The product behavior under test is at the API level

**Use Playwright in simulation when:**
- The product behavior you're simulating is only accessible via the browser (e.g. Flutter web, client-side-only logic)
- You need to verify visual state as part of the simulation tick
- The behavior event you're recording requires DOM interaction

**Typical architecture:** Use `ApiExecutor` for 90% of simulation ticks (navigation, data submission, state transitions) and Playwright only for the TEST phase where you need real browser assertions.

---

## Run time breakdown

A typical iteration at various configurations:

### Fast (CI smoke, `--no-llm`)

| Phase | Time |
|-------|------|
| SEED | 1–3s |
| VERIFY | < 0.1s |
| RUN (10 ticks, ApiExecutor) | 0.2–1s |
| ANALYZE | 0.1–0.5s |
| GENERATE_FLOWS | 0.5–2s |
| TEST (8 flows, Playwright) | 15–30s |
| SCORE | < 0.2s |
| FEEDBACK | < 0.1s |
| **Total** | **~20–40s** |

### Standard (CI regression, live LLM)

| Phase | Time |
|-------|------|
| SEED | 2–10s |
| VERIFY | < 0.1s |
| RUN (10 ticks, LLM-driven) | 30–90s |
| ANALYZE | 1–3s |
| GENERATE_FLOWS (with lisa-mcp) | 15–60s |
| TEST (20 flows, Playwright) | 60–120s |
| SCORE | < 0.5s |
| FEEDBACK | < 0.2s |
| **Total** | **~3–5min** |

### Nightly (5 iterations, live LLM, many personas)

| Iterations | Estimated total |
|-----------|----------------|
| 3 | 10–20min |
| 5 | 18–35min |
| 10 | 40–75min |

Times vary significantly with LLM provider latency and the number of Playwright flows in the regression suite.

---

## Tuning tick count

More ticks = more behavior events = more observed paths = better `coverage_delta`. But there are diminishing returns.

**Rule of thumb:** A persona needs approximately `(goal_path_depth + 2)` ticks to reach its goal reliably. For a goal that requires 5 steps, plan for 7–8 ticks.

After a persona reaches its goal, additional ticks produce secondary exploration (if `risk_tolerance` is high) or idle ticks (if `risk_tolerance` is low). Explorer personas benefit from extra ticks; high-urgency personas don't.

**Starting point:** `ticks: 10` covers most goals adequately. Increase to 15–20 if `persona_realism` is low and you suspect goals aren't being reached.

**Diminishing returns threshold:** After ~20 ticks per persona, additional ticks rarely discover meaningfully new paths for most products. The exception: complex multi-step workflows (application → review → interview scheduling → offer) that genuinely require many sequential steps.

---

## Tuning persona count

More personas = more coverage variance = more novel paths. But each persona adds full tick overhead.

**Formula:** `total_simulation_time ≈ personas × ticks × time_per_tick`

**Starting point:** 2 seekers + 1 employer. This covers the primary use case axes without long run times.

**For nightly loops:** 4–6 seekers + 2–3 employers with diverse pressure profiles produces significantly better coverage variance.

**Don't add personas just to add personas.** Five personas with the same high-urgency pressure profile don't produce 5× the coverage — they converge on the same paths. Diversity in pressure profiles matters more than count.

---

## LLM provider performance

In `liveLlm: true` mode, LLM latency dominates the RUN phase.

| Provider | Typical latency per decision | Notes |
|----------|------------------------------|-------|
| Gemini 2.0 Flash | 300–800ms | Recommended for production |
| Gemini 1.5 Flash | 200–600ms | Slightly lower quality |
| Ollama (Llama 3.1 8B, local) | 1–4s | CPU-only; faster on GPU |
| Ollama (Llama 3.1 70B, local) | 8–20s | High quality, very slow on CPU |

For CI, Gemini 2.0 Flash is the recommended provider. For local development, `--no-llm` (deterministic mode) is usually faster and sufficient for adapter development.

---

## Playwright performance in the TEST phase

The TEST phase runs Playwright against the full `flows/` directory. A large spec collection takes time.

**Parallelism:** Playwright runs workers in parallel by default. The number of workers is configured in `playwright.config.ts`. Increase workers for faster test runs; decrease for less CPU contention.

```typescript
// playwright.config.ts
export default defineConfig({
  workers: process.env.CI ? 4 : 2,
  // ...
});
```

**Timeouts:** Playwright's default action timeout is 30s. For fast test environments, reduce to 10s to catch slow renders earlier:

```typescript
use: {
  actionTimeout: 10_000,
  navigationTimeout: 15_000,
},
```

**Spec count scaling:** Each new flow added by GENERATE_FLOWS adds to the TEST phase duration. Monitor the growth:

```bash
ls flows/*.spec.ts | wc -l
```

When the spec count grows beyond ~50, consider splitting into priority tiers (critical path flows always run; secondary flows run nightly only).

---

## Memory usage

| Component | Approximate memory |
|-----------|-------------------|
| `BehaviorEventRecorder` + SQLite | 20–40MB |
| Playwright (per worker) | 100–200MB |
| `ApiExecutor` (per instance) | < 5MB |
| `FlakinessTracker` | < 5MB |
| `VisualRegression` baseline images | Depends on count and resolution |

For CI, plan for 2–4GB total for a standard regression run with 4 Playwright workers.

---

## Caching between CI runs

**Node modules:** Cache `node_modules` across CI runs using your CI provider's cache action. `npm ci` without cache takes 30–60s; with cache, 2–5s.

**Playwright browsers:** Cache `~/.cache/ms-playwright`. Browser download takes 1–2 minutes; cache hit takes < 1s.

**`flows/` directory:** Generated specs should be committed to the repo, not re-generated on every CI run. The GENERATE_FLOWS phase only runs when `candidate_flows.yaml` has new paths — if the spec already exists in `flows/`, it's skipped.

**`lisa.db`:** Do not cache between CI runs. Each iteration needs a fresh database. The `.lisa_memory/` directory is ephemeral by design.

---

## Demo benchmark

The `demo/benchmark.ts` file in the repo runs a concrete comparison between `ApiExecutor` and Playwright for a login+dashboard flow:

```bash
npm run benchmark
```

Expected output:

```
=== ApiExecutor benchmark (50 requests) ===
  median:  3ms
  p95:     8ms
  total:   182ms

=== Playwright benchmark (50 page loads) ===
  median:  241ms
  p95:     380ms
  total:   12,142ms

speedup: 66.7× (median), 47.5× (p95)
```

The exact speedup varies by machine, browser, and app complexity — but the order of magnitude holds.
