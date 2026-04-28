# MCP Tool Contract — `@kaneshir/lisa-mcp`

This document is the stable compatibility contract for `@kaneshir/lisa-mcp`. It is generated from the live `tools/list` response of `@kaneshir/lisa-mcp@1.0.1`. Any MCP server claiming compatibility with Synthetic Test Fabric must implement the required tools in each workflow group.

---

## Protocol envelope

The server speaks MCP over stdio (JSON-RPC 2.0).

**initialize**
```json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2024-11-05", "capabilities": {},
              "clientInfo": { "name": "my-client", "version": "1.0" } } }
```
Response must include `result.protocolVersion` and `result.serverInfo.name`.

**tools/list**
```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }
```
Returns `{ "tools": [ ... ] }`.

**tools/call**
```json
{ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "lisa_health", "arguments": {} } }
```
Success: `result.content` is an array. `result.content[0].type === "text"` and `result.content[0].text` contains the JSON-encoded response string.
Failure: `result.isError: true` with an error description in `result.content[0].text`.

---

## Environment contract

| Variable | Value | Purpose |
|---|---|---|
| `LISA_MEMORY_DIR` | `<iterRoot>/.lisa_memory` | **MCP server contract.** The server reads `lisa.db` from this directory. Set this when spawning the server. |
| `LISA_DB_ROOT` | `<iterRoot>` | Legacy STF subprocess convention. The framework still sets this for Playwright subprocess compatibility. Do not rely on it in MCP server implementations. |

When spawning the server from a `BrowserAdapter`:

```typescript
const server = spawn(cmd, args, {
  env: {
    ...process.env,
    LISA_MEMORY_DIR: path.join(iterRoot, '.lisa_memory'),
    LISA_APP_URL: 'http://localhost:5002',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});
```

---

## Tool manifest (`@kaneshir/lisa-mcp@1.0.1`)

Tools are organized by workflow. Required tools are marked **required** — a compatible implementation must implement them. Optional tools enhance capability but their absence degrades gracefully.

### Session setup

#### `lisa_orchestrate` — **required**
Master orchestration. Always call this first to start a session and get step-by-step guidance.

Actions: `status` | `start` | `advance` | `report_error` | `complete`

```json
{ "action": "start", "data": { "flows_path": ".lisa_memory/flows.yaml", "role": "seeker" } }
{ "action": "status" }
{ "action": "advance", "data": { "completed": "start_flow", "success": true } }
{ "action": "complete" }
```

#### `lisa_setup` — **required**
Initialize a testing session with flows and seeded entities.

```json
{ "flows_path": ".lisa_memory/flows.yaml", "role": "seeker", "seed_entities": true }
```

Returns: `{ flows_loaded, seeded, session }`.

---

### Screen exploration

#### `lisa_explore` — **required**
PRIMARY exploration tool. Combines key parsing, state detection, and action suggestions in one call.

```json
{ "screen": "/login", "console_output": "KEYS_JSON:{...}", "include_state": true, "include_actions": true }
```

Returns: `{ success, screen, keys, state?, actions? }`.

#### `lisa_keys` — **required**
Widget key management.

Actions: `store` | `get` | `stats`

```json
{ "action": "store", "screen": "/login", "keys": { "login_email_input": { "x": 100, "y": 200, "width": 300, "height": 48 } } }
{ "action": "get", "screen": "/login" }
{ "action": "stats" }
```

#### `lisa_action` — **required**
Chrome command builder for element interaction.

Actions: `click` | `type`

```json
{ "action": "click", "screen": "/login", "key": "login_submit_button" }
{ "action": "type",  "screen": "/login", "key": "login_email_input", "text": "user@example.com" }
```

Returns `result.command` with coordinates (and text for type).

#### `lisa_prepare_for_action` — recommended
Dismiss dialogs and wait for loading before interacting.

```json
{ "screen": "/login", "timeout_ms": 5000 }
```

---

### Flow management

#### `lisa_flow` — **required**
Flow lifecycle management.

