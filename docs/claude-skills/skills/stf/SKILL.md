---
name: stf
description: Drive the Synthetic Test Fabric (`fab` CLI / `fab-mcp` server) — scaffold projects, validate adapters, run loops, inspect results. Use when the user references STF, fabric, autonomous QA loops, fabric-score, or asks to wire a new product into the autonomous test pipeline.
allowed-tools: Bash, Read, Edit, Write
---

# STF — Synthetic Test Fabric

Closed-loop QA framework: synthetic users → simulated behavior → generated
flows → scored results → feedback drives the next iteration.

## When to use this skill

Trigger on any of:

- "set up STF for `<product>`"
- "scaffold a fabric project" / "wire a new adapter"
- "run the loop" / "score the run" / "explain why the score dropped"
- "is my environment broken" / "diagnose this CI failure"
- "test the new feature" / "smoke check via fabric"
- references to: `fab`, `fab-mcp`, `fabric.config.ts`, `loopRoot`/`iterRoot`,
  `fabric-score.json`, `behavior_events`, `adapters/`

## Tool preference order

When `fab-mcp` is installed in the user's `~/.claude/.mcp.json`, prefer the
native `stf_*` MCP tools — they're typed, discoverable via `tools/list`, and
return structured envelopes the planner can branch on directly.

When `fab-mcp` isn't available, shell out to `fab <command> --json` and parse
the envelope. Same data, slightly more friction.

## Decision tree

| Intent | MCP tool | Bash |
|--------|----------|------|
| Scaffold a new project | `stf_init` | `fab init` |
| Generate one new adapter | `stf_adapter_scaffold` | `fab adapter scaffold <type>` |
| Validate an adapter implementation | `stf_adapter_validate` | `fab adapter validate <path>` |
| Pre-flight env health check | `stf_doctor` | `fab doctor` |
| Quick smoke check | `stf_smoke` | `fab smoke` |
| Full orchestration loop | `stf_orchestrate` | `fab orchestrate` |
| "Where am I?" cross-run state | `stf_status` | `fab status` |
| Structured run-root summary | `stf_inspect` | `fab inspect --root <dir>` |
| Compute score | `stf_score` | `fab score --root <dir>` |
| CI threshold gate | `stf_check` | `fab check --threshold N` |
| Run flows | `stf_flows` | `fab flows --root <dir>` |
| Visual baselines | `stf_baseline_*` | `fab baseline list/update/reset` |

## CLI outcome taxonomy (read this once)

Every command emits one of three outcomes (per `docs/cli-json-output.md`):

| Outcome | Envelope | Exit |
|---------|----------|------|
| Success | `{status: "ok", data: ...}` (or `data.ok: true`) | 0 |
| Domain failure (tool worked, found problems) | `{status: "ok", data: {ok: false, ...}}` | 1 |
| Infrastructure error (tool couldn't run) | `{status: "error", error: {...}}` | 1 |

**Key off both** the exit code AND the envelope fields. `status` describes
infrastructure outcome; `data.ok` describes domain outcome where applicable.
Don't conflate them — `status: "ok"` + exit 1 is a normal domain failure.

## Common workflows

### Onboarding a new product to STF

```bash
fab init --dir ./my-project --json     # scaffold project + 8 adapter stubs
cd ./my-project
# ... fill in TODOs in src/adapters/*.ts ...
fab doctor --json                       # verify env + deps
fab adapter validate src/adapters/MyAppAdapter.ts --json
fab smoke --keep --json                 # run one bounded smoke flow
fab inspect --root <last> --json        # see what happened
```

### Debugging a low score

```bash
fab status --json                       # find the last run root
fab inspect --root <root> --json        # phase, score, errors, recent events
# → fix in src/adapters/, then:
fab smoke --root <root> --keep --json
```

### Adding a new reporter

```bash
fab adapter scaffold reporter --out src/adapters/MySlackReporter.ts --name MySlackReporter --json
fab adapter validate src/adapters/MySlackReporter.ts --json
# wire it into fabric.config.ts: reporters: [new MySlackReporter(), ...]
fab doctor --json                       # confirm config still loads
```

## Anti-patterns to avoid

- **Don't use `--json` and parse stdout text simultaneously.** `--json` mode
  guarantees exactly one envelope on stdout; progress lines route to stderr.
- **Don't ignore `data.ok: false` results.** They mean the tool worked but
  found problems — surface them to the user, don't auto-retry.
- **Don't bypass `fab doctor` when onboarding.** It catches missing peer deps
  (lisa-mcp when LISA_LLM_PROVIDER is set, etc.) before the loop fails.
- **Don't pass `--root` to `fab status` or `fab init`.** `status` reads from
  `~/.fab/state.json`; `init` writes a new project at `--dir`.

## MCP install (recommended)

Add to `~/.claude/.mcp.json`:

```json
{
  "mcpServers": {
    "fab": {
      "command": "fab-mcp"
    }
  }
}
```

If `fab-mcp` isn't on PATH, use `npx fab-mcp` or the absolute path to
`node_modules/.bin/fab-mcp`. See `docs/mcp-install.md` (added in #27) for
full details.
