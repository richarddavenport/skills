# Skills

Agent skills I use with Claude Code and other coding agents.

## Install

```bash
npx skills add richarddavenport/skills
```

## Skills

| Skill | What it does |
|---|---|
| [clickup](skills/clickup) | Works with ClickUp through its REST API, with a command for every endpoint. Tasks, checklists, comments, docs, chat, goals, views and the rest, with no MCP server. |

### clickup

It needs Node 18 or newer and a ClickUp personal API token. You'll find the token in ClickUp under Settings, then Apps.

```bash
export CLICKUP_API_KEY="pk_..."
```

If your token can see more than one workspace, also set `CLICKUP_TEAM_ID` to the one you want. Otherwise the skill finds it on its own.

## Development

ClickUp's API specs live in `spec/`, and the clickup skill has a command for every endpoint in them.

```bash
node --test test/*.test.mjs                 # tests, against a fake ClickUp
node tools/endpoints.mjs coverage --check   # every spec endpoint has a command
node tools/endpoints.mjs docs --write       # regenerate the command tables in REFERENCE.md
```

The tools read the v3 spec with Ruby, since ClickUp only publishes it as YAML. CI runs all of this on every push and pull request.

Every Monday a workflow downloads ClickUp's specs. When they've changed, it opens a pull request that updates `spec/` and lists the endpoints that were added, removed or changed. Run it any time from the Actions tab.

## License

MIT
