---
description: AI autonomous UX testing agent for exploratory testing using dev_infra
---

# AI Autonomous UX Tester

You are an **exploratory UX testing agent** that uses the dev_infra framework for AI-powered testing.

---

## 🚀 AUTOMATIC SETUP (runs first, 100% always)

**Execute these steps BEFORE any testing. No exceptions.**

### 1. Check Emulators
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5002
```
If NOT 200 → Stop. Tell user: `cd ~/src/blueskil && ./deploy_dev_emulator.sh`

### 2. Connect Chrome
```
mcp__claude-in-chrome__tabs_context_mcp
```
If "not connected" → Stop. Tell user: Install Claude browser extension, restart Chrome.

### 3. Navigate with `?dumpKeys=true&showKeys=true`
```
mcp__claude-in-chrome__navigate
URL: http://localhost:5002/app/?dumpKeys=true&showKeys=true&lang=en#/login
```
**CRITICAL**: Both params needed:
- `showKeys=true` - Displays keys visually (pink labels)
- `dumpKeys=true` - Outputs KEYS_JSON to console with exact bounds

### 4. Read KEYS_JSON from Console
```
mcp__claude-in-chrome__read_console_messages (pattern: "KEYS_JSON")
```
Returns exact bounds: `{"key":"login_email_input","bounds":{"x":49,"y":362,"width":680,"height":48}}`

Calculate center: `x + width/2, y + height/2` → then click at coordinates.

### Test Credentials
| Role | Email | Password |
|------|-------|----------|
| Seeker | test-seeker@blueskil.test | pass123 |
| Employer | test-employer@blueskil.test | pass123 |

**Login/Register Pattern:** Always try login first. If user doesn't exist:
1. Click "Register" on login page
2. Fill: Name, Email, Password (`pass123`)
3. Accept terms, submit
4. Enter verification code (shown in emulator)
5. Select role: "Looking for Work" (Seeker) or "Own a Business" (Employer)

### Navigation Pattern
- Use **Tab key** to navigate between form fields
- Type directly after Tab focuses the element
- For forms: Tab → type → Tab → type → Enter/click submit

---

## ⚠️ FAIL-FAST BEHAVIOR (CRITICAL)

**ZERO TOLERANCE FOR HANGS.** If anything hangs or times out, STOP IMMEDIATELY and diagnose.

### Timeout Rules

| Operation | Max Time | On Timeout |
|-----------|----------|------------|
| Flutter device detection | 10s | STOP - check `flutter doctor` |
| Firebase emulator check | 5s | STOP - is emulator running? |
| App launch | 30s | STOP - check build errors |
| Single test execution | 120s | STOP - diagnose immediately |
| Agent task | 5min | STOP - agent likely stuck |
| Phase 0 (preflight) | 10min | STOP - infrastructure broken |

### Hang Detection Protocol

1. **Before ANY flutter/dart command**, set explicit timeout:
   ```bash
   timeout 30s flutter test ... || echo "TIMEOUT: Command hung"
   ```

2. **If a command doesn't return within expected time**:
   - DO NOT wait longer
   - DO NOT retry blindly
   - STOP and diagnose WHY

3. **Common hang causes** (check these FIRST):
   - Emulator not running or not responsive
   - App stuck on splash/loading screen
   - Missing test credentials/data
   - Gradle daemon hung (Android)
   - Port conflict on emulator ports

### Diagnosis Steps (On Any Hang)

```bash
# 1. Check Flutter state
flutter doctor -v

# 2. Check emulator/device
flutter devices
adb devices  # Android
xcrun simctl list devices  # iOS

# 3. Check Firebase emulator
curl -s http://localhost:4400/emulators | head -5

# 4. Check for zombie processes
ps aux | grep -E '(flutter|dart|gradle)' | head -10

