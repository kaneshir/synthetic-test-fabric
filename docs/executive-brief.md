# Executive Brief — Synthetic Test Fabric

**Audience:** VPs of Engineering, CTOs, Engineering Directors, QA Managers

---

## The short version

One senior QA engineer running Synthetic Test Fabric covers the regression surface of a team of 4–6 offshore engineers — with faster feedback, no knowledge drain, and a test library that grows automatically. You are not choosing between people and automation. You are choosing whether your QA investment compounds over time or resets every quarter.

---

## The Offshore Transcendence Problem

Most engineering organizations follow a predictable arc:

1. One QA engineer handles regression manually.
2. The product grows. Regression takes a week. They hire two more.
3. Cost pressure arrives. An offshore QA team of 6 replaces them at half the price.
4. Knowledge drains out of the building. Coverage gaps appear in product areas the offshore team doesn't understand deeply. Regressions slip through. Domain expertise lives in email threads instead of test code.
5. Someone proposes rebuilding the test suite.

This arc is not a people problem. It is a systems problem. The underlying issue is that test coverage has always been a function of human labor hours. **Synthetic Test Fabric breaks that constraint.**

---

## What Changes

Synthetic Test Fabric is an autonomous QA layer. It uses synthetic users with explicit goals, behaviours, and urgency levels to continuously exercise your product. Their observed paths become browser flows. Those flows are scored. Findings steer the next run.

No human decides what to test. No human writes regression scripts. The test library grows automatically.

The result:

| | Manual QA | Offshore QA | Synthetic Test Fabric |
|---|---|---|---|
| Regression cycle time | Days–weeks | 3–5 days | Minutes |
| Coverage growth | Linear with headcount | Linear with headcount | Autonomous |
| Domain knowledge retention | In people | Fragile | Embedded in code |
| Gets smarter over time | No | No | Yes |
| Runs on every merge | Rarely | No | Yes |
| Senior QA leverage | 1× | 1× | 4–6× |

---

## The Offshore Transcendence Calculation

A team of 6 offshore QA engineers running 3-day regression cycles costs roughly $40-60K/year and takes 72 hours to answer "did anything break?"

One senior QA engineer + Synthetic Test Fabric:
- Answers "did anything break?" on every merge
- Runs regression in minutes, not days
- Costs comparable or less than the offshore team, depending on market
- Retains product knowledge in version-controlled code
- Generates new test coverage every run without additional labor

The senior QA engineer is not replaced — they are made dramatically more effective. Their job shifts from writing regression scripts to two things the system cannot do:

1. **Encoding domain expertise as personas** — defining what a realistic user looks like, what pressure they're under, what goals they have
2. **Reasoning about findings** — the 1-in-20 failure that requires product intuition to interpret

Everything else the system handles.

---

## The Risk Profile

**Offshore QA institutional risk:** When an offshore contract ends or the team turns over, the regression knowledge leaves with them. Scripts written for the wrong version of the product are worse than no scripts — they pass against stale expectations.

**STF institutional risk profile:**
- Domain knowledge lives in persona YAML files — committed to version control
- Regression logic lives in generated Playwright specs — committed to version control
- The system is not dependent on any individual

When a team member leaves, the system does not degrade. The test library persists. The next engineer inherits a working, growing test suite on day one.

---

## The AI Intelligence Stack

The system runs three levels of intelligence that compound on each other:

**Level 1 — Goal-driven simulation.** Synthetic users are not random clickers. They have stated goals and constraints. A persona with financial pressure and a short deadline behaves differently from one with no urgency. This produces realistic coverage paths rather than noise.

**Level 2 — Path discovery.** After each simulation, an analysis step extracts novel screen paths the system hasn't tested before. These become new Playwright specs on the next run. Coverage grows without anyone deciding what to add.

**Level 3 — Feedback steering.** The scoring system identifies regressions, coverage gaps, and personas that are converging too narrowly. A planner uses these findings to steer the next iteration toward the highest-value unexplored areas.

The system gets better with runtime. An organization that starts STF now will have materially better coverage depth in 12 months than one that starts in 12 months — not because of any product change, but because the test library compounds.

---

## The Strategic Window

Most companies are still at Gen 1 QA tooling: record a script, replay it. Some are at Gen 2: property-based testing, contract testing, API fuzzing. Synthetic Test Fabric is Gen 3: autonomous agents that exercise the product the way real users do, discover their own coverage, and self-improve.

The teams that adopt Gen 3 tooling now build a 2-3 year head start on coverage depth. Test libraries don't transfer easily — they are accumulated through runtime. Starting later means starting from scratch.

---

## Advanced Capabilities

Beyond regression coverage, the system provides capabilities that are operationally expensive to replicate with humans:

**Adversarial probing.** Personas marked `adversarial: true` actively probe validation gaps, submit invalid data, and attempt unauthorized routes. Security-sensitive edge cases get tested on every run.

**Flakiness quarantine.** The system tracks per-flow failure rates across iterations. Flows that fail intermittently are automatically quarantined and their quarantine status surfaced in the score. Flaky tests don't block the pipeline — they're tracked separately.

**Visual regression.** Screenshot comparisons using pixelmatch. Baselines are committed. Visual regressions surface in the HTML report.

**CI score gate.** `fab check --threshold 8.0` exits non-zero if the score falls below threshold. The score gate is a single number that summarizes product health — it can be wired into any CI pipeline in 5 minutes.

---

## What Onboarding Costs

The framework ships with 8 adapter interfaces. Wiring it to a new product means implementing those interfaces. The framework code does not change.

**Typical onboarding timeline:**
- Day 1: Install, run the demo, understand the adapter seam
- Days 2–3: Implement AppAdapter (seeding) and SimulationAdapter (ticks)
- Day 4: Wire ScoringAdapter and FeedbackAdapter
- Day 5: Wire BrowserAdapter (Playwright), run first full loop

A senior engineer with TypeScript and Playwright experience can have a working loop in one week. The second week is calibration — tuning persona pressure, adding scenarios, adjusting score thresholds.

After that, the system runs continuously and the investment compounds.

---

## Decision Criteria

STF is the right investment when:

- Your regression surface is growing faster than QA headcount can cover it
- You are considering or already running an offshore QA team
- Your QA engineers spend more than 50% of their time on repetitive regression maintenance
- You need QA feedback on every merge, not every sprint
- You have a senior QA engineer or engineer willing to own the persona library and score interpretation

It is not the right fit when:

- Your product surface is very small (< 10 meaningful flows)
- You have no existing QA discipline to build on — the system amplifies QA expertise, it does not replace it
- You need QA validation of physical hardware or embedded systems

---

## Summary

Synthetic Test Fabric converts your senior QA engineer into a 4–6× force multiplier by removing the repetitive work that consumes most QA time. The test library grows automatically. Coverage is a function of runtime, not headcount. Domain knowledge lives in version-controlled code, not in contractors' heads.

The offshore transcendence is not a cost reduction play — it is a quality improvement play. You get better coverage, faster feedback, and no institutional risk, at lower cost than the alternative.