Actions: `save` | `list` | `progress`

```json
{ "action": "list", "role": "seeker", "priority": "critical" }
{ "action": "progress" }
{ "action": "save", "flow_id": "seeker_login", "flow": { ... } }
```

#### `lisa_run_flow` — **required**
Execute a flow step by step.

Actions: `start` | `complete` | `check`

```json
{ "action": "start",    "flow_id": "seeker_login" }
{ "action": "complete", "flow_id": "seeker_login", "success": true, "notes": "login succeeded" }
{ "action": "check",    "flow_id": "seeker_login" }
```

#### `lisa_create_flow` — recommended
Generate a flow definition from a plain-English description (requires `claude` CLI).

```json
{ "description": "test that a seeker can apply for a job and see confirmation" }
```

---

### Recording

#### `lisa_record` — recommended
Recording session management.

Actions: `start` | `stop` | `event` | `export`

```json
{ "action": "start",  "session_name": "seeker_apply", "role": "seeker" }
{ "action": "event",  "event_type": "tap", "x": 150, "y": 320, "widget_key": "apply_button", "screen": "/job-detail" }
{ "action": "stop" }
{ "action": "export", "format": "flow", "flow_name": "seeker_apply_for_job", "role": "seeker" }
```

Config presets: `default` | `minimal` | `full` | `production` | `mcp`

---

### Seeded entities

#### `lisa_get_seeded` — **required**
Query entities seeded by the simulation or test setup.

```json
{ "entity_type": "seeker_account" }
```

Returns: `{ count, entities: [{ entity_type, entity_id, has_auth, auth_email?, auth_password? }] }`.

---

### Code generation

#### `lisa_codegen` — recommended
Test code generation and flow validation.

Actions: `generate` | `validate` | `flow_to_test`

```json
{ "action": "validate",     "flow_path": ".lisa_memory/flows.yaml" }
{ "action": "flow_to_test", "flow_path": ".lisa_memory/flows.yaml", "output_path": "test/seeker_login.dart" }
{ "action": "generate",     "flow_id": "seeker_login", "role": "seeker", "screen": "/login" }
```

---

### Analysis and debugging

#### `lisa_analyze` — **required**
Compound health check: database, cache, keys, metrics.

```json
{ "include_integrity": false, "include_metrics": true, "include_cache_stats": true }
```

Returns: `{ summary, diagnostics, cache_stats, key_stats, metrics?, integrity? }`.

#### `lisa_report` — recommended
Coverage and analysis report across screens, bugs, flakiness, and priorities.

```json
{ "role": "seeker", "include_coverage": true, "include_bugs": true, "include_priorities": true }
```

#### `lisa_failure` — recommended
Test failure triage: classify, heal, or report.

Actions: `classify` | `heal` | `report`

```json
{ "action": "classify", "test_name": "seeker_login", "test_file": "test/seeker_login.spec.ts", "error_message": "Selector not found" }
{ "action": "heal",     "test_name": "seeker_login", "test_file": "test/seeker_login.spec.ts" }
{ "action": "report",   "test_name": "seeker_login", "test_file": "test/seeker_login.spec.ts", "error_message": "..." }
```

#### `lisa_flakiness` — optional
Flakiness reporting and GitHub issue management.

Actions: `index` | `report` | `drive`

#### `lisa_get_cross_run_trends` — optional
Cross-run trend analysis from `run_summaries` in `lisa.db`.

```json
{ "lookback_iterations": 10 }
```

Returns: `{ coverage_delta, regression_rate_by_flow, score_trajectory, persona_performance, strategy_suggestions }`.

#### `lisa_health` — recommended
Quick health check. No parameters.

---

### API testing

#### `lisa_api_setup` — optional
Initialize an API testing session with flow definitions.

```json
{ "flows_path": ".lisa_memory/api-flows.yaml", "base_url": "http://localhost:3000", "role": "seeker" }
```

#### `lisa_api_step` — optional
Execute API flow steps.