# 5. Kill stuck processes if needed
pkill -f "flutter_tester"
```

### Fail-Fast Reporting with Observability

When running tests, **ALWAYS use Lisa's Observability** for structured diagnostics:

```dart
// In test setup - enable debug observability
final observability = Observability.debug();
final lisa = Lisa(
  context: LisaContext(...),
  adapter: adapter,
  observability: observability,  // <-- Required for fail-fast
);
```

**On ANY failure/hang**, dump the observability context:

```dart
// After failure, extract diagnostics
final trace = observability.getTrace();
final metrics = observability.getMetricsSummary();
final events = observability.events.bufferedEvents;

print('=== FAIL-FAST DIAGNOSTICS ===');
print('Trace: ${trace?.toJson()}');
print('Metrics: ${metrics.toJson()}');
print('Events: ${events.map((e) => e.toJson()).toList()}');
```

### Fail-Fast Report Format

If you hit a hang/timeout, report IMMEDIATELY with observability data:

```markdown
## ❌ FAIL-FAST: Failure Detected

**Operation**: {what was running}
**Expected Time**: {expected}
**Actual Time**: {before timeout}

### Observability Trace
The span hierarchy shows exactly where it failed:

```
Lisa.run (root)
  └─ journey:login (1.2s) ✓
  └─ journey:apply_to_job (FAILED after 45s)
       └─ step:tap_apply_button (0.3s) ✓
       └─ step:fill_form (TIMEOUT) ❌  <-- FAILURE POINT
           error: "Element not found: #submit-button"
           widget_tree_hash: "abc123"
```

### Metrics at Failure
| Metric | Value |
|--------|-------|
| steps_success | 5 |
| steps_failed | 1 |
| journey_duration_ms | 45000 |

### Events Leading to Failure
| Time | Event | Details |
|------|-------|---------|
| +0s | journeyStarted | journey=apply_to_job |
| +1.2s | stepCompleted | step=tap_apply_button |
| +45s | stepFailed | step=fill_form, error=timeout |

### Likely Cause
{diagnosis based on observability data}

### Recommended Fix
{what needs to happen before retrying}
```

**DO NOT CONTINUE** until the failure is resolved. Use observability to pinpoint exactly what broke.

---

## Arguments: $ARGUMENTS

Parse arguments for mode, duration, and parallelism:
- **Mode**: First argument (default: `explore`)
- **Duration**: Look for `--duration <time>` or standalone time like `2h`, `30m`, `1h30m`
- **Agents**: Look for `--agents <n>` or `-a <n>` (default: 3 for explore mode)
- **Skip Preflight**: `--skip-preflight` to skip Phase 0 (use if you know infra is ready)

**Defaults:**
- Duration: 2 hours
- Agents: 3 (one per role)

### Example Invocations

```
/test-ux                          # explore mode, 2h, 3 agents
/test-ux explore 4hr              # explore for 4 hours, 3 agents
/test-ux explore 4hr --agents 1   # explore 4 hours, 1 agent (sequential)
/test-ux flow login 1h            # test login flow only, 1 hour
/test-ux preflight                # run Phase 0 only (validate infrastructure)
/test-ux explore --skip-preflight # skip Phase 0 if you know infra works
```

---

## Time Budget Management

**CRITICAL**: This is an AUTONOMOUS CONTINUOUS SESSION. Keep working until time budget is reached.

### DO NOT STOP EARLY
- DO NOT stop after completing "a few tasks"
- DO NOT provide a "final summary" until time is up
- DO NOT ask the user what to do next
- KEEP FINDING MORE WORK until 80% of time elapsed

### Time Tracking

At session start, calculate:
```
total_duration = parsed duration (e.g., 4 hours = 240 min)
phase0_end = 10 min (fixed - preflight check)
phase1_end = phase0_end + (total_duration - 10) * 0.55  (parallel discovery)
phase2_end = phase1_end + (total_duration - 10) * 0.30  (serial testing)
phase3_end = phase2_end + (total_duration - 10) * 0.15  (fix failures)
```

---

## Phase Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│              PHASE 0: PRE-FLIGHT CHECK (~10 min)                    │
│   - Detect device (emulator/simulator/desktop)                      │
│   - Verify Firebase emulator running                                │
│   - Run smoke test                                                  │
│   OUTPUT: .preflight_context.json                                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│              PHASE 1: PARALLEL DISCOVERY (55%)                      │
│   Multiple agents run simultaneously, each owns specific paths      │
│   They discover use cases, add Keys, write tests using dev_infra    │
│   They DO NOT run tests (no emulator contention)                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│              PHASE 2: SERIAL TESTING (30%)                          │
│   Run tests in DEPENDENCY ORDER (base scenarios first)              │
│   Records: PASS / FAIL / ERROR for each                             │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│              PHASE 3: FIX FAILURES (15%)                            │
│   For each failing test, fix and re-run (max 2 retries)             │
│   Mark as BUG if still failing                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

This command requires:

1. **dev_infra package** - The AI QA testing framework
   ```yaml
   dev_dependencies:
     dev_infra:
       path: ../dev_infra  # Adjust path
   ```

2. **ProjectAdapter** - Your app's adapter implementing the dev_infra interface
   - See `dev_infra/docs/INTEGRATION_GUIDE.md`

3. **Base Scenarios** - Test composition layer for reusable setup
   - Located in `integration_test/base/`

---

## Lisa CLI Tools (LLM Integration)

The Lisa CLI provides commands for LLM-driven test generation:

### Explore Command
Run exploration and get LLM-readable output:
```bash
# Explore seeker role, output markdown
dart run bin/lisa.dart explore --role=seeker --output=exploration.md

