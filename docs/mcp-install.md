# `fab-mcp` — install + usage

`fab-mcp` is the Model Context Protocol server that wraps every `fab` command
as a typed MCP tool. Install it once in your Claude Code MCP config and the
agent can drive STF without bash + JSON parsing.

---

## Install

After `npm install synthetic-test-fabric`, add `fab-mcp` to your Claude Code
MCP config (`~/.claude/.mcp.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "fab": {
      "command": "fab-mcp"
    }
  }
}
```

If `fab-mcp` isn't on `PATH`, point at the absolute path or use `npx`:

```json
{
  "mcpServers": {
    "fab": {
      "command": "npx",
      "args": ["fab-mcp"]
    }
  }
}
```

Or for development against a checked-out copy:

```json
{
  "mcpServers": {
    "fab": {
      "command": "node",
      "args": ["/abs/path/to/synthetic-test-fabric/dist/mcp/server.js"]
    }
  }
}
```

Verify by asking Claude `tools/list` for the `fab` server, or call
`stf_status` directly.

---

## Tool surface (19 tools)

All tools prefixed `stf_*`. Same data and same outcome semantics as the
underlying `fab <command> --json` CLI.

| Tool | Wraps | Tier |
|------|-------|------|
| `stf_status`            | `fab status`            | short (~1s) |
| `stf_inspect`           | `fab inspect`           | short |
| `stf_init`              | `fab init`              | short |
| `stf_doctor`            | `fab doctor`            | medium (~2min) |
| `stf_score`             | `fab score`             | short |
| `stf_seed`              | `fab seed`              | short |
| `stf_verify`            | `fab verify`            | short |
| `stf_feedback`          | `fab feedback`          | short |
| `stf_analyze`           | `fab analyze`           | short |
| `stf_check`             | `fab check`             | short |
| `stf_baseline_list`     | `fab baseline list`     | short |
| `stf_baseline_update`   | `fab baseline update`   | short |
| `stf_baseline_reset`    | `fab baseline reset`    | short |
| `stf_adapter_scaffold`  | `fab adapter scaffold`  | short |
| `stf_adapter_validate`  | `fab adapter validate`  | short |
| `stf_smoke`             | `fab smoke`             | medium |
| `stf_flows`             | `fab flows`             | long (~5min) |
| `stf_fresh`             | `fab fresh`             | very long (~30min) |
| `stf_orchestrate`       | `fab orchestrate`       | very long (~30min) |

---

## Outcome contract

`fab-mcp` honors the #18 envelope taxonomy verbatim. Every tool response
carries one JSON envelope in `content[0].text`:

| `fab` envelope | MCP response | Read this from your agent |
|----------------|--------------|---------------------------|
| `status: "ok"`, `data.ok: true` (or just `data: {...}`) | success, content carries envelope | tool worked, use `data` |
| `status: "ok"`, `data.ok: false` | success (NOT `isError`), content carries envelope | tool worked, your input failed a check (e.g. `stf_check` below threshold, `stf_adapter_validate` found missing methods) — fix and retry |
| `status: "error"` | **MCP error** (`isError: true`), content carries full envelope | tool itself broke (file not found, parse error, etc.) — full envelope JSON in content so `error.code` (e.g. `AMBIGUOUS_ROOT`, `UNKNOWN_ROOT`, `INIT_CONFLICT`) survives the transport |

**Always read both** the `isError` flag AND the envelope JSON in `content`.
`isError: false` + `data.ok: false` is a normal domain failure.

---

## Timeout policy

Each tool has a default timeout (see "Tier" column above). Long-running tools
accept an optional `timeout_ms` input parameter to override per call:

```jsonc
// Override stf_orchestrate's default 30min timeout to 60min:
{ "name": "stf_orchestrate", "arguments": { "iterations": 5, "timeout_ms": 3600000 } }
```

Global override via env: `FAB_MCP_TIMEOUT_MS=600000`.

On timeout, `fab-mcp` SIGTERMs the child, escalates to SIGKILL after 5s, and
returns an MCP error with `error.code: "TIMEOUT"` and the last ~50 lines of
child stderr.

---

## Stderr forwarding

Adapter / reporter / orchestrator progress lines (which `fab` routes to
stderr in `--json` mode) are forwarded as MCP `notifications/message` log
notifications. Your agent sees real-time progress AND a clean envelope at
the end — neither contaminates the other.

---

## Path resolution

`fab-mcp` resolves the bundled `fab` CLI relative to its own module location,
not the consumer's cwd. Spawns via `process.execPath` (the running Node
binary) to avoid PATH or version mismatches. Works when launched from any
project directory.

---

## Active config

`fab-mcp` propagates `FAB_CONFIG_PATH` and `FAB_STATE_DIR` to every child.
Set them in your MCP config's `env`:

```json
{
  "mcpServers": {
    "fab": {
      "command": "fab-mcp",
      "env": {
        "FAB_CONFIG_PATH": "/abs/path/to/fabric.config.ts",
        "FAB_STATE_DIR": "/abs/path/to/.fab"
      }
    }
  }
}
```
