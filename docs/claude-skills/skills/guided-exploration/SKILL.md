---
name: guided-exploration
description: |
  Guided Exploration - Turn English flow descriptions into grounded YAML.
  Industrial-grade with automatic dialog handling, loading detection, and loop prevention.
  Triggers: "/explore", "explore {flow}", "create flow for {description}",
  "guided exploration", "discover {flow} flow"
allowed-tools: Bash, Read, Write, Glob, Grep, mcp__lisa__*, mcp__claude-in-chrome__*, mcp__dart__*
---

# Guided Exploration (Issue #329)

Transform natural language flow descriptions into grounded, testable YAML flow definitions by actually traversing the app.

## Triggers

| Pattern | Example |
|---------|---------|
| `/explore {description}` | `/explore login and apply for job as seeker` |
| `explore {flow}` | `explore the employer job posting flow` |
| `create flow for {description}` | `create flow for seeker profile editing` |
| `guided exploration for {description}` | `guided exploration for checkout process` |
| `discover {flow} flow` | `discover the password reset flow` |

## Workflow

### Phase 1: Plan (ALWAYS show to user first)

1. **Load existing flows**
   ```
   lisa_load_flows()  # Uses server's memoryDir/flows.yaml
   lisa_get_flows(role: "<detected_role>")
   ```

2. **Identify reusable flows**
   - Check if any existing flows can be reused via `uses:` linking
   - Example: "apply for job" likely needs "login_seeker" first

3. **Output PLAN for approval**
   ```
   PLAN: <flow_name>

   Role: <seeker|employer|admin|visitor>

   REUSE:
     - login_seeker (grounded, 5 keys)

   EXPLORE:
     - <description of new screens/actions to discover>

   Expected Screens:
     - dashboard -> jobs_list -> job_detail -> apply_form -> confirmation

   Gaps/Unknowns:
     - job_detail screen not yet explored
     - apply_form fields unknown

   Confidence: <high|medium|low>

   Proceed with exploration? [y/n]
   ```

4. **Wait for user approval before exploring**

### Phase 2: Explore (after approval)

1. **Navigate to app with key discovery enabled**
   ```
   mcp__claude-in-chrome__navigate(url: "http://localhost:5002/?dumpKeys=true&showKeys=true")
   ```

2. **Wait for page readiness (BEFORE EVERY ACTION)**
   ```
   # Get accessibility tree
   tree = mcp__claude-in-chrome__read_page(tabId: <id>)

   # Check preparation status
   prep = lisa_prepare_for_action(accessibility_tree: tree, route: "/login")

   # Handle any required actions
   while not prep.ready:
       if prep.required_actions contains "wait_for_loading":
           mcp__claude-in-chrome__computer(action: "wait", duration: 0.5)
       elif prep.required_actions contains "click_dialog_button":
           mcp__claude-in-chrome__computer(action: "left_click", ref: action.ref_id)
       elif prep.required_actions contains "break_loop":
           # Try suggested action or navigate away

       # Re-check readiness
       tree = mcp__claude-in-chrome__read_page(tabId: <id>)
       prep = lisa_prepare_for_action(accessibility_tree: tree)
   ```

3. **Execute prerequisite flows if needed**
   - If `uses: [login_seeker]`, execute that flow first
   - Use known keys from `lisa_get_known_keys(screen: "login")`

4. **Explore new screens**
   - Take screenshot for context
   - Read KEYS_JSON from console:
     ```
     mcp__claude-in-chrome__read_console_messages(pattern: "KEYS_JSON")
     ```
   - Parse and store keys:
     ```
     lisa_store_keys(screen: "<screen_name>", keys: <parsed_keys>)
     ```

5. **Execute actions and record**
   - **Always call `lisa_prepare_for_action` before each action**
   - Use `lisa_build_click(screen, key_name)` for coordinates
   - Track each action for the flow steps

6. **Verify success indicators**
   - Check for expected UI elements
   - Capture final screen state

### Phase 3: Save (after successful exploration)

1. **Build flow definition**
   ```json
   {
     "flow_id": "apply_for_job",
     "flow": {
       "role": "seeker",
       "uses": ["login_seeker"],
       "intent": "Apply for an available job posting",
       "priority": "high",
       "steps": [
         {"action": "tap", "target": "jobs_tab", "target_type": "widget_key"},
         {"action": "tap", "target": "job_card_0", "target_type": "widget_key"},
         {"action": "tap", "target": "apply_button", "target_type": "widget_key"}
       ],
       "success_indicators": ["Application submitted", "confirmation_screen visible"],
       "tags": ["core", "seeker", "jobs"]
     }
   }
   ```

2. **Save to flows.yaml**
   ```
   lisa_save_flow(flow_id: "apply_for_job", flow: {...})
   ```

3. **Report results**
   ```
   EXPLORATION COMPLETE

   Flow: apply_for_job
   Action: added (or: replaced)
   Keys discovered: 12
   Screens visited: 4

   File: <memoryDir>/flows.yaml  # Path from lisa_save_flow response
   Total flows: 7
   ```

## Flow Linking with `uses:`

When a flow depends on another:

```yaml
apply_for_job:
  role: seeker
  uses: [login_seeker]  # Run login_seeker first
  starts_from: dashboard  # Where login_seeker ends
  intent: "Apply for an available job posting"
  steps:
    - action: tap
      target: jobs_tab
    - action: tap
      target: job_card_0
    - action: tap
      target: apply_button
```

**Behavior:**
- When executing `apply_for_job`, first verify `login_seeker` was run or is satisfied
- Skip prerequisite if already logged in (check auth state)
- Start exploration from `starts_from` screen

