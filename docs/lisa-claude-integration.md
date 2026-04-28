# Lisa — Claude Code Integration

Reference documentation for the Lisa AI QA Engineer Claude Code tooling.
The canonical files live in [`docs/claude-skills/`](./claude-skills/README.md).

---

## What's included

| Type | Files | Purpose |
|------|-------|---------|
| **Agents** | `lisa-runner`, `lisa-scaffolder`, `lisa-baseline-manager` | Run tests, scaffold projects, manage baselines |
| **Commands** | `/lisa`, `/test-ux` | 9-mode Lisa command + autonomous UX tester |
| **Skills** | `lisa-test`, `ai-qa-agent`, `guided-exploration`, `flutter-test-generator`, `lisa-qa-agent` | Auto-activating skill triggers |

Full file listing: [`docs/claude-skills/`](./claude-skills/)

---

## Quick install

Copy to `~/.claude/` so the tools are available in every project:

```bash
DEST=~/.claude
mkdir -p $DEST/agents $DEST/commands \
  $DEST/skills/lisa-test $DEST/skills/ai-qa-agent \
  $DEST/skills/guided-exploration $DEST/skills/flutter-test-generator \
  $DEST/skills/lisa-qa-agent

cp docs/claude-skills/agents/*.md        $DEST/agents/
cp docs/claude-skills/commands/*.md      $DEST/commands/
cp docs/claude-skills/skills/lisa-test/SKILL.md              $DEST/skills/lisa-test/
cp docs/claude-skills/skills/ai-qa-agent/SKILL.md             $DEST/skills/ai-qa-agent/
cp docs/claude-skills/skills/guided-exploration/SKILL.md      $DEST/skills/guided-exploration/
cp docs/claude-skills/skills/flutter-test-generator/SKILL.md  $DEST/skills/flutter-test-generator/
cp docs/claude-skills/skills/lisa-qa-agent/SKILL.md           $DEST/skills/lisa-qa-agent/
```

Full options (symlink from dev_infra, project-local copy) and MCP server setup:
[`docs/claude-skills/README.md`](./claude-skills/README.md)

---

## Slash commands

| Command | Purpose |
|---------|---------|
| `/lisa` | Show help + run native/web/api/heal/seed/db modes |
| `/lisa setup <project>` | Scaffold Lisa in a Flutter project |
| `/lisa web <role>` | Chrome browser automation via MCP |
| `/lisa heal` | Auto-classify and fix failing tests |
| `/test-ux` | Autonomous 2-hour UX exploration session |
| `/test-ux preflight` | Infrastructure check only |

---

## Auto-activating skill triggers

| Phrase | Skill activated |
|--------|----------------|
| "run lisa", "lisa seeker" | `lisa-test` — native Flutter tests |
| "test with lisa in chrome", "lisa web" | `lisa-test` — Chrome automation |
| "record test", "watch me test" | `lisa-test` — record & generate |
| "heal tests", "fix failing tests" | `lisa-test` — self-healing |
| "test the app", "explore [screen]" | `ai-qa-agent` — autonomous QA |
| "explore [flow]", "create flow for..." | `guided-exploration` — flow discovery |
| "generate flutter test from exploration" | `flutter-test-generator` — test codegen |

---

## Agents

Invoke by saying `"use <agent-name>"`:

| Agent | Purpose |
|-------|---------|
| `lisa-runner` | Run Lisa tests on simulator/emulator/device |
| `lisa-scaffolder` | Set up Lisa in a new Flutter project |
| `lisa-baseline-manager` | Review and approve visual regression baselines |

---

## Keeping in sync with dev_infra

These files are sourced from `kaneshir/dev-infra`. To pull updates:

```bash
# Pull individual files
gh api "repos/kaneshir/dev-infra/contents/.claude/commands/lisa.md" \
  --jq '.content' | base64 -d > docs/claude-skills/commands/lisa.md

# Or re-run the dev_infra installer (preferred)
~/src/dev_infra/bin/install_lisa.sh
```