Actions: `start` | `next` | `report` | `complete` | `progress`

---

### Intelligence and learning

#### `lisa_route_decision` — optional
Cache-first decision routing; falls back to LLM on miss.

```json
{ "screen": "/login", "goal": "submit_login_form", "context": {} }
```

#### `lisa_form_hypothesis` — optional
Hypothesis-driven testing (requires `claude` CLI).

Actions: `form` | `list`

```json
{ "observation": "partial state seen 3x in job application flow" }
```

#### `lisa_record_hypothesis_outcome` — optional
Record hypothesis validation result.

```json
{ "hypothesis_id": "hyp_1714123456789", "result": "confirmed", "evidence": "reproduced 3 times" }
```

#### `lisa_generate_personas` — optional
Generate synthetic persona YAML from behavior cache data.

```json
{ "role": "seeker", "count": 3 }
```

---

### Utilities

#### `lisa_batch` — optional
Execute multiple tool calls in parallel via `Future.wait`. Reduces latency for independent queries.

```json
{
  "tools": [
    { "name": "lisa_keys",   "params": { "action": "get", "screen": "/login" } },
    { "name": "lisa_health", "params": {} }
  ]
}
```

Returns: `{ results: [{ index, tool, success, result, error? }], total, successful, failed, duration_ms }`.

Note: recursive `lisa_batch` calls are not allowed.

---

## Legacy aliases

The following tool names are **routable** in the current binary but are **not in the manifest** and must not be part of a compatibility contract. They exist for backwards compatibility with earlier sessions and will be removed in a future major version.

| Legacy name | Current replacement |
|---|---|
| `lisa_navigate` | Use `lisa_explore` with `console_output` from Chrome MCP |
| `lisa_explore_screen` | Use `lisa_explore` |
| `lisa_tap_key` | Use `lisa_action` with `action: "click"` |
| `lisa_type_key` | Use `lisa_action` with `action: "type"` |
| `lisa_screenshot` | Use Chrome MCP screenshot tool directly |
| `lisa_get_seeded_credentials` | Use `lisa_get_seeded` |
| `lisa_store_keys` | Use `lisa_keys` with `action: "store"` |
| `lisa_get_known_keys` | Use `lisa_keys` with `action: "get"` |

---

## Minimum required tool set by use case

| Use case | Required tools |
|---|---|
| **Claude Code direct QA** (Claude calls tools, no BrowserAdapter spawn) | `lisa_orchestrate`, `lisa_setup`, `lisa_explore`, `lisa_keys`, `lisa_action`, `lisa_flow`, `lisa_run_flow`, `lisa_get_seeded`, `lisa_analyze` |
| **BrowserAdapter flow generation** (adapter spawns server, LLM generates specs) | `lisa_explore`, `lisa_keys`, `lisa_action`, `lisa_get_seeded`, `lisa_codegen` |
| **Recording workflow** | `lisa_record`, `lisa_flow`, `lisa_get_seeded` |

---

## CI snapshot check

To catch contract drift in future releases, snapshot the tool names from `tools/list` and fail CI if they change:

```bash
node -e "
const { spawn } = require('child_process');
const { buildLisaMcpCommand } = require('@kaneshir/lisa-mcp');
const { cmd, args } = buildLisaMcpCommand();
const proc = spawn(cmd, args, { env: { ...process.env, LISA_MEMORY_DIR: '/tmp/lisa-ci' } });
let buf = '';
proc.stdout.on('data', d => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1) proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}) + '\n');
      if (msg.id === 2) {
        const names = msg.result.tools.map(t => t.name).sort();
        console.log(names.join('\n'));
        proc.kill(); process.exit(0);
      }
    } catch(e) {}
  }
});
proc.stderr.on('data', () => {});
proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'ci',version:'1.0'}}}) + '\n');
" > actual-tools.txt

diff expected-tools.txt actual-tools.txt || (echo "Tool manifest changed — update mcp-tool-contract.md" && exit 1)
```
