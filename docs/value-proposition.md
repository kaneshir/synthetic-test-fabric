# Synthetic Test Fabric — Strategic Value Proposition

## The Problem We're Solving

Modern software teams face an unavoidable tension: the product ships faster
than QA can cover it. The traditional solution is headcount — more QA engineers,
offshore teams, manual regression cycles. This works until it doesn't. Offshore
QA introduces domain knowledge gaps, communication latency, and institutional
risk. Throwing more people at a growing surface area is a losing strategy.

The real bottleneck isn't people. It's the absence of a system that learns.

---

## What Synthetic Test Fabric Is

Synthetic Test Fabric is an autonomous QA layer that runs continuously against
your product without human intervention.

It does not replace your QA engineers. It replaces the *repetitive* work —
the regression scripts, the manual seeding, the "did this break?" checks that
consume 60-80% of a QA engineer's time. It hands that work to the machine and
frees your senior QA to focus on the work only they can do: exploratory testing,
edge case reasoning, product intuition.

The system:
- Seeds realistic synthetic users with goals, constraints, and pressure
- Simulates their behaviour against your live product
- Observes what they do and where they go
- Generates Playwright browser flows from observed paths automatically
- Executes those flows and scores the results
- Feeds results back to improve the next run

Every run makes the test library better. Coverage grows without anyone writing
a test. The system gets smarter over time.

---

## The Offshore Offset

A senior QA engineer costs $120-180K/year. An offshore QA team of equivalent
throughput costs $40-60K/year but introduces:

- 3-5 day turnaround on regression cycles
- Domain knowledge that lives in email threads, not code
- Institutional risk when contracts end
- Coverage gaps in edge cases that require product intuition

Synthetic Test Fabric does not have turnaround. It runs on every merge.
It does not have domain knowledge gaps — it builds the domain model from
observed user behaviour. It does not leave when the contract ends.

**The calculation:** One senior QA engineer + Synthetic Test Fabric covers
the regression surface of a team of 4-6 offshore QA engineers, with faster
feedback and better coverage depth. The senior QA engineer becomes a force
multiplier: setting coverage strategy, reviewing findings, and handling the
1-in-20 bugs that require a human to recognize.

---

## The AI Autonomous Nature

The system runs three levels of intelligence:

**Level 1 — Simulation intelligence.** Synthetic users are not random clickers.
They have stated goals, constraints, and pressure levels. A seeker persona
with financial pressure and a 6-week runway behaves differently from one with
no urgency. Goal-driven behaviour produces realistic coverage paths.

**Level 2 — Analysis intelligence.** After each simulation run, an LLM reads
the behaviour event log and extracts novel screen paths. It generates candidate
Playwright specs from those paths automatically. A path that was never in
`flows.yaml` becomes a test on the next run.

**Level 3 — Feedback intelligence.** The scoring system identifies regressions,
novel failures, and coverage gaps. The planner recommends which scenario to
run next based on what the previous run revealed. The loop tightens over time.

---

## The Strategic Position

Most QA tooling is Gen 1: record a script, replay it. Some teams are at
Gen 2: property-based testing, contract testing, API fuzzing. Synthetic Test
Fabric is Gen 3: goal-driven autonomous agents that exercise the product the
way real users do, discover their own coverage, and self-improve.

**Timing:** Most companies are still at Gen 1. Teams that adopt Gen 3
tooling now will have a 2-3 year head start on coverage depth by the time
the rest of the market catches up.

---

## What It Takes to Onboard a New Product

The framework ships with adapter interfaces. Onboarding a new product means
implementing those interfaces — typically 3-5 days of engineering work.

The framework code itself does not change. Zero lines of framework code
were modified to support the second product consumer. That is the proof
that the adapter seam is real.

---

## Summary

| | Manual QA | Offshore QA | Synthetic Test Fabric |
|---|---|---|---|
| Regression cycle time | Days–weeks | 3–5 days | Minutes |
| Coverage growth | Linear with headcount | Linear with headcount | Autonomous |
| Domain knowledge retention | High | Low | Embedded in code |
| Senior QA leverage | 1x | 1x | 4–6x |
| Gets smarter over time | No | No | Yes |
