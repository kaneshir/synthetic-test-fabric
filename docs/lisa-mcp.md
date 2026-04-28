# Lisa MCP — AI Browser Automation

`@kaneshir/lisa-mcp` is the AI layer that gives Synthetic Test Fabric eyes and hands in the browser. It ships as an npm package containing precompiled binaries for a server that implements the Model Context Protocol (MCP). When your `BrowserAdapter` needs to generate a Playwright spec for a screen it has never seen before, it spawns this server and lets an LLM use it as a set of tools to navigate the app and describe what it finds.

This document covers what the binary is, why it exists, how to install and verify it, the tools it exposes, the `showKeys` contract, the interactive recording workflow, and how to troubleshoot when things go wrong.

---

## Why a separate binary?

The simulation intelligence in Synthetic Test Fabric runs in TypeScript (Node.js). Playwright runs in TypeScript. The framework is TypeScript throughout.

The Lisa MCP server is written in Dart. There are two reasons:

**1. Flutter web apps surface element keys in Dart-native ways.**
Flutter compiles to browser-runnable JavaScript, but its widget tree and key
system are Dart constructs. The Lisa MCP server understands Flutter's `Key`
system — for example, recognizing that `ValueKey('login_email_input')` and
`data-key="login_email_input"` in the DOM identify the same element — and can
navigate the app using those keys reliably.

**2. The binary model enables distribution without source.**
The MCP server includes proprietary heuristics for key inference and recording playback that we don't want to publish. Compiling to a binary via `dart compile exe` gives consumers the full capability without the source. The binary is self-contained — no Dart SDK required at runtime.

The binary speaks MCP over stdio — a language-neutral JSON-RPC protocol. From the framework's perspective, it could have been written in anything. From the implementation's perspective, Dart was the right choice.

---

## What ships in the package

```
@kaneshir/lisa-mcp/
  bin/
    lisa_mcp-macos-arm64     ← Apple Silicon (M1 and later)
    lisa_mcp-macos-x64       ← Intel Mac
    lisa_mcp-linux-x64       ← Linux CI, Docker containers
  index.js                   ← buildLisaMcpCommand() — picks the right binary
  index.d.ts                 ← TypeScript types
  package.json
```

Platform detection happens at runtime in `index.js`. Unsupported platforms throw clearly with a message pointing to the issue tracker.

Windows is not currently supported. A Wine-based fallback and native Windows build are on the roadmap.

---

## Install

```bash
npm install @kaneshir/lisa-mcp
```

Then verify the binary is runnable:

```bash
npx lisa-mcp verify
```

Expected output:

```
lisa_mcp v0.8.1  (macos-arm64)
binary: /path/to/node_modules/@kaneshir/lisa-mcp/bin/lisa_mcp-macos-arm64
status: executable ✓
mcp handshake: ✓
```

If you see `permission denied`, run:

```bash
chmod +x node_modules/@kaneshir/lisa-mcp/bin/lisa_mcp-*
```

This happens occasionally when npm strips executable bits on install (npm >= 10 handles this correctly; earlier versions may not).

---

## Using `buildLisaMcpCommand` in your BrowserAdapter

The package exports one function:

```typescript
import { buildLisaMcpCommand } from '@kaneshir/lisa-mcp';

const { cmd, args } = buildLisaMcpCommand();
// → { cmd: '/path/to/lisa_mcp-macos-arm64', args: [] }
```

In your `BrowserAdapter.generateFlows()`, spawn the server as a child process and communicate over stdio:

```typescript
import { spawn } from 'child_process';
import { buildLisaMcpCommand } from '@kaneshir/lisa-mcp';

async function generateFlows(iterRoot: string, candidates: CandidateFlow[]) {
  const { cmd, args } = buildLisaMcpCommand();

  const server = spawn(cmd, args, {
    env: {
      ...process.env,
      LISA_MEMORY_DIR: path.join(iterRoot, '.lisa_memory'), // server reads lisa.db from here
      LISA_APP_URL: 'http://localhost:5002',
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  // send MCP tool calls over server.stdin, read responses from server.stdout
  // use any MCP client library or implement the JSON-RPC calls directly
}
```

