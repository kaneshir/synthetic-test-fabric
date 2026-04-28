---
name: Bug report
about: Something broke — help us fix it
title: "[bug] "
labels: bug
assignees: ''
---

## What happened

A clear description of the bug. What did you observe? What did you expect to observe?

## Steps to reproduce

```
1.
2.
3.
```

If you have a minimal reproduction, paste it here or link to a repo. A minimal repro is the fastest path to a fix.

## Expected behavior

What should have happened.

## Actual behavior

What actually happened. Include error messages verbatim.

## Environment

| Field | Value |
|-------|-------|
| `synthetic-test-fabric` version | |
| Node.js version | |
| OS | |
| `@kaneshir/lisa-mcp` version (if relevant) | |
| Playwright version (if relevant) | |

## Logs

Paste relevant log output. Run with `DEBUG=fabric:*` for verbose output.

<details>
<summary>Full log output</summary>

```
paste here
```

</details>

## Run root artifacts (if applicable)

If the bug occurred during a loop run, the contents of the run root directory are often diagnostic. Relevant files:

- `fabric-score.json`
- `fabric-feedback.json`
- `flow-results.json`
- `.lisa_memory/lisa.db` (schema only — do not paste credentials)

## Additional context

Anything else that might be relevant: how frequently this happens, whether it's consistent or intermittent, related issues, workarounds you've found.
