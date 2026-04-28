# Roadmap

This document describes what's planned for Synthetic Test Fabric. It is a living document — priorities shift based on what we learn from production use. If something here matters to you, open an issue and say so.

---

## Guiding principles

Every item on this roadmap is evaluated against three questions:

1. **Does it make the adapter seam more powerful or easier to implement?**
2. **Does it increase the signal-to-noise ratio of the feedback loop?**
3. **Does it reduce adoption friction without introducing product-specific logic into the framework?**

Items that fail all three don't make it in.

---

## v0.2.0 — Adapter ergonomics + coverage depth

**Planned:**

- **`fab smoke --app <path>` without config file** — run a smoke check with inline adapter paths, no `fabric.config.ts` required. Lowers the barrier to first run.
- **`FlakinessTracker` quarantine surfaced in `fab flows` output** — quarantined flows shown as skipped (not missing) in Playwright output, with a note explaining why.
- **`VisualRegression` diff images in HTML report** — inline before/after comparison. Currently the HTML report shows the diff percentage; v0.2 shows the actual pixel diff image.
- **Scenario planner confidence scores** — `ScenarioPlan.rationale` extended with a `confidence` field (0–1) so adapters can decide whether to apply the recommendation or override.
- **`fab orchestrate --resume <loopId>`** — resume an interrupted loop from the last completed iteration instead of starting over.
- **TypeScript strict mode throughout** — internal codebase cleanup; no user-visible changes.

---

## v0.3.0 — CI and reporting

**Planned:**

- **GitHub Actions reporter** — `GitHubReporter` writes a PR check with score summary and dimension breakdown as a commit status + comment. No external service needed — uses `GITHUB_TOKEN`.
- **Datadog reporter** — `DatadogReporter` submits score and dimension metrics as custom metrics. Monitor STF score alongside your SLOs.
- **Score trend in Slack message** — `SlackReporter` extended with a sparkline showing score trend over the last 7 runs.
- **`fab check --dimension regression_health --threshold 9.0`** — per-dimension thresholds in the score gate. Block deploys on regression health specifically, not just overall.
- **Artifact retention policy** — `fab orchestrate --keep <n>` retains only the last N run roots, auto-deletes older ones. Prevents unbounded disk growth on long-running loops.

---

## v0.4.0 — Platform expansion

**Planned:**

- **Windows support for `@kaneshir/lisa-mcp`** — `lisa_mcp-win32-x64` binary. First platform target after macOS and Linux.
- **`@kaneshir/lisa-mcp` automated publish pipeline** — currently the npm package is published manually. v0.4 adds CI automation to the private dev-infra repo: build + test + publish on tag.
- **Mobile web support** — `VisualRegression` and `BrowserAdapter` extended to support Playwright's mobile device emulation. Baselines are keyed by device profile.

---

## v0.5.0 — Multi-product and ecosystem

**Planned:**

- **Toknize adapter layer** — reference implementation for a second product (Toknize). Validates that the adapter seam is genuinely product-neutral for a non-BlueSkil codebase.
- **Adapter marketplace concept** — a registry of community adapter implementations (e.g., "Next.js App Router adapter", "Django REST adapter"). Not a runtime feature — a community doc and namespace convention.
- **`fab validate-adapters`** — dry-run command that instantiates all adapters and calls `validateEnvironment()` without running the loop. Fast health check for CI setup.

---

## Longer term (unscheduled)

These are directionally planned but not yet sized:

**Parallel iteration runs** — run N iterations concurrently instead of sequentially. Significant infrastructure change (each iteration needs isolated state), but would make nightly loops much faster.

**Persona library marketplace** — community-contributed persona YAML files for common user archetypes (e-commerce shopper, job seeker, admin user, etc.). Not product-specific — persona templates that adapters can extend.

**LLM provider abstraction** ✅ *shipped in v0.2* — `LlmProvider` interface with five built-in providers (`ClaudeCliProvider`, `ClaudeSdkProvider`, `GeminiProvider`, `OllamaProvider`, `OpenAIProvider`). Claude CLI is the default; any provider is pluggable via `OrchestratorOptions.llmProvider`.

**Score history persistence** — `FabricScore` history persisted to Postgres so trend data survives run root deletion. The HTML reporter currently reads trend from the run root files; Postgres would enable querying across months.

**Adversarial probe templates** — a library of pre-built adversarial probe patterns (OWASP top 10, common validation bypasses, rate limit patterns). Currently adversarial behavior is driven entirely by persona YAML — templates would give teams a starting point.

---

## What is explicitly out of scope

These are not on the roadmap and will not be added:

**A proprietary assertion DSL.** Generated specs are plain Playwright. They remain plain Playwright.

**A cloud-hosted version.** STF runs on your infrastructure. There are no plans for a hosted SaaS variant.

**Non-web targets.** The framework is built around browser automation and HTTP APIs. Mobile native (iOS simulator, Android instrumentation) is not a planned target.

**Automatic code fixes.** The feedback loop surfaces what's broken and where to look — it does not attempt to fix product code. That requires product understanding the framework intentionally doesn't have.

---

## Contributing

If you want to work on something from this list, check the GitHub issues for an existing discussion before starting. Items marked as planned may already have a design discussion in progress.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to contribute.