`LISA_MEMORY_DIR` tells the server where to find `lisa.db` (at `<LISA_MEMORY_DIR>/lisa.db`). The framework sets this for all subprocesses — if you're spawning the server from within your `BrowserAdapter`, it is already in the environment. The older `LISA_DB_ROOT` variable (pointing at `iterRoot` directly) is still set by the framework for legacy Playwright subprocess compatibility but is not the MCP server's env contract.

---

## MCP tools reference

The server exposes 25 tools over the MCP stdio protocol. The tools below are the primary ones Claude uses during a QA session. For full schemas, input/output contracts, and the complete tool list see [mcp-tool-contract.md](./mcp-tool-contract.md).

### Session entry point

**`lisa_orchestrate`** — start here. Maintains workflow state and tells Claude exactly what to do next.

```json
{ "action": "start", "data": { "flows_path": ".lisa_memory/flows.yaml", "role": "seeker" } }
```

**`lisa_setup`** — loads flows and seeded entities into session state.

### Screen exploration

**`lisa_explore`** — PRIMARY exploration tool. Takes the `KEYS_JSON` console output from the app and returns stored keys, screen state, and available actions in one call.

```json
{ "screen": "/login", "console_output": "KEYS_JSON:{...}" }
```

**`lisa_keys`** — store and retrieve widget keys across calls (`action: store | get | stats`).

**`lisa_action`** — build click and type commands for Chrome automation.

```json
{ "action": "click", "screen": "/login", "key": "login_submit_button" }
{ "action": "type",  "screen": "/login", "key": "login_email_input", "text": "user@example.com" }
```

### Seeded entities

**`lisa_get_seeded`** — query entities seeded by the simulation.

```json
{ "entity_type": "seeker_account" }
```

Returns `{ count, entities }` with auth credentials when available. Generated specs use `resolveCredentials()` at test time — they never hardcode email addresses.

### Flow lifecycle

**`lisa_flow`** — list flows, save new flows, check session progress (`action: list | save | progress`).

**`lisa_run_flow`** — start and complete flow execution (`action: start | complete | check`).

### Analysis

**`lisa_analyze`** — compound health check. Call this when something isn't working — covers database, cache, keys, and metrics in one response.

**`lisa_report`** — coverage, bug history, flakiness, and test priority report.

**`lisa_failure`** — classify, auto-heal, or report a test failure (`action: classify | heal | report`).

### Recording

**`lisa_record`** — start a recording session, emit events, stop, and export as a flow (`action: start | event | stop | export`).

### Code generation

**`lisa_codegen`** — generate test code, validate flow definitions, or produce Dart integration tests (`action: generate | validate | flow_to_test`).

### Utilities

**`lisa_batch`** — run multiple tool calls in parallel. Useful when Claude needs keys from several screens at once.

**`lisa_health`** — quick health check, no parameters.

---

## The `showKeys` contract (Flutter web apps)

`showKeys` is a Flutter-specific integration. Flutter web apps compile widget keys (e.g. `ValueKey('login_email_input')`) into the DOM as `data-key` attributes, but only when `?showKeys=true` is appended to the URL — the app must be built to honour this parameter. The Lisa MCP server uses it to enumerate every interactive element on a screen before attempting to interact:

```
URL:  http://localhost:5002/app/?showKeys=true#/login
DOM:  <input ... />
      ↑ widget has ValueKey('login_email_input')
      ↑ Flutter web renderer sets data-key="login_email_input"
```

`lisa_explore` reads element keys from the `KEYS_JSON` console output. The app must output a `KEYS_JSON:<json>` line to the browser console when `?showKeys=true&dumpKeys=true` is in the URL.

**Using lisa-mcp with non-Flutter web apps**

`showKeys` is not required for web apps. If your app has `data-key` or `data-testid` attributes on interactive elements, lisa-mcp discovers them directly from the DOM — no URL parameter, no console contract. Set `LISA_APP_URL` and spawn the server as normal.