## Key MCP Tools

| Tool | Purpose |
|------|---------|
| `lisa_load_flows` | Load existing flows.yaml |
| `lisa_get_flows` | Query flows by role/priority/tag |
| `lisa_save_flow` | Save new/updated flow |
| `lisa_get_known_keys` | Get previously discovered widget keys |
| `lisa_store_keys` | Store newly discovered keys |
| `lisa_build_click` | Get click coordinates for a key |
| `lisa_detect_state` | Detect screen state, dialogs, loading from accessibility tree |
| `lisa_prepare_for_action` | Get required actions before page is ready (wait, dismiss dialog, break loop) |
| `mcp__claude-in-chrome__navigate` | Navigate to URL |
| `mcp__claude-in-chrome__read_page` | Get accessibility tree for state detection |
| `mcp__claude-in-chrome__read_console_messages` | Read KEYS_JSON |
| `mcp__claude-in-chrome__computer` | Click/type actions |

## Chrome Adaptation Layer

The adaptation layer provides industrial-grade handling of loading states, dialogs, and loop detection.

### Before Every Action

Always check page readiness before taking actions:

```
# 1. Get accessibility tree
mcp__claude-in-chrome__read_page(tabId: <id>)

# 2. Analyze state (pure detection, no side effects)
lisa_detect_state(accessibility_tree: "<tree>", route: "/current-route")
→ {
    screen_id: "login_screen",
    dialogs: [{type: "cookie_consent", buttons: [...]}],
    loading: {is_loading: false},
    loop_detected: false,
    confidence: 0.85
  }

# 3. Check preparation requirements
lisa_prepare_for_action(accessibility_tree: "<tree>", route: "/current-route")
→ {
    ready: false,
    required_actions: [
      {type: "click_dialog_button", ref_id: "ref_42", label: "Accept", action: "dismiss"}
    ]
  }

# 4. Execute required actions, then retry
mcp__claude-in-chrome__computer(action: "left_click", ref: "ref_42")
```

### Handling Loading States

When `lisa_prepare_for_action` returns a `wait_for_loading` action:

```
{
  ready: false,
  required_actions: [{
    type: "wait_for_loading",
    progress: 0.6,
    message: "Loading jobs...",
    suggested_wait_ms: 500
  }]
}
```

**Action**: Wait the suggested time, re-read accessibility tree, call `lisa_prepare_for_action` again.

### Handling Dialogs

Dialogs are auto-analyzed with safe defaults:
- **Cookie consent, promotional**: Auto-dismiss
- **Snackbars, toasts**: Ignore (non-modal)
- **Destructive confirmations**: Require `allow_destructive: true`

```
lisa_prepare_for_action(
  accessibility_tree: "<tree>",
  allow_destructive: false  # Default: won't auto-confirm deletes
)
```

### Breaking Loops

When the same screen is visited 3+ times, loop detection triggers:

```
{
  ready: false,
  required_actions: [{
    type: "break_loop",
    strategy: "try_different_action",
    loop_pattern: "Screen \"job_list\" visited 3 times",
    suggested_actions: ["filter_button", "sort_dropdown", "back_button"]
  }]
}
```

**Strategies**:
- `try_different_action`: Try an untried action on current screen
- `go_back`: Navigate to previous screen
- `navigate_away`: Go to a different section entirely
- `reset_to_initial`: Return to dashboard/home
- `stop_exploration`: Give up (unbreakable loop)

## Example Session

```
User: explore login and apply for job as seeker

Claude: Loading existing flows...

lisa_load_flows(file_path: ".lisa_memory/flows.yaml")
lisa_get_flows(role: "seeker")

Found 3 existing flows:
  - login_seeker (grounded, 5 keys)
  - browse_jobs (grounded, 8 keys)
  - view_profile (grounded, 4 keys)

PLAN: apply_for_job

Role: seeker

REUSE:
  - login_seeker (handles authentication)

EXPLORE:
  - Job application flow from jobs list
  - Need to discover: job_detail screen, apply_form, confirmation

Expected Screens:
  dashboard -> jobs_list -> job_detail -> apply_form -> confirmation

Gaps:
  - job_detail layout unknown
  - Application form fields unknown

Confidence: medium

Proceed with exploration? [y/n]

User: y

Claude: Starting exploration...

[Executes login_seeker flow using known keys]
[Navigates to jobs list]
[Discovers job_detail keys]
[Discovers apply_form keys]
[Completes application]

EXPLORATION COMPLETE

Flow: apply_for_job
Action: added
Keys discovered: 15
Screens visited: 4
Uses: [login_seeker]

Saved to .lisa_memory/flows.yaml
Total flows: 4
```

## Error Handling

| Scenario | Action |
|----------|--------|
| No existing flows.yaml | Create new file with first flow |
| Prerequisite flow missing | Warn user, offer to explore it first |
| Navigation fails | Capture error, ask user for guidance |
| Keys not found | Take screenshot, try alternative selectors |
| App state mismatch | Reset and retry from known state |
| Loading timeout | Report timeout, suggest manual intervention |
| Unbreakable loop detected | Stop exploration, report loop pattern to user |
| Dialog blocking action | Show dialog details, ask user how to proceed |
| Unknown screen state | Take screenshot, reduce confidence, proceed cautiously |

## Best Practices

1. **Always plan first** - Never explore without user approval
2. **Reuse existing flows** - Check for linkable flows before exploring
3. **Ground everything** - Only include keys/steps actually discovered
4. **Verify success** - Confirm the flow completed before saving
5. **Incremental exploration** - One flow at a time, build up the library
