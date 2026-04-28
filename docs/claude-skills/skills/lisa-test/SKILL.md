---
name: lisa-test
description: |
  Lisa - AI QA Engineer for autonomous Flutter/API testing.
  Triggers: "run lisa", "test with lisa", "lisa <role>", "heal tests",
  "test report", "record test", "test API", "fix failing tests"
allowed-tools: Bash, Read, Write, Glob, Grep, mcp__lisa__*, mcp__claude-in-chrome__*, mcp__dart__*
---

# Lisa - AI QA Engineer (Skill) v1.0.0

This skill auto-activates on natural language triggers. For explicit invocation, use `/lisa`.

> **Full Documentation**: Use `/lisa` command for comprehensive reference, setup modes, and troubleshooting.

## Auto-Activation Triggers

| Phrase Pattern | Mode | Action |
|----------------|------|--------|
| "run lisa", "lisa seeker/employer" | native | Flutter driver tests |
| "test with lisa in chrome", "lisa web" | web | Chrome automation |
| "record test", "watch me test", "lisa record" | record | Record & generate |
| "test API", "test endpoints", "lisa api" | api | Backend testing |
| "heal tests", "fix failing tests", "auto-fix" | heal | Self-healing |
| "test report", "coverage report", "what needs testing" | report | Generate report |
| "seed test accounts", "create test users", "lisa seed" | seed | Run mini-simulation |

## ⚠️ CRITICAL: Test Account Seeding

**NEVER create auth users directly via curl/API!** This creates orphan records without Firestore documents.

**Use `/lisa seed run` to create test accounts:**
```bash
# Claude runs this for you:
cd backend-api && npm run simulation:mini -- --accounts-only
```

This runs mini-simulation which creates:
- 1 seeker account (users + seeker_profiles collections)
- 1 employer account (users + companies collections)
- Credentials stored in Lisa's SQLite for retrieval

**ALWAYS get credentials dynamically:**
```
lisa_get_seeded_credentials({entity_type: "seeker_account"})
lisa_get_seeded_credentials({entity_type: "employer_account"})
```

See `/lisa seed` for full seeding documentation.

---

## Intelligent Behaviors

### 1. ALWAYS Use Chrome Helpers for Web Mode

**Never manually calculate coordinates.** Use Lisa's helpers:

```
# Parse keys from console
lisa_parse_keys_json(json_string)

# Get exact click coordinates (auto-calculates center)
lisa_build_click(screen, key_name) → {x, y}

# Get type action
lisa_build_type(screen, key_name, text) → {x, y, text}

# Get AI suggestions
lisa_suggest_actions(screen, known_keys) → [{action, key, reason}]
```

### 2. ALWAYS Check Prerequisites Before Flows

```
lisa_check_prerequisites(flow_id)
→ {satisfied: bool, missing: [], ensure_hints: []}
```

If not satisfied, either:
- Run prerequisite flows first
- Use ensure_hints to set up state

### 3. ALWAYS Track Decisions

```
lisa_log_decision(decision, reasoning, context)
```

This creates an audit trail for debugging and learning.

### 4. Self-Heal When Possible

On any test failure:
1. `lisa_classify_failure` → SELECTOR_DRIFT | REAL_BUG | FLAKY | ENV_ISSUE
2. If SELECTOR_DRIFT: `lisa_heal_failure` (auto-fix)
3. If REAL_BUG: `lisa_generate_bug_report` (create issue)
4. If FLAKY: Add retry logic
5. If ENV_ISSUE: Report to user

### 5. Track Created Test Data

```
lisa_track_created_entity(type, id, metadata)
# ... run tests ...
lisa_rollback_entities()  # cleanup
```

## Quick Workflows

### Native Testing
```
flutter drive --driver=test_driver/integration_test.dart \
  --target=integration_test/lisa_test.dart \
  --flavor dev -d "iPhone 15 Pro" \
  --dart-define=ROLE=seeker
```

### Web Testing
```
lisa_start_session(role) →
  mcp__claude-in-chrome__read_console_messages pattern='KEYS_JSON' →
  lisa_parse_keys_json →
  lisa_build_click(key) →
  mcp__claude-in-chrome__computer action='left_click' →
  lisa_complete_flow
```

### Recording → Test Generation
```
lisa_start_recording(role, flow_name) →
  [user interacts] →
  lisa_record_chrome_action (each action) →
  lisa_stop_recording →
  lisa_record_to_test →
  integration_test/generated/<flow>_test.dart
```

### Failure Triage
```
lisa_get_failure_patterns →
  lisa_classify_failure(test, error, stack) →
  [SELECTOR_DRIFT] lisa_heal_failure →
  [REAL_BUG] lisa_generate_bug_report
```

### API Testing
```
lisa_api_load_flows(file) →
  lisa_api_start_session(role) →
  lisa_api_start_flow(flow_id) →
  lisa_api_get_step →
  [HTTP request] →
  lisa_api_report_step(success, response) →
  lisa_api_complete_flow
```

## Tool Categories

### Compound Tools (Preferred - Use These First!)

These tools combine multiple operations for efficiency:

| Tool | Combines | Use For |
|------|----------|---------|
| `lisa_explore` | key parsing, state detection, actions | Screen analysis after navigation |
| `lisa_setup` | flow loading, seeding, session start | Initialize test session |
| `lisa_report` | coverage, bugs, priorities, recommendations | End-of-session reporting |
| `lisa_analyze` | diagnostics, cache stats, key stats, metrics | Health check and debugging |
| `lisa_keys` | store/get/stats for widget keys | All key management |
| `lisa_run_flow` | start/complete/check prerequisites | Flow lifecycle |
| `lisa_api_setup` | load flows, start session | API testing init |
| `lisa_api_step` | start/next/report/complete | API flow execution |
| `lisa_batch` | parallel tool execution | Multiple independent calls |

### Session & Flow Management
`lisa_health`, `lisa_get_flows`, `lisa_get_progress`, `lisa_orchestrate`

### Chrome Helpers
`lisa_build_click`, `lisa_build_type`

### Recording & Test Generation
`lisa_start_recording`, `lisa_stop_recording`, `lisa_record_event`,
`lisa_save_flow`, `lisa_validate_flow`, `lisa_flow_to_test`, `lisa_generate_test`

### Self-Healing
`lisa_classify_failure`, `lisa_heal_failure`, `lisa_generate_bug_report`

### Test Data Seeding
`lisa_get_seeded`

### API Testing
`lisa_api_get_progress`

## Installation

```bash
~/src/dev_infra/bin/install_lisa.sh
```

This creates symlinks from `~/.claude/` to the dev_infra source files.

## Version Compatibility

| Component | Version | Location |
|-----------|---------|----------|
| Command | 1.0.0 | `.claude/commands/lisa.md` |
| Skill | 1.0.0 | `.claude/skills/lisa-test/SKILL.md` |
| MCP Server | 1.0.0 | `lib/src/mcp/lisa_mcp_server.dart` |

Use `lisa_health` to verify MCP server version matches.
