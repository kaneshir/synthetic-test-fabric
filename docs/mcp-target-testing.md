# MCP target testing

Point Synthetic Test Fabric at **any MCP server** and run closed-loop coverage +
adversarial verification — the way an agent will actually use it. This is the
inverse of `fab-mcp` (which exposes STF *itself* over MCP): here an MCP server is
the **system under test**.

MCP is self-describing (`tools/list` returns a JSON Schema per tool), so STF can
discover your surface, auto-derive coverage, and ship a **portable protocol probe
battery** that works against any compliant server.

> Targets the MCP protocol version **`2025-03-26`** (negotiated from `initialize`;
> additional versions can be configured).

---

## Quick start

```ts
import { assessMcpTarget } from 'synthetic-test-fabric';

const score = await assessMcpTarget({
  endpoint: 'https://your-app.example.com/mcp',
  dbPath: '.lisa_memory/lisa.db',   // behavior events are recorded here
  simulationId: 'ci-run-1',
  agentId: 'mcp-probe',
  token: process.env.MCP_ACCESS_TOKEN,   // or: tokenProvider: async () => mintToken()
  // protocolVersions: ['2025-03-26'],    // preferred-first; negotiated at initialize
  // allowWrites: false,                  // read-only by default (see Safety)
});

if (!score.passed) throw new Error('MCP target assessment failed');
```

`assessMcpTarget` returns a `FabricScore.details.mcp`-shaped object:

```jsonc
{
  "surface": "read-only-surface",
  "protocolVersion": "2025-03-26",      // version actually exercised
  "coverage": { "toolsTotal": 8, "covered": 6, "uncovered": 1,
                "skippedByPolicy": 1, "unsupportedSchemas": 0, "ratio": 0.857 },
  "adversarial": { "secure": 8, "violations": 0, "inconclusive": 0,
                   "schemaProbeSkipped": false, "passed": true },
  "passed": true
}
```

Merge it into a `FabricScore`:

```ts
import { mcpScoreToDetails } from 'synthetic-test-fabric';
fabricScore.details = { ...fabricScore.details, ...mcpScoreToDetails(score) };
```

---

## The pieces

You can use the layers directly instead of `assessMcpTarget`:

| Export | What it does |
|--------|--------------|
| `McpExecutor` | Streamable-HTTP target client: handshake, session, `tools/list` (paginated), `tools/call`, `previewThenCommit`. Records a BehaviorEvent per call. |
| `runMcpCoverage(executor, opts)` | Invokes each advertised tool with a schema-generated valid input; reports covered / uncovered / `skippedByPolicy` / unsupported-schema + ratio. |
| `runProtocolProbes(config)` | The generic protocol probe battery (below). |
| `snapshotCatalog` / `diffCatalog` | Pin the catalog (names + schema hashes + coverage-relevant annotations); flag drift. |
| `generateInputs(schema)` | JSON-Schema → valid + boundary-invalid inputs + unsupported-construct report. |

---

## Protocol probe battery

`runProtocolProbes` fires portable, protocol-level probes and classifies each on
the **JSON-RPC layer** (rejections ride over HTTP 200). Each probe declares its
own expected-secure signal, so a stale-session `404` is *secure* for the
stale-session probe — not "inconclusive".

| Probe | Expected-secure |
|-------|-----------------|
| unauthenticated | `-32001` / HTTP 401 |
| malformed (missing `jsonrpc`) | `-32600` |
| malformed (parse error) | `-32700` |
| unknown tool | `-32004` / `-32601` |
| schema-violating args | `-32602` |
| stale session | HTTP 404 |
| missing session | 404 / `-32001` |
| unsupported protocol version | `-32602` |

**Hard gate:** a `violation` (succeeded where rejection was expected) **or** an
`inconclusive` (rejected the wrong way — a crash/typo must not pass) fails the battery.

**Out of scope by design:** product-specific authz probes (OAuth audience binding,
AAL/step-up, cross-org, confirmation-token forgery, idempotency abuse) belong in
*your* adopter layer — they depend on your policy, not the protocol.

---

## Safety: read-only by default

Write/destructive tools are **never invoked** unless you opt in:

```ts
await assessMcpTarget(config, { includeWrites: true });  // forces the executor's write guard
```

Without `includeWrites`, write tools (detected via `destructiveHint`) are skipped
and logged — never silently. A tool whose write status can't be determined is left
to your server's authz rather than called. This makes it safe to run against a
production endpoint.

---

## Try it

A runnable demo spins up the bundled compliant fixture and assesses it end-to-end:

```bash
npm run build && npx tsx demo/mcp-target.ts
```

The same `startFixture()` is exported, so you can use it as a **conformance double**
in your own tests:

```ts
import { startFixture, runProtocolProbes } from 'synthetic-test-fabric';

const fx = await startFixture();
const result = await runProtocolProbes({ endpoint: fx.url, dbPath: '', simulationId: 't', agentId: 'a', token: 'valid-aal2' });
expect(result.passed).toBe(true);
await fx.close();
```
