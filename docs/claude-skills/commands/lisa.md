# Lisa - AI QA Engineer v1.0.0

When `/lisa` is invoked, **ALWAYS show this quick reference first**:

```
Lisa - AI QA Engineer v1.0.0

USAGE:
  /lisa                     Show this help
  /lisa setup [project]     Install Lisa + scaffold Flutter project
  /lisa <role>              Native Flutter tests (driver)
  /lisa web <role>          Chrome browser automation
  /lisa record [role]       Record actions → generate tests
  /lisa api <role>          API/backend testing
  /lisa heal                Analyze & auto-fix failures
  /lisa report              Coverage & recommendations
  /lisa status              Health, cache stats, diagnostics
  /lisa seed [cmd]          Manage test data seeding
  /lisa db [cmd]            Database maintenance

ROLES: seeker | employer | employee | visitor | admin

EXAMPLES:
  /lisa setup               Install Lisa globally
  /lisa setup myapp         Scaffold Lisa in Flutter project
  /lisa seeker              Run seeker integration tests
  /lisa web employer        Test employer flows in Chrome
  /lisa record seeker       Watch & record user actions
  /lisa api seeker          Test seeker API endpoints
  /lisa heal                Triage and fix test failures
  /lisa status              Show health and cache stats
  /lisa seed                Show seeded test accounts
  /lisa seed run            Run mini-simulation to create test accounts
  /lisa db verify           Check database integrity
```

---

## Mode Detection

| Input | Mode | Action |
|-------|------|--------|
| `/lisa` | help | Show quick reference above |
| `/lisa setup` | setup | Install Lisa + verify environment |
| `/lisa setup <project>` | scaffold | Full project scaffolding |
| `/lisa <role>` | native | Flutter driver tests |
| `/lisa web <role>` | web | Chrome MCP automation |
| `/lisa record [role]` | record | Record user actions |
| `/lisa api <role>` | api | Backend/HTTP testing |
| `/lisa heal` | heal | Self-healing workflow |
| `/lisa report` | report | Coverage & recommendations |
| `/lisa status` | status | Health, cache, diagnostics |
| `/lisa seed` | seed | Show seeded entities |
| `/lisa seed run` | seed | Run mini-simulation to create accounts |
| `/lisa seed import` | seed | Import from simulation export file |
| `/lisa seed clear` | seed | Clear seeded data |
| `/lisa db` | db | Show diagnostics |
| `/lisa db verify` | db | Check database integrity |
| `/lisa db repair` | db | Auto-repair issues |
| `/lisa db metrics` | db | Show operation metrics |

---

## 0. Setup Mode (`/lisa setup`)

### Basic Installation (`/lisa setup`)

When run without a project name, performs global Lisa installation:

```
1. Create symlinks in ~/.claude/
   - ~/.claude/commands/lisa.md → dev_infra/.claude/commands/lisa.md
   - ~/.claude/skills/lisa-test/SKILL.md → dev_infra/skills/lisa-test/SKILL.md

2. Verify MCP server connectivity
   - Call lisa_health to confirm server responds
   - Check lisa_get_coverage for data access

3. Check environment dependencies
   - Flutter SDK installed
   - Chrome extension available
   - dart command accessible

4. Display configuration status
   - Show active symlinks
   - Show MCP server status
   - Show available Lisa tools count
```

**Run the install script:**
```bash
~/src/dev_infra/bin/install_lisa.sh
```

**Or manually verify:**
```bash
# Check symlinks
ls -la ~/.claude/commands/lisa.md
ls -la ~/.claude/skills/lisa-test/SKILL.md

# Test MCP
# (Lisa tools will respond if MCP server is configured)
```

### Project Scaffolding (`/lisa setup <project_name> [roles]`)

When run with a project name, scaffolds Lisa in a Flutter project:

**Arguments:**
- `project_name`: Name of the project (e.g., "redy", "toknize", "blueskil")
- `roles`: Comma-separated list of roles (default: "user,admin")

**Example:**
```
/lisa setup myapp buyer,seller,admin
```

**Scaffolding Steps:**

#### Step 1: Check dev_infra dependency
```yaml
# pubspec.yaml
dev_dependencies:
  dev_infra:
    path: ../dev_infra  # or git URL
```

If not present, add it and run `flutter pub get`.

