# Lisa — Claude Code Skills & Agents

Reference copies of the Claude Code agents, slash commands, and skills that power the
**Lisa AI QA Engineer** workflow. These files live here as documentation; they are not
loaded by Claude Code automatically from this location.

---

## Directory layout

```
docs/claude-skills/
├── README.md                          ← you are here
├── agents/
│   ├── lisa-baseline-manager.md       ← manage visual regression baselines
│   ├── lisa-runner.md                 ← run Lisa integration tests
│   └── lisa-scaffolder.md             ← scaffold Lisa in a new Flutter project
├── commands/
│   ├── lisa.md                        ← /lisa slash command (9 modes)
│   └── test-ux.md                     ← /test-ux autonomous UX tester
└── skills/
    ├── lisa-test/SKILL.md             ← auto-activating Lisa skill
    ├── ai-qa-agent/SKILL.md           ← autonomous QA brain
    ├── guided-exploration/SKILL.md    ← English → grounded YAML flows
    ├── flutter-test-generator/SKILL.md← Chrome exploration → Flutter tests
    └── lisa-qa-agent/SKILL.md         ← core Lisa identity & orchestration
```

---

## Where Claude Code looks for these files

Claude Code loads agents, commands, and skills from two locations:

| Scope | Path | Loaded when |
|-------|------|-------------|
| User (global) | `~/.claude/agents/`, `~/.claude/commands/`, `~/.claude/skills/` | Any project |
| Project (local) | `.claude/agents/`, `.claude/commands/`, `.claude/skills/` | This project only |

**Agent files** must have YAML frontmatter (`name`, `description`, `model`, `tools`).
**Skill files** must be named exactly `SKILL.md` and have YAML frontmatter (`name`, `description`, `allowed-tools`).
**Command files** are any `.md` file in the `commands/` directory; `/filename` is the command.

---

## Installation options

### Option A — Copy to user-level `~/.claude/` (recommended, available everywhere)

```bash
# From the repo root
DEST=~/.claude

# Agents
mkdir -p $DEST/agents
cp docs/claude-skills/agents/lisa-baseline-manager.md $DEST/agents/
cp docs/claude-skills/agents/lisa-runner.md           $DEST/agents/
cp docs/claude-skills/agents/lisa-scaffolder.md       $DEST/agents/

# Commands
mkdir -p $DEST/commands
cp docs/claude-skills/commands/lisa.md     $DEST/commands/
cp docs/claude-skills/commands/test-ux.md $DEST/commands/

# Skills
mkdir -p $DEST/skills/lisa-test \
         $DEST/skills/ai-qa-agent \
         $DEST/skills/guided-exploration \
         $DEST/skills/flutter-test-generator \
         $DEST/skills/lisa-qa-agent

cp docs/claude-skills/skills/lisa-test/SKILL.md              $DEST/skills/lisa-test/
cp docs/claude-skills/skills/ai-qa-agent/SKILL.md             $DEST/skills/ai-qa-agent/
cp docs/claude-skills/skills/guided-exploration/SKILL.md      $DEST/skills/guided-exploration/
cp docs/claude-skills/skills/flutter-test-generator/SKILL.md  $DEST/skills/flutter-test-generator/
cp docs/claude-skills/skills/lisa-qa-agent/SKILL.md           $DEST/skills/lisa-qa-agent/
```

### Option B — Symlink from dev_infra (if you have the repo)

Run the installer that ships with dev_infra:

```bash
~/src/dev_infra/bin/install_lisa.sh
```

This symlinks everything from dev_infra into `~/.claude/` and keeps files
up-to-date as dev_infra evolves.

### Option C — Copy to project `.claude/` (this project only)

```bash
cp -r docs/claude-skills/agents       .claude/agents
cp -r docs/claude-skills/commands     .claude/commands
cp -r docs/claude-skills/skills       .claude/skills
```

---

## MCP server requirement

The `mcp__lisa__*` tools used by most skills and the `/lisa` command require the
Lisa MCP server to be running. Add this to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "lisa": {
      "command": "dart",
      "args": ["run", "/path/to/dev_infra/bin/lisa_mcp_server.dart"],
      "env": {
        "LISA_DB_ROOT": "/path/to/your/project/integration_test/memory"
      }
    }
  }
}
```

Verify the server is responding after installation:
```
/lisa status
```

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

---

## BlueSkil-specific content

Several files reference BlueSkil credentials, URLs, and emulator scripts.
When adapting for another project:

- Replace `http://localhost:5002` with your dev server URL
- Replace `test-seeker@blueskil.test` / `test-employer@blueskil.test` with your test credentials
- Replace `./deploy_dev_emulator.sh` with your own emulator start script
- Update role names (`seeker`, `employer`, etc.) to match your app

The skill frontmatter `BASE_URL` variable is intentionally parameterized — set it in
your environment before running tests.
