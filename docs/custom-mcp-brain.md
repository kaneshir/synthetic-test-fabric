# Custom MCP Brain — Drop-in Architecture

`@kaneshir/lisa-mcp` is the reference MCP brain for Synthetic Test Fabric, but it is not the only possible one. This document explains how the framework relates to MCP, what "drop-in" actually means in practice, and how to wire a custom MCP server.

---

## How STF and MCP relate

`FabricOrchestrator` has no MCP dependency. It does not spawn, configure, or call any MCP server. Look at the constructor:

```typescript
new FabricOrchestrator({
  app:        AppAdapter,
  simulation: SimulationAdapter,
  scoring:    ScoringAdapter,
  feedback:   FeedbackAdapter,
  memory:     MemoryAdapter,
  browser:    BrowserAdapter,
  reporters:  Reporter[],
  planner:    ScenarioPlanner,
})
```

No MCP config. The orchestrator drives the loop — SEED → GENERATE\_FLOWS → TEST → SCORE → FEEDBACK — by calling adapter methods. It has no knowledge of how those methods are implemented.

**Claude is the one calling MCP tools, not the orchestrator.**

```
FabricOrchestrator
  calls BrowserAdapter.generateFlows()
    ↓
  your BrowserAdapter spawns an MCP server (any server)
    ↓
  Claude makes tool calls against that server
    ↓
  your BrowserAdapter uses the results to write spec files
```

The MCP server is an implementation detail of your `BrowserAdapter`. From the framework's perspective, `generateFlows()` is a black box.

---

## What "drop-in" means

"Drop-in" means replacing `@kaneshir/lisa-mcp` with a different MCP server without touching STF core. Two paths exist:

### Path A — Claude Code direct QA (recommended)

In this model, Claude Code is the consumer. You configure Claude's MCP settings to point at your server. STF's `BrowserAdapter` does not spawn anything — Claude already has the server available.

```json
// .claude/settings.local.json or Claude Desktop config
{
  "mcpServers": {
    "my-brain": {
      "command": "/path/to/my-mcp-server",
      "args": [],
      "env": {
        "LISA_MEMORY_DIR": "/path/to/run-root/.lisa_memory"
      }
    }
  }
}
```

STF core requires no changes. Claude calls tools against your server. Your server implements the [MCP tool contract](./mcp-tool-contract.md).

### Path B — BrowserAdapter spawn

In this model, your `BrowserAdapter.generateFlows()` spawns the MCP server as a subprocess and drives it programmatically.

**If your adapter hardcodes `buildLisaMcpCommand()`**, replacing the brain requires changing the adapter. The pattern to make it configurable:

```typescript
// Instead of hardcoding:
const { cmd, args } = buildLisaMcpCommand();

// Accept the command from config or environment:
const cmd  = process.env.LISA_MCP_CMD  ?? buildLisaMcpCommand().cmd;
const args = process.env.LISA_MCP_ARGS ? JSON.parse(process.env.LISA_MCP_ARGS) : buildLisaMcpCommand().args;
```

Then a custom server is just:
```bash
LISA_MCP_CMD=/path/to/my-mcp-server npm run test:fabric
```

**STF core still requires no changes.** Only the adapter's spawn logic changes.

---

## Minimum tool set

The required tools depend on the use case. See [mcp-tool-contract.md — Minimum required tool set](./mcp-tool-contract.md#minimum-required-tool-set-by-use-case).

For a minimal compatible implementation that supports Claude Code direct QA:

| Tool | Why required |
|---|---|
| `lisa_orchestrate` | Session entry point — Claude calls this first |
| `lisa_setup` | Loads flows and seeded entities into session state |
| `lisa_explore` | Screen exploration — keys, state, available actions |
| `lisa_keys` | Widget key storage and retrieval across calls |
| `lisa_action` | Click and type commands for Chrome automation |
| `lisa_flow` | Flow listing and progress tracking |
| `lisa_run_flow` | Flow start/complete lifecycle |
| `lisa_get_seeded` | Credential and entity resolution |
| `lisa_analyze` | Health check and debugging |

All other tools are optional. The server must return `isError: true` on tool calls it cannot handle — it must not silently return empty results.

---

## Concrete wiring example (Path A)

1. Build your MCP server (any language, any runtime — must speak MCP over stdio).

2. Verify it responds to `tools/list`:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  | /path/to/my-mcp-server
# → should return initialize response

echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | /path/to/my-mcp-server
# → should return tools array
```

3. Configure Claude:
```json
{
  "mcpServers": {
    "my-brain": {
      "command": "/path/to/my-mcp-server",
      "args": [],
      "env": {
        "LISA_MEMORY_DIR": "/path/to/.lisa_memory"
      }
    }
  }
}
```

4. Run a STF session. Claude uses your server's tools. The orchestrator loop runs identically regardless of which brain is active.

---

## What the reference implementation adds

`@kaneshir/lisa-mcp` is the reference brain. It ships with:

- Persistent widget key memory across sessions (SQLite)
- Decision cache (avoids redundant LLM inference)
- Flakiness tracking and GitHub issue automation
- Cross-run trend analysis
- Hypothesis-driven testing
- Persona generation from behavior data
- Flow recording and replay

A minimal compatible implementation needs only the 9 required tools above. The reference brain's extra tools are optional enhancements — they improve quality over time but are not needed to run the basic loop.

---

## See also

- [mcp-tool-contract.md](./mcp-tool-contract.md) — full tool manifest, schemas, protocol envelope
- [lisa-mcp.md](./lisa-mcp.md) — reference implementation guide
- [adapter-design-guide.md](./adapter-design-guide.md) — BrowserAdapter implementation patterns
