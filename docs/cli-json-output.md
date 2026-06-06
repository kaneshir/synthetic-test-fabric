# `fab` JSON output contract

Every `fab` command accepts `--json`. When set, stdout contains exactly one JSON
object per invocation — the **envelope**. Default text mode is unchanged.

This contract is the foundation for `fab status` (#19), `fab inspect` (#20),
`fab adapter validate` (#23), `fab doctor` (#24), and the `fab-mcp` server (#27).
Future commands MUST follow it.

---

## Envelope schema

```ts
type FabResult =
  | { command: string; status: "ok";    data: unknown; runRoot?: string; next?: string }
  | { command: string; status: "error"; error: { message: string; code?: string; stack?: string }; runRoot?: string };
```

| Field | When present | Notes |
|-------|--------------|-------|
| `command` | Always | The `fab` subcommand that ran (e.g. `"smoke"`, `"check"`). |
| `status` | Always | `"ok"` or `"error"`. **Describes infrastructure outcome**, not domain outcome. |
| `data` | When `status: "ok"` | Command-specific shape. May include `data.ok: boolean` for domain-check commands. |
| `error` | When `status: "error"` | `{message, code?, stack?}`. `stack` only when `--debug` or `FAB_DEBUG=1`. |
| `runRoot` | Optional | Loop root the command operated on, if applicable. |
| `next` | Optional | Suggested follow-up command string. |

---

## CLI outcome taxonomy

Three uniform categories. Every command's outcome maps to one of them:

| Outcome | Envelope shape | Exit code |
|---------|---------------|-----------|
| **Success** | `{status: "ok", data: <command-shape> \| {ok: true, ...}}` | `0` |
| **Domain check failed** (tool ran, found problems) | `{status: "ok", data: {ok: false, ...details}}` | `1` |
| **Infrastructure / runtime error** (tool couldn't run) | `{status: "error", error: {message, code?}}` (no `data`) | `1` |

The distinction matters because agents need to know whether to retry the call
vs. consume structured findings.

- **`status: "error"`** means the tool itself broke (file not found, parse error,
  unexpected exception). Retry-able or report-able.
- **`status: "ok"` + `data.ok: false`** means the tool worked, but the input
  failed a check. Read `data` and act.

### Examples

**Success** — `fab check --root ./loop --threshold 0.5 --json` (score 0.85):
```json
{"command":"check","status":"ok","data":{"ok":true,"score":0.85,"threshold":0.5},"runRoot":"./loop"}
```
Exit code: `0`.

**Domain check failed** — `fab check --root ./loop --threshold 0.5 --json` (score 0.30):
```json
{"command":"check","status":"ok","data":{"ok":false,"score":0.30,"threshold":0.5,"message":"Score 0.3 below threshold 0.5"},"runRoot":"./loop"}
```
Exit code: `1`.

**Infrastructure error** — `fab check --root ./missing --threshold 0.5 --json`:
```json
{"command":"check","status":"error","error":{"message":"fabric-score.json not found at ./missing/iter-001/fabric-score.json","code":"SCORE_FILE_MISSING"},"runRoot":"./missing"}
```
Exit code: `1`.

---

## Caller contract — read both

> **Automation MUST key off both the process exit code AND the envelope fields.**

- **`status`** — describes infrastructure outcome ("did the tool itself succeed?")
- **`data.ok`** — describes domain outcome where applicable ("did the input pass the check?")
- **Exit code** — must be checked even on `status: "ok"`, because `status: "ok"` + `data.ok: false` is a normal domain failure with exit 1.

Reference caller logic:

```bash
output=$(fab check --root ./loop --threshold 0.5 --json)
exit_code=$?
status=$(echo "$output" | jq -r '.status')
ok=$(echo "$output" | jq -r '.data.ok // empty')

if [ "$exit_code" -ne 0 ] && [ "$status" = "error" ]; then
  echo "Tool broke — investigate"
elif [ "$exit_code" -ne 0 ] && [ "$ok" = "false" ]; then
  echo "Domain check failed — fix input and retry"
else
  echo "Success"
fi
```

This convention prevents future commands from overloading `status: "error"` for
expected validation failures.

---

## Stdout purity guarantee

When `--json` is set:

- Stdout contains **exactly one** JSON envelope per invocation
- All progress, framing, adapter, and reporter logs route to **stderr**
- `JSON.parse(stdout)` succeeds with no extra bytes
- Adapter `console.log()` and `process.stdout.write()` calls do **not** corrupt
  the envelope — the CLI installs a global stdout guard that redirects them

Default (text) mode is unchanged: `[fab smoke] 3/5 passed` still appears on stdout.

### `--json` detection

Detected from raw `process.argv` BEFORE commander parses, so even
unknown-command and missing-required-option errors emit a JSON envelope when
`--json` is in argv:

```bash
$ fab nonexistent --json
{"command":"nonexistent","status":"error","error":{"message":"unknown command 'nonexistent'"}}
$ echo $?
1

$ fab seed --json
{"command":"seed","status":"error","error":{"message":"required option '--root <dir>' not specified"}}
$ echo $?
1
```

---

## Debug mode

`--debug` (or `FAB_DEBUG=1`) includes stack traces in error envelopes:

```bash
$ FAB_DEBUG=1 fab check --root ./missing --threshold 0.5 --json
{"command":"check","status":"error","error":{"message":"...","code":"SCORE_FILE_MISSING","stack":"Error: ...\n    at ..."}}
```

Without `--debug`, `error.stack` is omitted to keep envelopes compact for
agent context budgets.

---

## For command authors

The CLI envelope module exports four helpers (in `src/cli/json-envelope.ts`):

| Helper | When to use |
|--------|------------|
| `emitOk(command, data, opts?)` | Success path. Exits 0. |
| `emitDomainFailure(command, data, opts?)` | Tool ran, found a domain failure. `data` must include `ok: false`. Exits 1. |
| `emitError(command, error, opts?)` | Infrastructure / runtime failure. `error` is `{message, code?}`. Exits 1. |
| `emitTopLevelError(err, argv?)` | Catch-all for the top-level `parseAsync().catch()`. Routes through `emitError`. |

All four exit the process. Each writes the envelope only when `--json` is set;
in text mode they exit silently after the action's existing `console.log` /
`console.error` calls.

The `FabError` class lets command code throw with a `code` and optional
`runRoot` that the top-level handler will surface in the envelope.

---

## Shipping

This document is part of the published package — it must remain accurate as
new commands land. CI gates (added in #26 — taxonomy-conformance lint) verify
that no command emits `status: "error"` for an expected domain failure.