# Explore with specific test file
dart run bin/lisa.dart explore --role=employer --test-file=integration_test/lisa_employer_test.dart

# Get JSON output for programmatic use
dart run bin/lisa.dart explore --role=seeker --format=json --output=exploration.json
```

### Run Command
Execute specific journeys:
```bash
# Run seeker journeys
dart run bin/lisa.dart run --role=seeker --journeys=login,apply,profile

# Run with verbose output
dart run bin/lisa.dart run --role=employer --journeys=review,shortlist -v
```

### Format Command
Convert exploration/run JSON to LLM-readable markdown:
```bash
# Format exploration results
dart run bin/lisa.dart format --input=exploration.json --output=exploration.md

# Format run results
dart run bin/lisa.dart format --input=results.json --type=results --output=results.md
```

### LLM Loop Pattern
The LLM (Claude) can now:
1. Run `lisa explore` → read markdown output
2. Understand app structure (screens, transitions, elements)
3. Write journey definitions and test code
4. Run `lisa run` → get test results
5. Fix failures and iterate

---

## Phase 0: Pre-Flight Check

### Step 0.1: Detect Device
```bash
flutter devices
```

### Step 0.2: Determine Emulator Host
- Android emulator → `10.0.2.2`
- iOS simulator → `localhost`
- Desktop/Web → `localhost`

### Step 0.3: Verify Firebase Emulator
```bash
curl -s http://localhost:4400/emulators | head -5
```

### Step 0.4: Run Smoke Test
```bash
flutter test integration_test/helpers/smoke_test.dart -d {device} {flavor_flag}
```

### Step 0.5: Save Preflight Context
Write `integration_test/.preflight_context.json`:
```json
{
  "device": "emulator-5554",
  "emulatorHost": "10.0.2.2",
  "flavor": "dev",
  "testCommand": "flutter test {file} -d emulator-5554 --flavor dev"
}
```

---

## Phase 0.6: Load Learning Context (Issue #65)

Before starting discovery, load historical learnings to guide decisions:

### Step 0.6.1: Check for Existing Learning Store
```bash
ls -la integration_test/memory/
# Look for learning_history.json or learning_data.parquet
```

### Step 0.6.2: Load Learning Insights
If learning data exists, read `integration_test/memory/learning_context.json`:
```json
{
  "lastRunAt": "2025-01-15T10:30:00Z",
  "totalExecutions": 450,
  "undertestedScreens": ["JobDetailScreen", "MessagesScreen"],
  "testsToSkip": ["flaky_animation_test"],
  "testsWithRetries": {
    "network_dependent_test": 3
  },
  "problematicScreens": ["PaymentScreen", "VideoCallScreen"],
  "recommendations": {
    "prioritizeScreens": ["JobDetailScreen", "MessagesScreen"],
    "skipTests": ["flaky_animation_test"],
    "retryTests": {"network_dependent_test": 3}
  }
}
```

### Step 0.6.3: Apply Learnings to Discovery
Use these insights for Phase 1:

1. **Prioritize undertested screens** - Assign more agent time to `undertestedScreens`
2. **Skip flaky tests** - Don't regenerate tests in `testsToSkip`
3. **Flag problematic screens** - `problematicScreens` may need more robust error handling
4. **Apply retry policies** - Tests in `testsWithRetries` should include retry logic

Save to `.preflight_context.json`:
```json
{
  "device": "emulator-5554",
  "emulatorHost": "10.0.2.2",
  "flavor": "dev",
  "testCommand": "flutter test {file} -d emulator-5554 --flavor dev",
  "learnings": {
    "prioritizedScreens": ["JobDetailScreen", "MessagesScreen"],
    "skipTests": ["flaky_animation_test"],
    "retryPolicies": {"network_dependent_test": 3},
    "problematicScreens": ["PaymentScreen", "VideoCallScreen"]
  }
}
```

---

## Phase 1: Parallel Discovery

Spawn discovery agents (one per role) with:

```
subagent_type: "general-purpose"
run_in_background: true
```

### Learning-Guided Discovery (Issue #65)

**IMPORTANT**: Pass learning context to each agent:

```
Your task includes these learnings from previous runs:
- Prioritized screens: {learnings.prioritizedScreens} - explore these first
- Skip regenerating: {learnings.skipTests} - these are known flaky
- Problematic screens: {learnings.problematicScreens} - add extra error handling
- Retry policies: {learnings.retryPolicies} - include retry logic in tests
```

Each agent:
1. **Prioritizes screens from learnings** before others
2. Owns specific screen paths
3. Discovers use cases in their screens
4. Adds missing Keys to widgets
5. Writes test files using dev_infra base scenarios (with retry logic from learnings)
6. Outputs to `.results_{role}.json`

**Agent Rules:**
- DO NOT run flutter test
- DO NOT edit files outside owned paths
- USE base scenarios to avoid duplicating setup
- USE dev_infra's ProjectAdapter for app interaction
- APPLY retry counts from `learnings.retryPolicies`
- SKIP regenerating tests listed in `learnings.skipTests`

---

## Phase 2: Serial Testing

1. Collect test files from `.results_*.json`
2. Build dependency graph from layer declarations
3. Run tests in dependency order:
   - Layer 1 (Auth) first
   - Layer 2 (Profile) second
   - Layer 3 (Data) third
   - Layer 4 (Features) last
4. If base scenario fails, skip dependent tests

Use dev_infra's TestOrchestrator for execution.

### Observability-Enabled Testing (REQUIRED)

**ALL tests MUST run with observability enabled for fail-fast diagnostics:**

```dart
// Every test file should have this pattern
void main() {
  late Observability observability;

  setUp(() {
    observability = Observability.debug();
  });

  tearDown(() {
    // On failure, dump diagnostics automatically
    if (observability.getMetricsSummary().counters[LisaMetricNames.stepsFailed] ?? 0 > 0) {
      _dumpFailFastDiagnostics(observability);
    }
    observability.dispose();
  });

  testWidgets('...', (tester) async {
    final lisa = Lisa(
      context: LisaContext(...),
      adapter: adapter,
      observability: observability,  // <-- REQUIRED
    );
    // ...
  });
}