lisa-mcp is optimised for Flutter apps because Flutter does not produce stable HTML attributes by default — `showKeys` is the mechanism that bridges the widget key system to the DOM. Standard web apps typically already have stable attributes, so the `showKeys` integration step is unnecessary.

If your web app has no stable element identifiers, add `data-key` or `data-testid` attributes to interactive elements before integrating lisa-mcp. See [testability-standard.md](./testability-standard.md) for the full selector stability checklist.

---

## Interactive recording

Beyond automated flow generation, lisa-mcp powers a developer-facing recording workflow. When a developer navigates the live app while the Lisa MCP server is running, the server can record the key sequence and produce a replayable spec.

**Workflow:**

```
1. Developer navigates to the app with ?showKeys=true&dumpKeys=true
2. lisa-mcp records every action via lisa_record (event: tap/type/navigation)
3. Developer says "save this as 'seeker-apply-to-job'"
4. lisa_record export writes the flow to flows.yaml via lisa_flow save
5. Developer commits flows.yaml
6. The flow runs in the next TEST phase
```

This is how new flows enter the catalog without writing Playwright code by hand. The recorded flows are normal Playwright specs — the TEST phase replays them identically.

For the Lisa recording CLI experience (the "start watching" workflow), see the `@kaneshir/lisa-mcp` package README.

---

## What changes when you add lisa-mcp

The framework's default behavior without lisa-mcp:

```
GENERATE_FLOWS: candidate_flows.yaml → your BrowserAdapter writes specs using your own selector strategy
TEST: Playwright executes those specs
```

The framework's behavior with lisa-mcp:

```
GENERATE_FLOWS:
  1. Spawn lisa-mcp MCP server
  2. For each candidate path:
     a. Navigate to each screen in the path (?showKeys=true&dumpKeys=true)
     b. Discover element keys via lisa_explore (parses KEYS_JSON from console)
     c. Resolve fixture aliases via lisa_get_seeded
     d. Generate locators from live DOM state
     e. Write spec file
  3. Kill MCP server
TEST: Playwright executes the generated specs (same as without)
```

The TEST phase does not change. lisa-mcp only touches GENERATE_FLOWS.

---

## Troubleshooting

**`Error: unsupported platform: win32`**
Windows is not currently supported. Track the issue at the repository.

**`Error: ENOENT: no such file or directory ... lisa_mcp-macos-arm64`**
The package was installed but the binary path is wrong. Try reinstalling:
```bash
rm -rf node_modules/@kaneshir/lisa-mcp && npm install @kaneshir/lisa-mcp
```

**`Error: permission denied ... lisa_mcp-macos-arm64`**
The binary is not executable. Fix with:
```bash
chmod +x node_modules/@kaneshir/lisa-mcp/bin/lisa_mcp-*
```

**`lisa_explore` returns empty keys**
The page loaded but no `data-key` attributes are present. Check:
1. Is `?showKeys=true&dumpKeys=true` in the URL?
2. Does your app implement the showKeys contract?
3. Is the console output containing `KEYS_JSON:` being passed to `lisa_explore`?
4. Is the page fully rendered before `lisa_explore` is called? (Try adding a wait after navigation.)

**`lisa_get_seeded` returns empty entities**
The alias doesn't exist in `lisa.db`. Check:
1. Is `LISA_MEMORY_DIR` set to `<iterRoot>/.lisa_memory`?
2. Did `AppAdapter.seed()` write entities to `seeded_entities`?
3. Is the entity type correct? Check `mini-sim-export.json` in `iterRoot`.

**MCP server exits immediately after spawn**
Check stderr for an error message. Common causes: `LISA_APP_URL` is not set, the app URL is unreachable, or the binary was compiled for a different OS version.

**Spec locators are stale after a UI change**
This is expected — generated specs use the keys that existed when the spec was generated. If the key changed in the UI, regenerate the affected specs by deleting them from `flows/` and letting the system regenerate them on the next `GENERATE_FLOWS` phase. The key stability contract is: keys should not change between runs unless the UI intentionally changed.
