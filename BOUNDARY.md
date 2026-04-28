# Extraction Boundary — test-fabric-core

## Why this rule exists

`packages/test-fabric-core` is being extracted into a standalone, publicly publishable
package (the Synthetic Test Fabric engine). To remain independently publishable it must
not import anything from the BlueSkil application — backend, mobile, or web.

## Forbidden imports

The following import prefixes/patterns are **not allowed** inside `src/`:

| Pattern | Reason |
|---|---|
| `backend-api` | NestJS backend (app-specific) |
| `flutter-e2e` | Flutter E2E test package (app-specific) |
| `/flutter/` | Flutter mobile app directory |
| `/nuxt/` | Nuxt web app directory |
| `@blueskil/*` | BlueSkil-scoped npm packages |
| `firebase-admin` | Firebase Admin SDK (app-specific server SDK) |
| `@nestjs/*` | NestJS framework packages |
| `@google-cloud/*` | Google Cloud SDK packages (app-specific) |

## Allowed imports

- Node built-ins: `fs`, `path`, `os`, `crypto`, `events`, `child_process`, …
- `better-sqlite3` — SQLite adapter used by the recorder
- `zod` — schema validation
- `js-yaml` — persona YAML parsing (if/when added)
- `typescript` / `@types/*` — compile-time only
- Relative imports within `packages/test-fabric-core/src/`

## How to run the check

```bash
# From the package root
npm run check:boundary

# Or directly
npx tsx scripts/check-boundary.ts
```

Exit 0 means no violations. Exit 1 prints each violating file, line, and reason.

The check also runs automatically as part of `npm test` via `src/boundary.test.ts`.
