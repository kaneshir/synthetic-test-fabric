# Persona YAML Reference

Personas are the intelligence behind your synthetic users. They are not test scripts — they are descriptions of real humans: what they want, what's holding them back, how much time pressure they're under. The simulation agents read these descriptions and behave accordingly.

A good persona library is the most valuable artifact in your test system. It encodes your domain knowledge about who uses your product and why. The more accurately it reflects real user diversity, the more realistic and surprising the coverage paths become.

---

## Anatomy of a persona

```yaml
schema_version: 1                      # always 1
id: maria-chen                         # lowercase slug, unique in your personas/ directory
role: seeker                           # seeker | employer | employee
display_name: Maria Chen               # human-readable name (shown in logs and reports)
backstory: |                           # optional — gives the LLM agent rich context
  Electrician apprentice, 18 months in.
  Finishing her apprenticeship in 6 weeks.
  Rent is overdue. She needs this job.
trade: electrician                     # optional — product-specific trade/category
goals:
  - find a journeyman electrician role within 30 miles
  - apply before her apprenticeship certificate expires
  - understand what certifications the employer requires
constraints:
  - cannot relocate
  - does not have a premium subscription
  - will not apply to jobs with no posted wage range
pressure:
  financial: 0.85                      # 0–1: 1.0 = desperate, 0.0 = no financial pressure
  urgency: 0.9                         # 0–1: 1.0 = acts immediately, 0.0 = no deadline
  risk_tolerance: 0.2                  # 0–1: 1.0 = tries everything, 0.0 = only safe paths
```

---

## Required fields

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | `1` | Must be `1` |
| `id` | slug | Lowercase, hyphenated. Used in logs and as a file reference. Must be unique. |
| `role` | enum | `seeker`, `employer`, or `employee` |
| `display_name` | string | Any non-blank string |
| `goals` | string[] | At least one goal. These are the primary driver of agent behavior. |
| `pressure.financial` | 0–1 | How much financial stress the persona is under |
| `pressure.urgency` | 0–1 | How time-constrained the persona is |

---