#### Step 2: Create directory structure
```
integration_test/
├── adapters/
│   └── {project}_adapter.dart
├── baselines/
│   ├── android/
│   ├── ios/
│   └── web/
├── memory/
│   └── .gitkeep
├── results/
│   └── .gitkeep
├── generated/
│   └── .gitkeep
└── lisa_test.dart
```

#### Step 3: Generate ProjectAdapter
```dart
// integration_test/adapters/{project}_adapter.dart
import 'package:dev_infra/dev_infra.dart';
import 'package:flutter_test/flutter_test.dart';

class {Project}Adapter implements ProjectAdapter {
  @override
  String get projectName => '{project}';

  @override
  List<String> get availableRoles => [{roles}];

  @override
  Future<void> authenticateAs(WidgetTester tester, String role) async {
    // TODO: Implement authentication for each role
    switch (role) {
      case 'buyer':
        // await tester.enterText(find.byKey(Key('email')), 'buyer@test.local');
        break;
      // Add cases for other roles
    }
  }

  @override
  Future<bool> isAuthenticated(WidgetTester tester) async {
    // TODO: Check if user is logged in
    return false;
  }

  @override
  Future<void> logout(WidgetTester tester) async {
    // TODO: Implement logout
  }

  @override
  String getInitialRoute(String role) {
    // TODO: Return starting route for each role
    return '/';
  }

  @override
  List<String> getScreensForRole(String role) {
    // TODO: Return screens accessible to this role
    return ['home', 'profile'];
  }

  @override
  List<JourneyDefinition> getJourneysForRole(String role) {
    // TODO: Define test journeys
    return [];
  }

  @override
  Map<String, ActionHandler> get customActionHandlers => {};

  @override
  List<String> get excludedScreens => [];

  @override
  List<String> get forbiddenFuzzingActions => [];
}
```

#### Step 4: Generate test entry point
```dart
// integration_test/lisa_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:dev_infra/dev_infra.dart';
import 'adapters/{project}_adapter.dart';

void main() {
  final adapter = {Project}Adapter();

  testWidgets('Lisa AI QA', (WidgetTester tester) async {
    final role = const String.fromEnvironment('ROLE', defaultValue: 'user');
    final context = const String.fromEnvironment('CONTEXT', defaultValue: 'normal');

    final lisa = Lisa(
      context: LisaContext(
        platform: 'flutter',
        role: role,
        testContext: context,
      ),
      adapter: adapter,
    );

    await lisa.initialize(tester);
    final result = await lisa.run(tester);

    expect(result.success, isTrue,
        reason: 'Lisa found issues: ${result.issues.join(", ")}');
  });
}
```

#### Step 5: Update .gitignore
```
# Lisa
integration_test/results/
integration_test/memory/sessions/
*.diff.png
```

#### Step 6: Run flutter pub get
```bash
flutter pub get
```

#### Step 7: Display summary
```
Lisa scaffolding complete for {project}!

Created:
  ✓ integration_test/adapters/{project}_adapter.dart
  ✓ integration_test/lisa_test.dart
  ✓ integration_test/baselines/{android,ios,web}/
  ✓ integration_test/memory/
  ✓ integration_test/results/
  ✓ integration_test/generated/

Next steps:
  1. Edit adapters/{project}_adapter.dart with your auth logic
  2. Add test credentials for each role
  3. Run: flutter drive --driver=test_driver/integration_test.dart \
            --target=integration_test/lisa_test.dart \
            --dart-define=ROLE=user
```

### Environment Verification

After setup, verify everything works:

```
lisa_health                    → Server responding
lisa_get_coverage              → Data access working
lisa_get_recommendations       → AI suggestions available
```

**Troubleshooting:**
- If MCP tools don't respond: Check `~/.claude/settings.json` for Lisa MCP server config
- If symlinks broken: Re-run `~/src/dev_infra/bin/install_lisa.sh`
- If Flutter project issues: Ensure `dev_infra` path is correct in pubspec.yaml

---

## 1. Native Mode (`/lisa seeker`)

Run Flutter integration tests via driver:

```bash
# iOS Simulator (preferred)
flutter drive \
  --driver=test_driver/integration_test.dart \
  --target=integration_test/lisa_test.dart \
  --flavor dev \
  -d "iPhone 15 Pro" \
  --dart-define=ROLE=seeker

# Android Emulator
flutter drive \
  --driver=test_driver/integration_test.dart \
  --target=integration_test/lisa_test.dart \
  --flavor dev \
  -d emulator-5554 \
  --dart-define=ROLE=seeker
```

