# Synthetic Test Fabric — For Senior QA Engineers

**Audience:** Senior QA engineers, QA leads, engineers who own test strategy

---

## What This Changes About Your Job

The honest version: Synthetic Test Fabric removes a large chunk of work that consumes most QA time — regression script maintenance, manual seeding, re-running "did this break?" checks after every deploy.

What it does not do is think. It does not know that the new job posting form has a subtle validation issue that only manifests when a user with a partial profile completes it in under 30 seconds. It does not know that the mobile experience for users switching roles mid-session has never been tested end-to-end. It does not know that the edge case from last quarter just silently reappeared in the flow the PM thought was stable.

You know those things. The system gives you back the time to act on them.

---

## The New Division of Labor

| The system handles | You handle |
|-------------------|-----------|
| Running the regression suite on every merge | Writing personas that encode realistic user behavior |
| Discovering new screen paths from simulation | Recognizing which findings matter vs. which are noise |
| Generating Playwright flows from observed paths | Reasoning about edge cases the system can't reach autonomously |
| Tracking per-flow flakiness and quarantining flakey tests | Setting score thresholds that reflect real risk |
| Seeding and resetting test state before each iteration | Designing the scenario catalog |
| Producing a scored report with dimension breakdown | Interpreting low scores and deciding what to do about them |
| Running adversarial probes on every iteration | Reviewing adversarial findings for security implications |

The ratio shifts: instead of 70% maintenance + 30% strategy, it inverts.

---

## Your Expertise Becomes the System's Intelligence

The highest-leverage thing you contribute to this system is **persona authorship**.

A persona is not a test script. It is a description of a real user — their goals, their constraints, the pressure they're under, how cautious or risk-tolerant they are. The system's simulation agents use these descriptions to navigate the product the way that user would.

```yaml
schema_version: 1
id: maria-chen
role: seeker
display_name: Maria Chen
backstory: Electrician apprentice, 6 months from finishing her apprenticeship.
           Applying for her first journeyman role. Bills are tight.
goals:
  - find a journeyman electrician role within 30 miles
  - apply before her apprenticeship ends in 6 weeks
  - understand what certifications the employer requires
constraints:
  - cannot relocate
  - does not have a premium subscription
pressure:
  financial: 0.85     # high — rent is due
  urgency: 0.9        # very high — 6-week window
  risk_tolerance: 0.2 # low — cannot afford to waste applications
```

This persona behaves differently from one with no urgency and high risk tolerance. She skips optional steps, goes directly for the apply button, does not browse employer profiles. A persona with low urgency and high risk tolerance explores — she reads help text, visits her own profile, checks for notifications.

The combination of pressure levels across 10–20 personas in a run produces natural coverage variance without scripting individual flows. You are not writing test cases — you are writing user stories. The system converts them into test coverage.

**Your domain knowledge about who your real users are and what they actually do is the input that determines coverage quality.** The more accurately the personas reflect real user behavior, the more the discovered paths resemble real user paths.

---

## How to Steer the System

### When coverage_delta is low

The system is finding fewer new paths than previous runs. This usually means:

1. **Personas are converging** — most personas share similar goals and end up on the same paths. Add personas with less common goals (e.g., a user who is searching but never applying, a user who is resetting their password, a user who is reviewing old applications).
2. **Scenarios are too narrow** — the same scenario has run many iterations in a row. Check `scenario-plan.json` in the last run root. Try forcing a different scenario via `fab orchestrate --scenario <name>`.
3. **The surface is saturated in the current personas' domain** — genuinely good news. Add personas in adjacent product areas.

### When regression_health is low

Flows that previously passed are now failing. This is the system's core value — it found something that broke.

Start here:
- Read `flow-results.json` in the latest run root for the specific failing flows
- Check git log for the timeframe between the last passing iteration and this one
- Run `fab smoke --grep <failing-flow-name>` to isolate the failure

Do not quarantine a flow just because it's failing — quarantine is for flakiness, not for real failures.

### When fixture_health is low

Seeded entities are not resolving correctly. Usually means the `AppAdapter.seed()` implementation has a bug — it's writing incomplete entity records, or the alias naming convention drifted. Check `mini-sim-export.json` and compare with what's in `lisa.db`.

### When persona_realism is low

Agents are not reaching their stated goals. Three causes:

1. **Goals reference product features that are broken** — the agent tried to do something the product can't currently do. Check if the goal maps to a broken flow.
2. **Goals are unreachable from the seed state** — the seeded state doesn't provide a path to the goal. Check if `AppAdapter.seed()` creates the prerequisites the persona needs.
3. **Simulation is deterministic and shallow** — in non-LLM mode, agents may not explore enough to find the goal path. Increase tick count or switch to `liveLlm: true`.

### When discovery_yield is low

The system is finding paths it already knew about, not new error outcomes. Healthy if `coverage_delta` is also low (the product is well-covered). Concerning if you know there are unexplored areas.

---

## Writing Adversarial Personas

Adversarial personas probe validation gaps, unauthorized routes, and rate limits. Add `adversarial: true` to any persona to activate this mode.

```yaml
schema_version: 1
id: adversarial-probe-seeker
role: seeker
display_name: Validation Probe
goals:
  - submit a job application with missing required fields
  - attempt to view a premium employer profile without a subscription
  - submit the same application twice rapidly
constraints: []
pressure:
  financial: 0.0
  urgency: 1.0
  risk_tolerance: 1.0
adversarial: true
```

Adversarial probe events are recorded with `event_kind: 'adversarial_probe'` so they're tracked separately from normal flow failures. The `adversarial` dimension in `FabricScore` surfaces the findings: how many probes ran, how many found a violation, and what the top violations were.

A "violation" is any adversarial probe that succeeded — a probe that should have been blocked but wasn't. Low `adversarial.violationsFound` is good. High `adversarial.violationsFound` means validation gaps exist.

---

## Interpreting the Score

The `FabricScore` is a six-dimension report, not a pass/fail. Each dimension tells you something different:

```
overall: 8.4

dimensions:
  persona_realism:   9.1   ← agents are reaching their goals cleanly
  coverage_delta:    6.2   ← fewer new paths found than last run; personas may be converging
  fixture_health:   10.0   ← all seeded entities resolved correctly
  discovery_yield:   7.8   ← some novel error outcomes found
  regression_health: 8.9   ← one known flow is failing; worth investigating
  flow_coverage:     8.0   ← 80% of flows passing
```

The score gate in CI is `overall >= 8.0` by default. You set this threshold — it should reflect the risk tolerance of your product, not a number someone chose arbitrarily.

If `regression_health` drops below 9.0, look at the failing flows before the score drops further. Regressions compound — one broken flow breaks flows that depend on the same state.

---

## What You Now Own

Once the system is running, your QA role has three artifacts:

**1. The persona library** (`personas/`) — YAML files describing your synthetic users. These are the most valuable artifacts in the test system. They encode your product knowledge about who uses your product and how. Keep them up to date as the product evolves and the user base changes.

**2. The scenario catalog** (`scenarios/`) — named scenarios that seed different product states (e.g., `high_volume_applications`, `employer_posting_new_job`, `seeker_offer_negotiation`). The planner selects from these based on score feedback.

**3. The score thresholds** — what `overall` threshold gates CI. What `regression_health` drop triggers an alert. These are QA policy decisions, not engineering decisions.

Everything else — the simulation, the path discovery, the flow generation, the scoring — runs automatically.

---

## The Career Angle

The shift from "QA executor" to "QA strategist" is real. The system removes the low-leverage work. What remains is:

- **Persona authorship** — knowing your users well enough to model them accurately
- **Score interpretation** — reading the six-dimension report and knowing what to act on
- **Edge case leadership** — the cases the system can't reach autonomously require a human to recognize them and write an explicit spec or adversarial persona
- **Threshold governance** — setting and maintaining CI quality gates

A senior QA engineer running this system has leverage over a product surface that would require a team of 4–6 to cover manually. The skill that scales is not script-writing. It is the ability to encode real user behavior as goals and constraints — and to reason about what the system's findings mean.

---

## Reference

| Doc | What's there |
|-----|-------------|
| [overview.md](./overview.md) | Framework model and loop phases |
| [architecture.md](./architecture.md) | Full technical architecture |
| [quickstart.md](./quickstart.md) | Wiring the framework to your app |
| [example-walkthrough.md](./example-walkthrough.md) | Full iteration end-to-end |
| [lisa-mcp.md](./lisa-mcp.md) | AI browser automation layer |
| [adapter-contract.md](./adapter-contract.md) | Adapter interface definitions |
