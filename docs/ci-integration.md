# CI Integration

Synthetic Test Fabric is designed to run in CI. This document covers the four most common integration patterns, with working GitHub Actions examples for each.

---

## The CI model

The framework maps cleanly onto three CI use cases:

| Use case | Command | When to run |
|----------|---------|-------------|
| **Smoke check** | `fab smoke` | Every PR, fast — 1 iteration, no LLM |
| **Regression gate** | `fab orchestrate --iterations 1` | Every merge to develop |
| **Score gate** | `fab check --threshold 8.0` | Block deploys below threshold |
| **Nightly loop** | `fab orchestrate --iterations 5` | Scheduled, overnight — full self-improvement run |

All four can be combined. A common setup: smoke on every PR, regression gate on merge, score gate blocking staging deploys, nightly loop for continuous improvement.

---

## 1. Smoke check on every PR

Fastest feedback. One iteration, deterministic mode, no LLM calls. Catches adapter breakage and critical regressions in under 2 minutes.

```yaml
# .github/workflows/fabric-smoke.yml
name: Fabric smoke

on:
  pull_request:
    branches: [develop, main]

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20.x
          cache: npm

      - run: npm ci

      - name: Install Playwright
        run: npx playwright install chromium --with-deps

      - name: Start app
        run: npm run start:test &
        env:
          NODE_ENV: test

      - name: Wait for app
        run: npx wait-on http://localhost:3000 --timeout 30000

      - name: Run smoke
        run: npx fab smoke --no-llm
        env:
          FABRIC_RUN_ROOT: /tmp/fabric-smoke

      - name: Upload run artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: fabric-smoke-${{ github.run_id }}
          path: /tmp/fabric-smoke/
          retention-days: 3
```

`fab smoke` is `fab orchestrate --iterations 1`. The `--no-llm` flag forces deterministic simulation — no Ollama or Gemini required.

---

## 2. Regression gate on merge

Runs after merge to develop. One full iteration with your current LLM configuration. Fails the workflow if any previously passing flow is now failing.

```yaml
# .github/workflows/fabric-regression.yml
name: Fabric regression

on:
  push:
    branches: [develop]

jobs:
  regression:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20.x
          cache: npm

      - run: npm ci

      - name: Install Playwright
        run: npx playwright install chromium --with-deps

      - name: Start app
        run: npm run start:test &
        env:
          NODE_ENV: test
          DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}

      - name: Wait for app
        run: npx wait-on http://localhost:3000 --timeout 60000

      - name: Run fabric loop
        run: npx fab orchestrate --iterations 1
        env:
          # GENERATE_FLOWS provider — set one. Claude CLI is auto-detected if installed.
          # ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          STF_DISABLE_CLAUDE_CLI: "1"   # prevent local claude install from taking over
          FABRIC_RUN_ROOT: /tmp/fabric-regression
          FABRIC_SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK_QA }}

      - name: Score gate
        run: npx fab check --root /tmp/fabric-regression/latest --threshold 7.5

      - name: Upload HTML report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: fabric-report-${{ github.run_id }}
          path: /tmp/fabric-regression/latest/fabric-report.html
          retention-days: 14

      - name: Upload full run root
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: fabric-run-root-${{ github.run_id }}
          path: /tmp/fabric-regression/
          retention-days: 7
```

The HTML report is uploaded as an artifact on every run. The full run root is only uploaded on failure — it's large, and you only need it when debugging.

---

## 3. Score gate as a required check

`fab check` exits 0 if the score meets the threshold, exits 1 if it doesn't. Wire it as a required status check in your branch protection rules to block deploys when score drops.

```yaml
- name: Score gate (staging deploy requires ≥ 8.0)
  run: npx fab check --root ${{ env.FABRIC_RUN_ROOT }}/latest --threshold 8.0
```

The command outputs a full dimension breakdown on failure:

```
✗ Score gate failed
  overall: 6.8  (threshold: 8.0)

  persona_realism:   9.1  ✓
  coverage_delta:    8.5  ✓
  fixture_health:   10.0  ✓
  discovery_yield:   7.2
  regression_health: 3.0  ✗  (seeker-apply-flow, employer-view-apps regressed)
  flow_coverage:     5.5  ✗  (4/8 flows passing)
```

This tells you exactly what broke, not just "the score failed."

---

## 4. Nightly self-improvement loop

The loop's self-improvement signal compounds over iterations. A nightly 5-iteration run accumulates coverage, discovers new paths, and steers the planner toward gaps — automatically.