## Optional fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `backstory` | string | — | Rich context for the LLM agent. The more specific, the more realistic the behavior. |
| `trade` | string | — | Job category or trade (product-specific). Directs job search behavior. |
| `constraints` | string[] | `[]` | Behaviors the persona will not engage in. Shapes path realism. |
| `pressure.risk_tolerance` | 0–1 | `0.5` | High = explores, tries non-obvious paths. Low = sticks to the happy path. |
| `adversarial` | boolean | `false` | See [Adversarial personas](#adversarial-personas) below. |
| `company_size` | enum | — | `small`, `medium`, `large`. Employer-specific — shapes hiring behavior. |
| `hiring_urgency` | 0–1 | — | Employer-specific — how urgently they're trying to fill the role. |

---

## How pressure shapes behavior

Pressure is not a fuzzing knob — it is a behavioral model. Here is how the simulation interprets each axis:

### `financial` (0–1)

**Low (< 0.4):** The persona is not worried about money. They browse, compare options, and may not complete flows they started. They leave reviews. They check their own profile after applying.

**Medium (0.4–0.7):** The persona completes the flows they start but will abandon if something is confusing. They read the wage range before clicking apply.

**High (> 0.7):** The persona moves fast. They skip optional fields, do not read help text, and apply to every relevant job immediately. They may try to submit incomplete forms.

### `urgency` (0–1)

**Low (< 0.4):** The persona has no deadline. They explore secondary flows — notifications, settings, saved searches, profile completeness prompts.

**High (> 0.7):** The persona ignores everything except their goal. They do not visit profile pages, do not read emails, do not click ancillary CTAs.

### `risk_tolerance` (0–1)

**Low (< 0.4):** The persona only takes well-lit paths. They click the obvious primary CTA. They do not try unusual sequences. They are your "average user" coverage.

**High (> 0.7):** The persona experiments. They try the back button in the middle of a form. They double-click submit. They navigate to a URL directly instead of through the nav. They provide coverage of paths that users stumble into, not just paths the product intends.

---

## Pressure combinations that produce real coverage value

Some combinations are particularly valuable for finding real bugs:

**High financial + High urgency + Low risk tolerance**
> The "desperate but careful" seeker. Moves fast, stays on the happy path, completes every form. Tests the primary critical path at speed. Finds issues with form submission rate limiting, double-submit bugs, and fast transitions.

```yaml
pressure:
  financial: 0.9
  urgency: 0.85
  risk_tolerance: 0.15
```

**Low financial + Low urgency + High risk tolerance**
> The "explorer" persona. Browses everywhere, follows every link, tries unusual sequences. Finds dead ends, confusing navigation, and flows that were never designed for but are reachable.

```yaml
pressure:
  financial: 0.1
  urgency: 0.1
  risk_tolerance: 0.9
```

**Medium financial + High urgency + High risk tolerance**
> The "impatient experimenter." Tries shortcuts. Pastes data from elsewhere. Skips steps and comes back. Tests error recovery and multi-step form resilience.

```yaml
pressure:
  financial: 0.5
  urgency: 0.8
  risk_tolerance: 0.85
```

---

## Employer personas

Employer personas have two additional fields:

```yaml
schema_version: 1
id: testco-hiring-manager
role: employer
display_name: TestCo Hiring Manager
goals:
  - post a journeyman electrician job
  - review applications received this week
  - invite at least one candidate for an interview
constraints:
  - company budget does not allow premium job placement
pressure:
  financial: 0.4
  urgency: 0.7
  risk_tolerance: 0.5
company_size: small                  # small | medium | large
hiring_urgency: 0.75                 # 0–1, independent of urgency pressure
```

`company_size` and `hiring_urgency` are available to your `SimulationAdapter` for product-specific behavior — for example, small company employers might only use basic job posting while large company employers use bulk posting or ATS integrations.

---

## Adversarial personas

Adversarial personas actively probe your product's defenses. They submit invalid data, attempt unauthorized routes, and hammer rate limits. Every probe is recorded with `event_kind: 'adversarial_probe'` and tracked separately in the `FabricScore.adversarial` dimension.

```yaml
schema_version: 1
id: adversarial-unauthorized-access
role: seeker
display_name: Adversarial Access Probe
backstory: |
  A user who is probing the platform for access control gaps.
  Not necessarily malicious — could be a curious power user.
goals:
  - access employer-only pages as a seeker
  - view another user's private application details
  - submit a job application with an empty required field
  - trigger the rate limiter on search
constraints: []
pressure:
  financial: 0.0
  urgency: 1.0
  risk_tolerance: 1.0
adversarial: true
```

**What adversarial mode does:**
- The simulation agent deliberately attempts actions it expects to be blocked
- It tries routes that require a different role than the current user's
- It submits forms with boundary-violating values (empty required fields, extremely long inputs, special characters)
- It makes the same request rapidly to test rate limiting

**What "violation found" means:**
A violation is an adversarial probe that succeeded when it should have failed — a form that accepted empty required fields, a page that rendered for the wrong role, an API that responded 200 instead of 403.

**Adversarial summary in the score:**
```json
"adversarial": {
  "probesAttempted": 14,
  "violationsFound": 2,
  "topViolations": [
    "Empty 'trade' field accepted on job application submission",
    "Seeker user accessed /employer/analytics/overview without 403"
  ]
}
```

Zero violations is the goal. Any violation is worth reviewing.

---

## Organizing your persona library

Recommended structure:

```
personas/
  seekers/
    maria-chen.yaml          ← high urgency, electrician
    james-okafor.yaml        ← low urgency, exploring options
    diana-reyes.yaml         ← low financial, high risk tolerance (explorer)
  employers/
    testco-hiring.yaml       ← small company, moderate urgency
    megacorp-recruiter.yaml  ← large company, low urgency, high volume
  adversarial/
    access-probe.yaml        ← unauthorized route probing
    validation-probe.yaml    ← form validation gap probing
```

A healthy starting set: 3–4 seeker personas with diverse pressure profiles, 2 employer personas (small + large company), and 1–2 adversarial personas. The system picks which personas to run each iteration based on the scenario selection — you don't need to run all of them every time.

---

## Validating personas

`parsePersonaYAML(raw)` from `synthetic-test-fabric` validates a persona against the Zod schema at import time. If your `seed()` implementation loads persona files, call this function and surface validation errors early:

```typescript
import { parsePersonaYAML } from 'synthetic-test-fabric';
import yaml from 'js-yaml';
import fs from 'fs';

const raw = yaml.load(fs.readFileSync('personas/seekers/maria-chen.yaml', 'utf8'));
const persona = parsePersonaYAML(raw); // throws with a clear message if schema is wrong
```

Common validation errors:
- `id` is not a valid slug (must be lowercase, hyphenated, no spaces)
- `pressure.financial` is outside 0–1
- `goals` array is empty
- `schema_version` is missing or not `1`

---

## The business case for investing in personas

Personas are cheap to write and compound in value over time. A persona file takes 10–15 minutes to write. Once it's in the library, it runs on every iteration — generating coverage paths, finding regressions, and surfacing behavior that hand-written test scripts would never reach.

The personas that find the most interesting bugs are usually the ones that describe the least "average" users: the one with high urgency and low risk tolerance who skips every optional step, the one with high risk tolerance who tries sequences no one designed for, the adversarial probe that submits garbage data.

Write those personas. The system will surprise you.
