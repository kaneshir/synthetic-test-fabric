# Comparison: Synthetic Test Fabric vs. other QA tools

This document is for teams evaluating STF alongside alternatives. The framing here is honest: every tool has a domain where it wins. The goal is to help you understand where STF fits and where it doesn't.

---

## The three generations of QA tooling

Before comparing specific tools, it helps to understand the generation model:

**Gen 1 — Script and replay.** A human tests the app manually, records what they did, and the tool replays it. The assumption is that the human already knows what to test. Playwright, Cypress, Selenium at their most basic usage level.

**Gen 2 — Smarter assertions.** Property-based testing, contract testing, API fuzzing. Still requires a human to define what properties to check, what contracts exist, what inputs to fuzz. Better coverage of known-unknown cases.

**Gen 3 — Autonomous coverage.** Synthetic users navigate the product, discover their own paths, generate their own tests, score the results, and feed findings back to improve the next run. No human decides what to test.

Synthetic Test Fabric is Gen 3. Most of the tools below are Gen 1 or Gen 2. This is not a knock on Gen 1 and Gen 2 — they are the foundation. It is context.

---

## Playwright alone

**Playwright** is the world's best browser automation tool. STF uses it internally for the TEST phase. These are not competitors.

| | Playwright alone | Synthetic Test Fabric |
|---|---|---|
| Writing specs | You write them | Generated from observed behavior |
| Maintaining specs | Manual update as UI changes | Regenerated from live DOM via lisa-mcp |
| Test state | You seed it manually | AppAdapter seeds it automatically |
| Coverage growth | Someone has to add new specs | Grows every iteration automatically |
| Regression detection | Tests you wrote get checked | Tests the system generated get checked |
| Entry cost | Low — write specs immediately | Medium — implement adapters first |

**When to use Playwright alone:**
- Small surface area (< 20 flows), not changing often
- Team has strong TypeScript skills and enjoys writing tests
- Product is well-understood enough that a human can enumerate all important paths

**When STF adds value over Playwright alone:**
- Surface is growing faster than you can write specs
- Regression maintenance consumes significant QA time
- You want test coverage of paths users actually take, not paths you anticipated

STF does not replace your Playwright setup. It runs Playwright — it just also generates the specs and seeds the state.

---

## Cypress

**Cypress** is a mature test runner with a great developer experience for web apps. The comparison with STF is similar to Playwright.

The key difference: Cypress is test-runner-first. The entire ecosystem assumes a human writes and maintains specs. There is no path in Cypress to generated, self-improving tests. The tool is excellent at its design intent.

STF uses Playwright (not Cypress) for the TEST phase, but the architectural point is the same: test runners are executors. STF is an autonomous loop that happens to use an executor inside it.

**Use Cypress if:** You want the best developer experience for writing and debugging web tests manually.