void _dumpFailFastDiagnostics(Observability obs) {
  final trace = obs.getTrace();
  final metrics = obs.getMetricsSummary();
  print('\n${'=' * 60}');
  print('FAIL-FAST DIAGNOSTICS');
  print('=' * 60);
  print('Failed Spans:');
  trace?.spans
    .where((s) => s.status == SpanStatus.error)
    .forEach((s) => print('  ❌ ${s.name}: ${s.attributes}'));
  print('Metrics: ${metrics.counters}');
  print('=' * 60 + '\n');
}
```

### Test Execution with Timeout

Run each test with explicit timeout to catch hangs:

```bash
# Run with 2-minute timeout per test
timeout 120s flutter test integration_test/{test_file}.dart \
  -d {device} \
  --dart-define=VERBOSE=true \
  || {
    echo "❌ TEST TIMEOUT: {test_file}"
    echo "Check observability output above for failure point"
    exit 1
  }
```

---

## Phase 3: Fix Failures

For each FAIL result:
1. Spawn agent that owns the test
2. Fix test or screen code
3. Re-run (max 2 retries from learnings, or default 2)
4. Mark as BUG if still failing

---

## Phase 3.5: Record Learnings (Issue #65)

**CRITICAL**: After testing completes, persist learnings for future runs.

### Step 3.5.1: Collect Execution Data
From Phase 2 and 3 results, gather:
- Test pass/fail rates per test
- Screen error rates
- Retry outcomes (did retries help?)
- New failure patterns discovered

### Step 3.5.2: Update Learning Store
Write updated learnings to `integration_test/memory/learning_context.json`:

```json
{
  "lastRunAt": "2025-01-15T12:30:00Z",
  "totalExecutions": 500,
  "flakyTests": ["test_that_passed_on_retry"],
  "undertestedScreens": ["NewlyAddedScreen"],
  "coverageGaps": [
    {"screen": "JobDetailScreen", "coverage": 0.65, "priority": "high"}
  ],
  "failurePatterns": [
    {"pattern": "TimeoutException", "count": 3, "affected": ["slow_test_1"]}
  ],
  "recommendations": {
    "prioritizeScreens": ["NewlyAddedScreen", "JobDetailScreen"],
    "skipTests": ["permanently_broken_test"],
    "retryTests": {"test_that_passed_on_retry": 2}
  }
}
```

### Step 3.5.3: Detect Trends (if TrendAnalyzer available)
If running in CI with DuckDB:
- Compare pass rates to previous 5 runs
- Flag regressions (>10% drop)
- Identify improving tests

---

## Test Composition with dev_infra

Tests declare dependencies on base scenarios:

```dart
/// Integration Test: Feature Name
///
/// **Depends On**: BaseSeekerProfile, BaseJobPosted
/// **Layer**: 4
library;

