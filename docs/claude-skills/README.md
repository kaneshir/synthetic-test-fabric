# Claude Code Skills & Agents — STF + Lisa

Reference copies of the Claude Code agents, slash commands, and skills that power the
**Synthetic Test Fabric** (`stf`) and **Lisa AI QA Engineer** (`lisa`) workflows. These
files live here as documentation; they are not loaded by Claude Code automatically
from this location — see Installation below.

---

## Directory layout

```
docs/claude-skills/
├── README.md                          ← you are here
├── agents/
│   ├── stf-runner.md                  ← run/inspect/explain STF runs (added in #25)
│   ├── lisa-baseline-manager.md       ← manage visual regression baselines
│   ├── lisa-runner.md                 ← run Lisa integration tests
│   └── lisa-scaffolder.md             ← scaffold Lisa in a new Flutter project
├── commands/
│   ├── lisa.md                        ← /lisa slash command (9 modes)
│   └── test-ux.md                     ← /test-ux autonomous UX tester
└── skills/
    ├── stf/SKILL.md                   ← drive `fab` / `fab-mcp` (added in #25)
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
cp docs/claude-skills/agents/stf-runner.md            $DEST/agents/
cp docs/claude-skills/agents/lisa-baseline-manager.md $DEST/agents/
cp docs/claude-skills/agents/lisa-runner.md           $DEST/agents/
cp docs/claude-skills/agents/lisa-scaffolder.md       $DEST/agents/

# Commands
mkdir -p $DEST/commands
cp docs/claude-skills/commands/lisa.md     $DEST/commands/
cp docs/claude-skills/commands/test-ux.md $DEST/commands/

# Skills
mkdir -p $DEST/skills/stf \
         $DEST/skills/lisa-test \
         $DEST/skills/ai-qa-agent \
         $DEST/skills/guided-exploration \
         $DEST/skills/flutter-test-generator \
         $DEST/skills/lisa-qa-agent

cp docs/claude-skills/skills/stf/SKILL.md                     $DEST/skills/stf/
cp docs/claude-skills/skills/lisa-test/SKILL.md               $DEST/skills/lisa-test/
cp docs/claude-skills/skills/ai-qa-agent/SKILL.md             $DEST/skills/ai-qa-agent/
cp docs/claude-skills/skills/guided-exploration/SKILL.md      $DEST/skills/guided-exploration/
cp docs/claude-skills/skills/flutter-test-generator/SKILL.md  $DEST/skills/flutter-test-generator/
cp docs/claude-skills/skills/lisa-qa-agent/SKILL.md           $DEST/skills/lisa-qa-agent/
```

The `stf` skill drives the `fab` CLI / `fab-mcp` server (added in v0.4.0). When you
have `fab-mcp` installed in `~/.claude/.mcp.json`, agents prefer the native MCP tools
(`stf_*`); without it they fall back to `fab` shell commands. Both work, MCP is faster.

### Option B — Copy to project `.claude/` (this project only)

```bash
cp -r docs/claude-skills/agents       .claude/agents
cp -r docs/claude-skills/skills       .claude/skills
```

---

## MCP servers

For the STF skill, install `fab-mcp` (added in #27) — see `docs/mcp-install.md`:

```json
{
  "mcpServers": {
    "fab": { "command": "fab-mcp" }
  }
}
```

Verify with `npx fab-mcp` or by asking the agent to run `stf_status`.

For Lisa MCP wiring, see the lisa MCP project documentation.

---

## Keeping in sync

The Lisa-specific skills (everything not under `skills/stf/` or
`agents/stf-runner.md`) live in this repo as reference documentation but do
not ship in the published `synthetic-test-fabric` npm package. Adapt them to
your product before installing into `~/.claude/`.

The STF skill (`skills/stf/SKILL.md`) and agent (`agents/stf-runner.md`)
ship with the package and are product-neutral by design.
