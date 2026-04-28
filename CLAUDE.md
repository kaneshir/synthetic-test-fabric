# CLAUDE.md — synthetic-test-fabric

Guidance for Claude Code when working in this repository.

---

## What this repo is

`synthetic-test-fabric` is a public npm package. It is the orchestration
framework for an autonomous QA loop. It is **not** a BlueSkil repo — it is
product-neutral. BlueSkil is one consumer; a second product was onboarded
without changing any framework code.

Do not add BlueSkil-specific logic, fixture aliases, scenario names, or
Firebase references to this repo.

---

## Repository layout

```
src/                  Framework source (TypeScript)
  orchestrator.ts     FabricOrchestrator — loop state machine
  adapters.ts         All eight adapter interfaces
  schema.ts           FabricScore, PersonaDefinition, BehaviorEvent, etc.
  run-root.ts         applyLisaDbMigrations, resolveRunRoot
  score.ts            Scoring dimension calculation
  screen-path.ts      Path extraction from behavior events
  persona.ts          Persona seeding utilities
  *.test.ts           Unit tests (Jest)

demo/                 Reference implementation (no external dependencies)
  app/                Static HTML taskboard app (file:// compatible)
  adapters.ts         8 demo adapter classes
  flows/              Demo Playwright specs
  playwright.config.ts baseURL: file://${appDir}/
  run.ts              Entry point

docs/
  overview.md         What STF is and why
  architecture.md     Loop model, adapters, schema, design decisions
  adapter-contract.md Full interface definitions
  run-root-contract.md Artifact layout, env vars, lifecycle
  quickstart.md       Step-by-step wiring guide
  value-proposition.md VP-level strategic document
```

---

## Key invariants

**Adapter seam is the product boundary.** The framework owns the loop. The
product owns the adapters. These must never mix. If you find yourself adding
product knowledge to `src/`, stop.

**Run root is the only coupling between phases.** No adapter calls another
adapter directly. They read and write files under `iterRoot`. This is
enforced by design — don't introduce direct calls.

**Demo must work with zero external services.** `npm run demo` must run
offline. The demo app uses `file://` URLs (not an HTTP server) so
Playwright can load pages without a running server. Do not change this.

**`lisa.db` path comes from env vars, never hardcoded.** All SQLite access
uses `process.env.LISA_DB_ROOT` or `process.env.LISA_MEMORY_DIR`. The
orchestrator sets these before calling adapters.

---

## Essential commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm test             # Run Jest unit tests
npm run demo         # Run the demo loop (no external deps required)
npm pack --dry-run   # Verify package contents before publish
```

Demo flow:
```bash
npm run demo
# Runs: SEED → VERIFY → RUN → ANALYZE → GENERATE_FLOWS → TEST → SCORE → FEEDBACK
# All artifacts written to a temp run root under /tmp/stf-demo-*
```

---

## Adding a new adapter interface method

1. Add the method to the interface in `src/adapters.ts`
2. Add a default no-op or throw in `FabricOrchestrator` if optional
3. Update `demo/adapters.ts` with a minimal reference implementation
4. Update `docs/adapter-contract.md`
5. Do not change BlueSkil's adapter implementations (separate repo)

---

## Publishing

This package is public (`publishConfig: { access: "public" }`).

Before publishing:
1. Verify `npm pack --dry-run` includes only `dist/`, `docs/`, `demo/`, `LICENSE`, `README.md`
2. Verify `dist/` is compiled from latest `src/`
3. Bump version in `package.json`
4. Tag the commit

Do not publish from a branch. Publish from `main` only.

---

## What belongs in the BlueSkil repo, not here

- Fixture alias conventions (`account.primary_seeker`, etc.)
- Scenario catalog (`interview_today`, `offer_follow_up`, etc.)
- BlueSkil adapter implementations (`BlueSkilAppAdapter`, etc.)
- BlueSkil CLI commands (`blu test fabric *`)
- Lisa MCP server wiring (in `kaneshir/dev-infra` → `@kaneshir/lisa-mcp`)
- Firebase, Firestore, or Stripe references of any kind

If you're unsure whether something belongs here or in the product repo,
ask: "would a second unrelated product need this?" If no, it goes in the
product repo.