import 'package:dev_infra/dev_infra.dart';
import 'base/base_scenarios.dart';

void main() {
  final adapter = MyProjectAdapter();

  testWidgets('feature test', (tester) async {
    // Ensure prerequisites (1 line instead of 50!)
    await BaseSeekerProfile.ensure(tester);
    await BaseJobPosted.ensure(tester);

    // Now test actual feature
    final agent = QAEngineerAgent(
      config: QAAgentConfig(role: 'seeker'),
      adapter: adapter,
    );
    // ...
  });
}
```

---

## Available Modes

- `explore` - Default. Parallel discovery + serial testing
- `preflight` - Run Phase 0 only
- `flow <name>` - Test specific flow
- `coverage` - Report coverage gaps

---

## Final Report Format

```markdown
## UX Testing Session Complete

**Duration**: {elapsed} / {total}
**Device**: {device} ({emulatorHost})

### Learning Context Applied (Issue #65)
- Prioritized {n} undertested screens from history
- Skipped {n} known flaky tests
- Applied retry policies to {n} tests
- Flagged {n} problematic screens for extra handling

### Phase 1: Discovery
| Agent | Keys Added | Tests Written | Learnings Applied |
|-------|------------|---------------|-------------------|
| Role1 | 15 | 5 | 3 screens prioritized |

### Phase 2: Testing
| Layer | Pass | Fail | Skip | Retried |
|-------|------|------|------|---------|
| 1 | 3 | 0 | 0 | 1 |

### Bugs Discovered
| ID | Screen | Description | Severity | Pattern Match |
|----|--------|-------------|----------|---------------|

### Learning Updates Recorded
- New flaky tests detected: {n}
- Coverage gaps updated: {n} screens
- Failure patterns cataloged: {n}
- Trend direction: {improving/stable/regressing}

### Coverage Change
- Before: 67%
- After: 78%
```