```yaml
# .github/workflows/fabric-nightly.yml
name: Fabric nightly

on:
  schedule:
    - cron: '0 6 * * *'   # 2 AM PT / 6 AM UTC
  workflow_dispatch:        # allow manual trigger

jobs:
  nightly:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20.x
          cache: npm

      - run: npm ci

      - name: Install Playwright
        run: npx playwright install chromium --with-deps

      - name: Start app
        run: npm run start:test &
        env:
          NODE_ENV: test
          DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}

      - name: Wait for app
        run: npx wait-on http://localhost:3000 --timeout 60000

      - name: Run 5-iteration loop
        run: npx fab orchestrate --iterations 5 --ticks 10
        env:
          # GENERATE_FLOWS provider — set one. Claude CLI is auto-detected if installed.
          # ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          STF_DISABLE_CLAUDE_CLI: "1"   # prevent local claude install from taking over
          FABRIC_RUN_ROOT: /tmp/fabric-nightly
          FABRIC_SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK_QA }}

      - name: Upload HTML trend report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: fabric-nightly-${{ github.run_id }}
          path: /tmp/fabric-nightly/latest/fabric-report.html
          retention-days: 30
```

The HTML report includes a Chart.js trend line across iterations — after a few nightly runs you'll see the score trajectory over time.

---

## Slack notifications

The `SlackReporter` is wired via environment variable:

```yaml
env:
  FABRIC_SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK_QA }}
```

Or in `fabric.config.ts`:

```typescript
import { SlackReporter } from 'synthetic-test-fabric';

export default {
  adapters: {
    // ...
    reporters: [
      new SlackReporter({
        webhookUrl: process.env.FABRIC_SLACK_WEBHOOK!,
        channel: '#qa-alerts',
        threshold: 7.5,
        productName: 'MyApp',
      }),
    ],
  },
} satisfies FabricConfig;
```

The Slack message includes overall score, dimension breakdown, regression list, and a direct link to the CI run. Dimensions below threshold are highlighted.

---

## Publishing the HTML report to GitHub Pages

If you want the trend report browsable as a URL rather than a download:

```yaml
- name: Deploy report to GitHub Pages
  uses: peaceiris/actions-gh-pages@v3
  if: github.ref == 'refs/heads/develop'
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    publish_dir: /tmp/fabric-nightly/latest/
    destination_dir: reports/${{ github.run_number }}
```

---

## Environment variables reference

| Variable | Used by | Description |
|----------|---------|-------------|
| `FABRIC_RUN_ROOT` | orchestrator | Base directory for run roots. Defaults to `./fabric-runs`. |
| `LISA_DB_ROOT` | all phases | Set automatically per-iteration. Do not override. |
| `LISA_MEMORY_DIR` | all phases | Set automatically per-iteration. Do not override. |
| `LISA_SIMULATION_ID` | recorder | Set automatically per-iteration. Do not override. |
| `FABRIC_SLACK_WEBHOOK` | SlackReporter | Slack incoming webhook URL |
| `ANTHROPIC_API_KEY` | GENERATE_FLOWS | Enables `ClaudeSdkProvider` (step 2 in auto-detection) |
| `OPENAI_API_KEY` | GENERATE_FLOWS | Enables `OpenAIProvider` (step 3 in auto-detection) |
| `GEMINI_API_KEY` | GENERATE_FLOWS | Enables `GeminiProvider` (step 4 in auto-detection) |
| `OLLAMA_HOST` | GENERATE_FLOWS | Ollama base URL for `OllamaProvider` (default: `http://localhost:11434`) |
| `STF_DISABLE_CLAUDE_CLI` | GENERATE_FLOWS | Set to `1` to skip Claude CLI auto-detection — use in CI where `claude` is installed but you want an API-key provider |

---

## Caching Playwright browsers

Playwright browser downloads are slow. Cache them across CI runs:

```yaml
- name: Cache Playwright browsers
  uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: playwright-${{ runner.os }}-

- name: Install Playwright browsers
  run: npx playwright install chromium --with-deps
```

---

## Typical CI timeline

| Workflow | Duration | When |
|----------|----------|------|
| Smoke (1 iter, no LLM) | 90–120s | Every PR |
| Regression gate (1 iter, LLM) | 8–15min | Every merge |
| Nightly loop (5 iter, LLM) | 30–60min | 2 AM PT |
