# Skills

Agent skills I use with Claude Code and other coding agents.

## Install

```bash
npx skills add richarddavenport/skills
```

## Skills

| Skill | What it does |
|---|---|
| [clickup](skills/clickup) | Works with ClickUp through its REST API. Tasks, lists, comments, docs, chat and time tracking, with no MCP server. |

### clickup

It needs Node 18 or newer and a ClickUp personal API token. You'll find the token in ClickUp under Settings, then Apps.

```bash
export CLICKUP_API_KEY="pk_..."
```

If your token can see more than one workspace, also set `CLICKUP_TEAM_ID` to the one you want. Otherwise the skill finds it on its own.

## License

MIT
