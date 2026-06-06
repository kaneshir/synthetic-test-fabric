<!-- Canonical home as of 2026-06-05 — moved from the private dev-infra repo so app builds can consume it without auth (pub git dependency). -->
# flutter_test_keys

JS bridge + key overlay for Flutter web — lets Playwright (or any browser automation tool) drive your app via `window.__flutter_*` globals.

## URL Parameters

| Parameter | Effect |
|-----------|--------|
| `?showKeys=true` | Enables the service and shows visual key labels overlaid on each keyed widget |
| `?dumpKeys=true` | Enables the service and prints `KEYS_JSON:{...}` to the browser console after each navigation |

Both parameters can be combined: `?showKeys=true&dumpKeys=true`

## JS Bridge API

Once `TestKeyDebugService.instance.setupJsBridge()` has been called, the following globals are available on `window`:

| Global | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `__flutter_tap` | `(key: string) => boolean` | `true` if key found and tapped | Simulates a tap on the widget with the given key |
| `__flutter_type` | `(key: string, text: string) => boolean` | `true` if text injected | Injects text directly into a TextField by key |
| `__flutter_keys` | `() => string` | JSON string | Returns `{timestamp, route, elements: [{key, type, bounds}]}` |
| `__flutter_sequence` | `(actionsJson: string) => string` | JSON results | Executes a batch of tap/type actions in one call |
| `__flutter_bridge_ready` | (property) | `true` | Set to `true` once the bridge is initialized |
| `__flutter_getRoute` | `() => string` | Route string | Returns the current route (requires `getCurrentRoute` callback) |
| `__flutter_dumpKeys` | `() => boolean` | `true` if dump scheduled | Triggers a `KEYS_JSON:` console dump after the current frame |

### `__flutter_keys()` response shape

```json
{
  "timestamp": "2025-01-01T00:00:00.000Z",
  "route": "/employer/jobs",
  "elements": [
    {
      "key": "login_email_input",
      "type": "TextField",
      "bounds": { "x": 100, "y": 200, "width": 300, "height": 48 }
    }
  ]
}
```

## App Integration

Add this 10-line snippet to your dev entry point (`main_dev.dart`):

```dart
import 'package:flutter_test_keys/flutter_test_keys.dart';

// In main(), after WidgetsFlutterBinding.ensureInitialized():
if (kIsWeb) {
  TestKeyDebugService.instance.initFromUri(Uri.base);
  if (TestKeyDebugService.instance.enabled) {
    TestKeyDebugService.instance.setupJsBridge();
    TestKeyDebugService.instance.getCurrentRoute = () => Uri.base.fragment;
  }
}

// In your app's build() method:
if (TestKeyDebugService.instance.showOverlay) {
  app = TestKeyDebugOverlay(child: app);
}
```

In your router setup (`app_router.dart`):

```dart
import 'package:flutter_test_keys/flutter_test_keys.dart';

GoRouter(
  observers: [
    if (TestKeyDebugService.instance.dumpToConsole)
      TestKeyNavigatorObserver(),
  ],
  // ...
)
```

## Key Naming Convention

Keys follow the `screen_widget_purpose` pattern:

| Example Key | Widget | Screen/Context |
|-------------|--------|----------------|
| `login_email_input` | Email TextField | Login screen |
| `login_password_input` | Password TextField | Login screen |
| `login_submit_button` | Submit button | Login screen |
| `jobs_job_card_<id>` | Job card tile | Jobs list screen |
| `job_detail_apply_button` | Apply button | Job detail screen |
| `employer_jobs_create_button` | Create job button | Employer jobs screen |
| `bottom_nav_jobs` | Jobs tab | Bottom navigation |

**Rules:**
- All lowercase with underscores
- Start with the screen/context name
- End with the widget's purpose
- Include entity IDs for list items (e.g., `jobs_job_card_abc123`)

## Playwright Integration

See [`packages/flutter-e2e/`](../flutter-e2e/) for the full Playwright harness that uses this bridge.

The `FlutterBridge` class in `packages/flutter-e2e/helpers/flutter-bridge.ts` wraps these globals with TypeScript-typed helpers and correct JSON parsing for the `{timestamp, route, elements}` payload shape.

## Note on dev_infra

The `dev_infra` package currently contains copies of these source files. A follow-up issue will make `dev_infra` re-export from this package to eliminate the duplicate source, keeping a single canonical implementation here.