**Options:**
- `--dart-define=CI=true` - CI mode with prioritization
- `--dart-define=CONTEXT=quick` - Smoke tests only
- `--dart-define=CONTEXT=thorough` - Full test suite

---

## 2. Web Mode (`/lisa web seeker`)

Claude drives Chrome browser directly using MCP tools.

### Setup Sequence
1. Check emulators: `curl -s http://localhost:5002` (expect 200)
2. **Seed test accounts** (if needed): `./seed_lisa_users.sh` - see Seeding section below
3. Connect Chrome: `mcp__claude-in-chrome__tabs_context_mcp`
4. Navigate: `http://localhost:5002/app/?showKeys=true&dumpKeys=true&lang=en#/login`
5. Parse keys: `lisa_parse_keys_json` from console output

---

## ⚠️ TEST ACCOUNT SEEDING (CRITICAL)

### NEVER Create Auth Users Directly!

**Wrong approach (HACK - DO NOT USE):**
```bash
# ❌ This only creates Firebase Auth users - NO Firestore documents!
curl -X POST http://localhost:9099/identitytoolkit.googleapis.com/...
```

This creates orphan auth records without `seeker_profiles`, `companies`, or other
required Firestore collections. Tests will fail because user data is incomplete.

### ALWAYS Use Mini-Simulation

**Correct approach:**
```bash
cd /path/to/blueskil/flutter/scripts && ./seed_lisa_users.sh
```

This runs `npm run simulation:mini -- --accounts-only` which:
1. Creates users through proper NestJS registration flows
2. Creates all required Firestore collections (`seeker_profiles`, `companies`, etc.)
3. Uses Ollama for realistic persona generation
4. Writes credentials to Lisa's SQLite (`.lisa_memory/lisa.db`)

### What Gets Created

| Entity Type | Count | Password | Firestore Collections |
|-------------|-------|----------|----------------------|
| `seeker_account` | 1 | pass123 | users, seeker_profiles |
| `employer_account` | 1 | pass123 | users, companies |

**Note:** Mini-sim does NOT create employee accounts - only seekers and employers.

### Getting Test Credentials

**NEVER use hardcoded emails!** Query Lisa's SQLite for dynamically-seeded accounts:

```
# Get seeker credentials
lisa_get_seeded_credentials({entity_type: "seeker_account"})
→ [{auth_email: "realistic-name@domain.com", auth_password: "pass123", entity_id: "..."}]

# Get employer credentials
lisa_get_seeded_credentials({entity_type: "employer_account"})
→ [{auth_email: "company-email@domain.com", auth_password: "pass123", entity_id: "..."}]
```

### If No Seeded Accounts Exist

Run seeding first:
```bash
# From blueskil directory
cd flutter/scripts && ./seed_lisa_users.sh

# Or from backend-api directly
cd backend-api && npm run simulation:mini -- --accounts-only
```

### Custom Seeding Options

```bash
# More seekers/employers
npm run simulation:mini -- --accounts-only --seekers 5 --employers 3

# Full simulation (not just accounts)
npm run simulation:mini
```

---

### Chrome Helper Tools (USE THESE!)

Instead of manually calculating coordinates, use Lisa's Chrome helpers:

```
# 1. Get KEYS_JSON from console
mcp__claude-in-chrome__read_console_messages pattern='KEYS_JSON'

# 2. Parse into structured data
lisa_parse_keys_json(json_string) → {keys: {key_name: {x, y, width, height}}}

# 3. Build click action (calculates center automatically)
lisa_build_click(screen, key_name) → {x: 389, y: 385}

# 4. Build type action
lisa_build_type(screen, key_name, text) → {x, y, text}

# 5. Get AI suggestions for next actions
lisa_suggest_actions(screen, known_keys) → [{action, key, reason}]
```

### Web Workflow
```
lisa_start_session(role) →
  lisa_check_prerequisites(flow_id) →
  lisa_start_flow(flow_id) →
  [Chrome interactions using helpers] →
  lisa_store_keys(screen, keys) →
  lisa_complete_flow(flow_id, success, notes) →
  lisa_get_next_flow →
  repeat
```

---

## ⚡ Performance Optimization (45 actions/min target)

Lisa has three optimization layers for fast browser automation. **USE THESE!**

### 1. Decision Caching - Skip redundant reasoning

Before interacting with any screen, check if we already know what to do:

```
# Check cache FIRST
lisa_route_decision(screen_type="LoginScreen", goal="login_as_seeker")

→ If routed: true
  Use cached action immediately (skip reasoning)

→ If routed: false
  Reason about action, then cache it:
  lisa_cache_decision(screen_type, goal, action_type, target_key, confidence)
```

### 2. Batch Sequencing - 1 MCP call instead of 5

**❌ SLOW - Individual calls (don't do this):**
```javascript
// 5 MCP round-trips = 500-1000ms overhead
mcp__claude-in-chrome__computer(action="left_click", coordinate=[389, 362])
mcp__claude-in-chrome__computer(action="type", text="email@test.com")
mcp__claude-in-chrome__computer(action="left_click", coordinate=[389, 426])
mcp__claude-in-chrome__computer(action="type", text="password")
mcp__claude-in-chrome__computer(action="left_click", coordinate=[389, 574])
```

**✅ FAST - Batch execution (do this):**
```javascript
// 1 MCP call = ~50ms total
mcp__claude-in-chrome__javascript_tool(
  action="javascript_exec",
  text=`window.__flutter_sequence(JSON.stringify([
    {"action": "type", "key": "login_email_input", "text": "s1@s.test"},
    {"action": "type", "key": "login_password_input", "text": "pass123"},
    {"action": "tap", "key": "login_signin_button"}
  ]))`
)
```

### 3. Direct Text Injection

`__flutter_type(key, text)` injects text directly into Flutter's `EditableTextState` -
no simulated keystrokes. Text appears instantly.

### JS Bridge Functions (available with `?showKeys=true`)

| Function | Purpose | Returns |
|----------|---------|---------|
| `__flutter_tap(key)` | Tap widget by key | `true/false` |
| `__flutter_type(key, text)` | Direct text injection | `true/false` |
| `__flutter_keys()` | Get all widget keys + bounds | JSON string |
| `__flutter_sequence([...])` | **Batch N actions** | `{executed, results}` |
| `__flutter_bridge_ready` | Check if bridge loaded | `true/false` |

### Optimized Web Workflow

```
1. Navigate to screen with ?showKeys=true&dumpKeys=true
2. Get keys: __flutter_keys() via javascript_tool
3. Check cache: lisa_route_decision(screen, goal)
4. If cache HIT → build sequence from cached action
5. If cache MISS → determine actions → lisa_cache_decision
6. Execute: __flutter_sequence([actions]) - ALWAYS batch!
7. Verify: screenshot to confirm success
8. Cache outcome: lisa_record_cache_outcome(screen, goal, success)
```

### Example: Login Flow (< 1 second)

```
# 1. Check cache
lisa_route_decision("LoginScreen", "login_as_seeker", min_confidence=0.7)
→ {routed: true, action_type: "sequence", actions: [...]}

# 2. Get credentials (never hardcode!)
lisa_get_seeded_credentials({entity_type: "seeker_account"})
→ {auth_email: "s1@s.test", auth_password: "pass123"}

# 3. Execute batch
mcp__claude-in-chrome__javascript_tool(
  text=`__flutter_sequence(JSON.stringify([
    {"action": "type", "key": "login_email_input", "text": "s1@s.test"},
    {"action": "type", "key": "login_password_input", "text": "pass123"},
    {"action": "tap", "key": "login_signin_button"}
  ]))`
)
→ {executed: 3, results: [{success: true}, {success: true}, {success: true}]}

# 4. Record outcome for learning
lisa_record_cache_outcome("LoginScreen", "login_as_seeker", success=true)
```

**Result: 3 actions in ~1 second instead of ~5 seconds**

### 4. Parallel MCP Calls - Batch independent operations

Claude Code can call multiple MCP tools in parallel in a single message. Use this for independent operations:

**✅ CAN parallelize (independent):**
```
# These have no dependencies - call together:
lisa_get_known_keys("login") + lisa_get_known_keys("home")
computer(screenshot) + read_console_messages(pattern: "KEYS_JSON")
lisa_get_cache_stats + lisa_get_diagnostics
lisa_get_seeded_credentials + lisa_get_flows
```

**❌ MUST sequence (dependent):**
```
# Output of first is input to second:
lisa_parse_keys_json → lisa_build_click       # need keys before click coords
computer(click) → computer(screenshot)        # need click to complete first
lisa_start_flow → lisa_complete_flow          # need flow to be started
navigate(url) → read_page                     # need page to load first
```

**Pattern for multi-step actions:**
```
# Step 1: Parallel - gather all context
[parallel] screenshot + read_console_messages + lisa_get_known_keys

# Step 2: Sequential - act on context
lisa_build_click(screen, key) → computer(left_click, coordinate)

# Step 3: Parallel - verify and record
[parallel] screenshot + lisa_record_cache_outcome
```

**Impact:** ~100-200ms saved per multi-step action by reducing sequential round-trips.

### Cache Tools Reference

| Tool | Purpose |
|------|---------|
| `lisa_route_decision` | Check cache, return action or indicate LLM needed |
| `lisa_cache_decision` | Store decision for future |
| `lisa_get_cached_decision` | Direct cache lookup |
| `lisa_record_cache_outcome` | Track success/failure for learning |
| `lisa_get_cache_stats` | Hit rate, entry count |
| `lisa_clear_cache` | Reset cache (after UI changes) |
| `lisa_maintain_cache` | TTL/LRU pruning |

---

## 3. Recording Mode (`/lisa record seeker`)

Watch user interactions and generate tests automatically.

### Start Recording
```
1. mcp__claude-in-chrome__tabs_context_mcp
2. mcp__claude-in-chrome__navigate to app with ?showKeys=true&dumpKeys=true
3. lisa_start_recording(role, flow_name)
4. Take initial screenshot
5. Tell user: "Recording started. Interact with the app. Say 'save' when done."
```

### During Recording
After each user action or screen change:
```
lisa_record_chrome_action(action_type, details)
mcp__claude-in-chrome__read_console_messages pattern='KEYS_JSON'
lisa_store_keys(screen, keys)
mcp__claude-in-chrome__computer action='screenshot'
```

### Stop & Export
When user says "save" or "done":
```
lisa_stop_recording →
  lisa_export_flow(format='yaml') →
  .lisa_memory/flows.yaml

# Or full pipeline to test:
lisa_record_to_test(flow_name) →
  integration_test/generated/<flow>_test.dart
```

### Recording Tools
| Tool | Purpose |
|------|---------|
| `lisa_start_recording` | Begin capture session |
| `lisa_stop_recording` | Stop and get results |
| `lisa_record_event` | Manually record an event |
| `lisa_record_chrome_action` | Record Chrome interaction |
| `lisa_get_recorded_actions` | Get all recorded actions |
| `lisa_export_recording` | Export as Journey/JSON/summary |
| `lisa_export_flow` | Export as flow YAML |

---

## 4. API Mode (`/lisa api seeker`)

Test NestJS/HTTP backend endpoints.

### Workflow
```
lisa_api_load_flows(file_path) →
  lisa_api_start_session(role) →
  lisa_api_get_flows →
  lisa_api_start_flow(flow_id) →
  lisa_api_get_step →
  [Execute HTTP request] →
  lisa_api_report_step(success, response) →
  lisa_api_complete_flow
```

### API Tools
| Tool | Purpose |
|------|---------|
| `lisa_api_load_flows` | Load API test definitions |
| `lisa_api_get_flows` | List available API flows |
| `lisa_api_start_session` | Begin API test session |
| `lisa_api_start_flow` | Start specific API flow |
| `lisa_api_get_step` | Get current test step |
| `lisa_api_report_step` | Report step result |
| `lisa_api_complete_flow` | Finish API flow |
| `lisa_api_get_progress` | Session progress |

---

## 5. Heal Mode (`/lisa heal`)

Analyze test failures and auto-fix when possible.

### Failure Classification
```
lisa_get_failure_patterns →
  For each failure:
    lisa_classify_failure(test_name, error, stack_trace)
    → Returns: SELECTOR_DRIFT | REAL_BUG | FLAKY | ENV_ISSUE
```

### Auto-Healing
```
If SELECTOR_DRIFT:
  lisa_heal_failure(test_name, classification)
  → Updates selectors automatically

If REAL_BUG:
  lisa_generate_bug_report(test_name, error, screenshot)
  → Returns GitHub issue body

If FLAKY:
  lisa_heal_failure with retry logic

If ENV_ISSUE:
  Report to user for manual intervention
```

### Self-Healing Tools
| Tool | Purpose |
|------|---------|
| `lisa_classify_failure` | Categorize failure type |
| `lisa_heal_failure` | Auto-fix if possible |
| `lisa_generate_bug_report` | Create GitHub issue body |
| `lisa_get_failure_patterns` | Recurring failure patterns |
| `lisa_get_flaky_elements` | Intermittently failing elements |

---

## 6. Report Mode (`/lisa report`)

Generate comprehensive testing reports.

### Gather Data
```
lisa_get_coverage →
  {screens_tested, screens_untested, overall_percent}

lisa_get_priorities →
  [{screen, risk_score, reason}]

lisa_get_recommendations →
  [{action, priority, rationale}]

lisa_get_bug_history(limit=20) →
  [{screen, element, error, count, last_seen}]

lisa_get_flaky_elements(threshold=0.3) →
  [{element, flakiness_score, failure_rate}]

lisa_get_decision_log →
  [{timestamp, decision, reasoning, outcome}]
```

---

## 7. Status Mode (`/lisa status`)

Show Lisa health, cache performance, and diagnostics.

### Gather Status
```
lisa_health →
  {status, version, uptime_seconds, memory, warnings}

lisa_get_diagnostics →
  {healthy, schema_version, db_size, cache, keys, stats, tests_generated, metrics}

lisa_get_cache_stats →
  {total_entries, hit_rate, avg_confidence}

lisa_get_key_stats →
  {total_keys, total_screens, keys_by_screen}
```

### Status Tools
| Tool | Purpose |
|------|---------|
| `lisa_health` | Server health check |
| `lisa_get_diagnostics` | Comprehensive diagnostics |
| `lisa_get_cache_stats` | Cache hit rate, entries |
| `lisa_get_key_stats` | Key count by screen |
| `lisa_get_metrics` | Operation timing, errors |

---

## 8. Seed Mode (`/lisa seed`)

Manage test account seeding and credentials.

### Show Seeded Entities (`/lisa seed`)
```
lisa_get_seeded →
  {count, entities: [{entity_type, entity_id, has_auth}]}

lisa_get_seeded_credentials({entity_type: "seeker_account"}) →
  [{auth_email, auth_password, entity_id}]
```

### Run Mini-Simulation (`/lisa seed run`)

Creates test accounts through proper NestJS registration flows.

**What Claude does:**
```bash
# 1. Check emulators are running
curl -s http://localhost:9099 > /dev/null

# 2. Run mini-simulation (accounts-only mode)
cd backend-api && npm run simulation:mini -- --accounts-only

# 3. Verify seeded data
lisa_get_seeded
```

**What gets created:**
| Entity Type | Count | Password | Firestore Collections |
|-------------|-------|----------|----------------------|
| `seeker_account` | 1 | pass123 | users, seeker_profiles |
| `employer_account` | 1 | pass123 | users, companies |

**Options:**
```bash
# More accounts
npm run simulation:mini -- --accounts-only --seekers 5 --employers 3

# Full simulation (jobs, applications, engagements too)
npm run simulation:mini
```

**Why this matters:**
- ❌ Direct auth user creation only creates Firebase Auth records (no Firestore docs!)
- ✅ Mini-simulation creates complete user data through proper registration flows
- ✅ Credentials are automatically stored in Lisa's SQLite for `lisa_get_seeded_credentials`

### Import from File (`/lisa seed import`)
```
# From simulation export file
lisa_import_simulation(file_path) →
  Imports from /tmp/lisa-simulation-seed.json

# Manual import
lisa_import_seeded(entities: [
  {entity_type, entity_id, auth_email, auth_password, data}
])
```

### Clear Seeded Data (`/lisa seed clear`)
```
lisa_clear_seeded →
  Clears all seeded entity tracking

lisa_clear_seeded({entity_type: "seeker_account"}) →
  Clears only seeker accounts
```

### Seed Tools
| Tool | Purpose |
|------|---------|
| `lisa_get_seeded` | Query seeded entities |
| `lisa_get_seeded_credentials` | Get auth email/password |
| `lisa_import_seeded` | Import entities to Lisa's DB |
| `lisa_import_simulation` | Import from simulation export |
| `lisa_clear_seeded` | Clear seeded tracking |

---

## 9. Database Mode (`/lisa db`)

Database maintenance and diagnostics.

### Show Diagnostics
```
lisa_get_diagnostics →
  {
    healthy: true,
    schema_version: 5,
    db_size_bytes: 24576,
    cache: {entries, hit_rate, avg_confidence},
    keys: {total_keys, total_screens},
    stats: {tests_generated: 42, ...},
    tests_generated: 42,
    metrics: {uptime, total_calls, error_rate}
  }
```

### Verify Integrity
```
lisa_verify_integrity →
  {
    valid: true/false,
    sqlite_integrity: "ok",
    issues: ["orphaned records", ...]
  }
```

### Repair Database
```
lisa_repair_database →
  {
    repairs_performed: ["deleted orphans", "recreated indexes"],
    success: true
  }
```

### View/Reset Metrics
```
lisa_get_metrics →
  {cache: {hits, misses}, timing: {avg_read_ms}, errors: {...}}

lisa_reset_metrics →
  Resets all counters to zero
```

### Database Tools
| Tool | Purpose |
|------|---------|
| `lisa_get_diagnostics` | Full health report |
| `lisa_verify_integrity` | Check DB integrity |
| `lisa_repair_database` | Auto-fix issues |
| `lisa_get_metrics` | Operation stats |
| `lisa_reset_metrics` | Reset counters |

---

## Prerequisites System

For flows with dependencies (e.g., "edit profile" requires logged-in user):

### Check Before Running
```
lisa_check_prerequisites(flow_id) →
  {
    satisfied: true/false,
    missing: [{prereq_id, description}],
    ensure_hints: [{action, params}]
  }
```

### Get Full Chain
```
lisa_get_prerequisite_chain(flow_id) →
  [prereq_1, prereq_2, ..., target_flow]
```

### Diagnose Failures
```
lisa_diagnose_prerequisite_failure(flow_id, error) →
  {cause, suggestion, related_flows}
```

---

## Entity Tracking

Track test data created during testing for cleanup:

```
# During test
lisa_track_created_entity(type='user', id='test-123', metadata={})

# After tests
lisa_rollback_entities →
  Deletes all tracked entities
```

---

## Decision Logging

Track AI reasoning for audit trail:

```
lisa_log_decision(
  decision: "Skipping profile test",
  reasoning: "Prerequisites not satisfied",
  context: {flow_id, missing_prereqs}
)

lisa_get_decision_log(limit=50) →
  [{timestamp, decision, reasoning, outcome}]
```

---

## Flow Pipeline

Full pipeline from recording to test:

```
lisa_validate_flow(yaml_content) →
  {valid: true/false, errors: [], warnings: []}

lisa_flow_to_test(flow_yaml, output_path) →
  Writes integration_test/generated/<flow>_test.dart

lisa_record_to_test(recording_id) →
  recording → flow YAML → test code
```

---

## Complete Tool Reference

### Session Management
| Tool | Purpose |
|------|---------|
| `lisa_health` | Server health check |
| `lisa_start_session` | Begin test session for role |
| `lisa_get_next_flow` | Get prioritized next test |
| `lisa_start_flow` | Begin specific flow |
| `lisa_complete_flow` | Record pass/fail result |
| `lisa_get_progress` | Session progress stats |
| `lisa_get_flow_details` | Get flow guidance |
| `lisa_load_flows` | Load flow definitions |
| `lisa_get_flows` | List available flows |

### Coverage & Intelligence
| Tool | Purpose |
|------|---------|
| `lisa_get_coverage` | Test coverage stats |
| `lisa_get_priorities` | Risk-ranked targets |
| `lisa_get_recommendations` | AI suggestions |
| `lisa_get_state_machine` | Known app structure |
| `lisa_write_session` | Persist session data |

### Bug Intelligence
| Tool | Purpose |
|------|---------|
| `lisa_get_bug_history` | Past failures |
| `lisa_get_flaky_elements` | Unreliable elements |
| `lisa_get_failure_patterns` | Recurring issues |

### Self-Healing
| Tool | Purpose |
|------|---------|
| `lisa_classify_failure` | Categorize failure |
| `lisa_heal_failure` | Auto-fix if possible |
| `lisa_generate_bug_report` | GitHub issue body |

### Widget Keys
| Tool | Purpose |
|------|---------|
| `lisa_store_keys` | Save discovered keys |
| `lisa_get_known_keys` | Retrieve stored keys |
| `lisa_store_keys_batch` | Save keys for multiple screens |
| `lisa_get_known_keys_batch` | Get keys for multiple screens |
| `lisa_get_key_stats` | Key statistics by screen |
| `lisa_parse_keys_json` | Parse KEYS_JSON string |

### Chrome Helpers
| Tool | Purpose |
|------|---------|
| `lisa_build_click` | Get click coordinates |
| `lisa_build_type` | Get type action |
| `lisa_suggest_actions` | AI action suggestions |
| `lisa_record_chrome_action` | Record interaction |
| `lisa_get_recorded_actions` | Get recorded actions |

### Recording
| Tool | Purpose |
|------|---------|
| `lisa_start_recording` | Begin capture |
| `lisa_stop_recording` | Stop & get results |
| `lisa_record_event` | Record single event |
| `lisa_export_recording` | Export recording |
| `lisa_export_flow` | Export as flow YAML |

### Flow Pipeline
| Tool | Purpose |
|------|---------|
| `lisa_save_flow` | Save/update flow to flows.yaml |
| `lisa_validate_flow` | Validate flow YAML |
| `lisa_generate_test` | Generate test from flow + keys |
| `lisa_flow_to_test` | Generate Dart test code |
| `lisa_record_to_test` | Full pipeline |

**Note:** Test generation tools (`lisa_generate_test`, `lisa_flow_to_test`, `lisa_record_to_test`)
automatically increment the `tests_generated` counter. View via `lisa_get_diagnostics`.

### Prerequisites
| Tool | Purpose |
|------|---------|
| `lisa_check_prerequisites` | Check dependencies |
| `lisa_get_prerequisite_chain` | Get full chain |
| `lisa_diagnose_prerequisite_failure` | Debug failures |

### Entity Tracking
| Tool | Purpose |
|------|---------|
| `lisa_track_created_entity` | Track test data |
| `lisa_rollback_entities` | Cleanup entities |

### Decision Log
| Tool | Purpose |
|------|---------|
| `lisa_log_decision` | Log reasoning |
| `lisa_record_correction` | Record fix |
| `lisa_get_decision_log` | View history |

### API Testing
| Tool | Purpose |
|------|---------|
| `lisa_api_load_flows` | Load API tests |
| `lisa_api_get_flows` | List API flows |
| `lisa_api_start_session` | Begin API session |
| `lisa_api_start_flow` | Start API flow |
| `lisa_api_get_step` | Get current step |
| `lisa_api_report_step` | Report result |
| `lisa_api_complete_flow` | Finish flow |
| `lisa_api_get_progress` | API progress |

### Seeding
| Tool | Purpose |
|------|---------|
| `lisa_import_seeded` | Import entities to Lisa's DB |
| `lisa_get_seeded` | Query seeded entities |
| `lisa_get_seeded_credentials` | Get auth email/password |
| `lisa_clear_seeded` | Clear seeded tracking |
| `lisa_import_simulation` | Import from Ollama sim |

### Database & Diagnostics
| Tool | Purpose |
|------|---------|
| `lisa_get_diagnostics` | Full health report |
| `lisa_verify_integrity` | Check DB integrity |
| `lisa_repair_database` | Auto-fix issues |
| `lisa_get_metrics` | Operation stats |
| `lisa_reset_metrics` | Reset counters |

### Orchestration
| Tool | Purpose |
|------|---------|
| `lisa_orchestrate` | Full autonomous run |

### Decision Caching (Performance)
| Tool | Purpose |
|------|---------|
| `lisa_route_decision` | Check cache before acting |
| `lisa_cache_decision` | Store decision for reuse |
| `lisa_get_cached_decision` | Direct cache lookup |
| `lisa_record_cache_outcome` | Track success/failure |
| `lisa_get_cache_stats` | Cache hit rate |
| `lisa_clear_cache` | Reset cache |
| `lisa_maintain_cache` | TTL/LRU cleanup |

### JS Bridge (Flutter Web)
| Function | Purpose |
|----------|---------|
| `__flutter_tap(key)` | Tap by widget key |
| `__flutter_type(key, text)` | Direct text injection |
| `__flutter_keys()` | Get all keys + bounds |
| `__flutter_sequence([...])` | Batch N actions in 1 call |

---

## Troubleshooting

**Emulators not running:**
```bash
cd ~/src/blueskil && ./deploy_dev_emulator.sh
```

**Chrome not connected:**
- Verify Claude browser extension is installed
- Run `mcp__claude-in-chrome__tabs_context_mcp` to connect

**Keys not visible:**
- Ensure URL has `?showKeys=true&dumpKeys=true`
- Reload page if keys don't appear

**Lisa tools not available:**
```bash
# Re-run installation
~/src/dev_infra/bin/install_lisa.sh
```

**Connection refused (real device):**
- Set `EMULATOR_HOST` to your machine's IP, not localhost