**Use STF alongside Cypress if:** You want autonomous coverage growth on top of your existing Cypress suite. (STF's BrowserAdapter can be implemented against any runner — Cypress support is technically feasible if the BrowserAdapter generates Cypress syntax instead of Playwright.)

---

## Mabl

**Mabl** is a cloud-based AI testing platform. It records user flows, uses ML to self-heal selectors when the UI changes, and can suggest tests.

| | Mabl | Synthetic Test Fabric |
|---|---|---|
| Business model | SaaS subscription | Open source npm package |
| Self-healing | Yes — ML-based selector repair | Yes — lisa-mcp regenerates from live DOM |
| Test generation | Assisted recording | Autonomous from simulation behavior |
| Simulation | No | Yes — goal-driven synthetic users |
| Persona pressure model | No | Yes — urgency, financial, risk tolerance |
| Feedback loop | Limited | Full — score drives next iteration |
| Data sovereignty | Cloud (Mabl's servers) | Fully local — lisa.db, run root on your infra |
| Cost | Per-seat or usage pricing | Free (OSS) + your cloud compute |
| Onboarding | Low — recording-first | Medium — adapter implementation |

**When Mabl wins:**
- Team doesn't have TypeScript skills to implement adapters
- You want a no-code / low-code testing experience
- Fast time-to-first-test is the priority

**When STF wins:**
- Data sovereignty matters (financial services, healthcare, etc.)
- You want goal-driven simulation, not just recording playback
- You want the feedback loop and the self-improvement signal
- You want to own the infrastructure and not be vendor-locked

---

## TestRigor

**TestRigor** uses plain-English test instructions and AI to execute them without selectors. The value prop is non-technical stakeholders writing tests.

| | TestRigor | Synthetic Test Fabric |
|---|---|---|
| Test authoring | Plain English | Persona YAML → AI simulation |
| Target user | QA managers, business analysts | Sr QA engineers, developers |
| Simulation | No | Yes |
| Score/feedback loop | No | Yes |
| Persona model | No | Yes — pressure, goals, constraints |
| Self-improvement | No | Yes |
| Open source | No | Yes |

**When TestRigor wins:**
- Non-technical stakeholders need to write or review tests
- Plain English instructions are more maintainable than code in your team

**When STF wins:**
- You need simulation-driven coverage, not instruction-driven execution
- You want a feedback loop and improvement over time
- The QA team is technical and can implement adapters

---

## Testim (now Tricentis)

**Testim** uses AI to create and maintain end-to-end tests. It records, suggests, and self-heals. Similar positioning to Mabl.

The key distinctions from STF are the same as Mabl: Testim is cloud SaaS, recording-first, and doesn't have a simulation layer or feedback loop.

---

## Traditional manual QA

The comparison most relevant to the VP audience.

| | Manual QA | Synthetic Test Fabric |
|---|---|---|
| Regression cycle time | Days to weeks | Minutes |
| Coverage growth | Linear with headcount | Autonomous |
| Domain knowledge retention | In people's heads | In version-controlled YAML |
| Cost scaling | Linear | Sub-linear |
| Institutional risk | High (turnover) | Low (code doesn't quit) |
| Gets smarter over time | No | Yes |
| Can detect adversarial inputs | Only if someone thought to test them | Yes — adversarial personas |

STF does not replace the judgment of a senior QA engineer — it replaces the repetitive execution work. See [for-qa-engineers.md](./for-qa-engineers.md) for the full picture of what changes and what doesn't.

---

## Offshore QA teams

The offshore QA comparison is covered in depth in [executive-brief.md](./executive-brief.md). Short version:

An offshore QA team provides throughput but introduces domain knowledge gaps, turnaround latency (3-5 day regression cycles), and institutional risk when contracts end. STF provides the same throughput — actually more — with no latency, no domain knowledge gap (the knowledge is in the persona files), and no institutional risk.

The ROI case: 1 Sr QA engineer + STF covers the regression surface of 4-6 offshore QA engineers. The senior QA's role shifts from execution to strategy: writing personas, reviewing findings, handling edge cases the system can't reach.

---

## STF's actual weak spots

No honest comparison document leaves this out.

**STF requires adapter implementation work upfront.** 3-5 days for a senior engineer. Mabl and TestRigor have you running tests in hours. If fast time-to-first-test is the critical requirement, STF loses.

**STF requires a running product environment.** The simulation runs against a live (test) instance of your app. If your app is hard to stand up locally or in CI, the adapter implementation cost goes up significantly.

**STF's LLM inference quality depends on your LLM.** In liveLlm mode, the quality of persona behavior and path discovery depends on the model. Gemini 2.0 Flash produces much better results than a small local Ollama model. For teams without a usable LLM, deterministic mode works but produces less realistic behavior.

**Windows is not yet supported for lisa-mcp.** The Lisa MCP server binary ships for macOS and Linux. CI runs on Linux work fine; development on Windows requires WSL.

**The test corpus starts empty.** On the first run there are no flows in `flows.yaml`. The regression suite is empty. Early iterations produce low `flow_coverage` and `regression_health` scores because there's nothing to regress against yet. This is expected — the library builds over the first 3-5 iterations.
