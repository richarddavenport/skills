---
name: clickup
description: Interact with ClickUp tasks, lists, spaces, comments, time tracking, docs, and chat via the ClickUp API v2 and v3. Use when the user mentions ClickUp, wants to view or create tasks, update task status, add comments, search tasks, manage docs, track time, send chat messages, or navigate workspace hierarchy. Replaces the ClickUp MCP server. Feature parity with all MCP tools.
---

# ClickUp

Calls the ClickUp REST API (v2 + v3) directly via `scripts/cu.js`. Zero dependencies, no MCP server.

## Setup

Set `CLICKUP_API_KEY` in your shell environment before invoking any command:

```bash
export CLICKUP_API_KEY="pk_..."
export CLICKUP_TEAM_ID="<workspace_id>"   # only needed when the token can see more than one workspace
```

When `CLICKUP_TEAM_ID` isn't set, the script uses the token's workspace if it has exactly one. `node cu.js teams` lists the workspaces a token can see.

The script is `scripts/cu.js` inside this skill's folder. Run it with Node, using the skill's base directory:
```bash
node <skill_dir>/scripts/cu.js <command> [args] [--flags]
```
The examples below shorten this to `node cu.js`.

## Command reference

### Workspace
| Command | What it does |
|---|---|
| `teams` | List all workspaces |
| `spaces [team_id]` | List spaces in a team |
| `hierarchy [team_id]` | Full tree: spaces → folders → lists |

### Folders
| Command | What it does |
|---|---|
| `folders <space_id>` | List folders in a space |
| `get-folder <folder_id>` | Get folder + its lists |
| `create-folder <space_id> --name="..."` | Create a folder |
| `update-folder <folder_id> --name="..."` | Rename a folder |
| `delete-folder <folder_id>` | Delete a folder |

### Lists
| Command | What it does |
|---|---|
| `lists <space_id>` | Folderless lists in a space |
| `folder-lists <folder_id>` | Lists inside a folder |
| `get-list <list_id>` | Get list details + statuses |
| `statuses <list_id>` | Show valid statuses for a list |
| `custom-fields <list_id>` | List custom fields and options |
| `create-list <folder_id> --name="..."` | Create list in a folder |
| `create-space-list <space_id> --name="..."` | Create folderless list |
| `update-list <list_id> --name="..."` | Rename/update a list |
| `delete-list <list_id>` | Delete a list |

### Tasks
| Command | What it does |
|---|---|
| `tasks <list_id>` | List tasks (filter with `--status`, `--assignee`, `--tag`, `--page`) |
| `task <task_id>` | Full task details, custom fields |
| `create <list_id> --name="..."` | Create a task |
| `bulk-create <list_id> --name="Task 1" --name="Task 2"` | Create multiple tasks |
| `update <task_id>` | Update name/status/priority/due/assignees |
| `bulk-update <id1> <id2> --status="..."` | Update multiple tasks with same fields |
| `delete-task <task_id>` | Delete a task |
| `search "<query>"` | Search tasks across workspace |

### Task actions
| Command | What it does |
|---|---|
| `move-task <task_id> <new_list_id>` | Move task to a new home list |
| `add-to-list <task_id> <list_id>` | Add task to an additional list |
| `remove-from-list <task_id> <list_id>` | Remove task from a list |
| `add-tag <task_id> <tag_name>` | Apply a tag |
| `remove-tag <task_id> <tag_name>` | Remove a tag |
| `set-field <task_id> <field_id> --value="..."` | Set a custom field value |
| `tags <space_id>` | List available tags in a space |

### Task relationships
| Command | What it does |
|---|---|
| `add-link <task_id> <linked_task_id>` | Link two related tasks |
| `remove-link <task_id> <linked_task_id>` | Remove a task link |
| `add-dep <task_id> --depends-on=<id>` | Add dependency (this task is blocked by id) |
| `add-dep <task_id> --dep-of=<id>` | Add dependency (id is blocked by this task) |
| `remove-dep <task_id> --depends-on=<id>` | Remove dependency |

### Comments
| Command | What it does |
|---|---|
| `comments <task_id>` | List all comments (with comment IDs) |
| `comment <task_id> --text="..."` | Post a comment |
| `threaded-comments <comment_id>` | Get replies to a comment |
| `reply <comment_id> --text="..."` | Reply to a comment thread |

### Members
| Command | What it does |
|---|---|
| `members [team_id]` | List all workspace members |
| `find-member <name_or_email>` | Search for a member by name/email |

### Time tracking
| Command | What it does |
|---|---|
| `time-entries` | Recent time entries (filter with `--task`, `--assignee`, `--start`, `--end`) |
| `time-log <task_id> --start=<ms> --end=<ms>` | Manually log time |
| `time-start <task_id>` | Start timer on a task |
| `time-stop` | Stop running timer |
| `time-current` | Show what is currently being timed |
| `time-in-status <task_id>` | Time spent in each status |
| `time-in-status-bulk <id1> <id2>` | Time in status for multiple tasks |

### Chat (v3)
| Command | What it does |
|---|---|
| `chat-channels` | List all channels |
| `chat-send <channel_id> --text="..."` | Post a message to a channel |

### Docs (v3)
| Command | What it does |
|---|---|
| `docs [--query=...]` | List docs in workspace |
| `create-doc --name="..." [--space=id]` | Create a new doc |
| `get-doc <doc_id>` | Get doc details |
| `doc-page-list <doc_id>` | Table of contents (nested pages) |
| `doc-pages <doc_id>` | All pages with content preview |
| `get-doc-page <doc_id> <page_id>` | Full page content |
| `create-page <doc_id> --name="..." --content="..." [--parent-page=<page_id>]` | Add a page, optionally under another page |
| `update-page <doc_id> <page_id> --content="..." [--mode=append]` | Edit a page. `--mode` is `replace` (default), `append` or `prepend` |

## Common workflows

### Triage/status update
```bash
node cu.js search "login bug"
node cu.js statuses <list_id>          # check valid status strings
node cu.js update <task_id> --status="in review"
node cu.js comment <task_id> --text="Moved to in review, ready for QA."
```

### Assign to someone
```bash
node cu.js find-member "sam"          # get user ID
node cu.js update <task_id> --add-assignee=<user_id>
```

### Create task with details
```bash
node cu.js create <list_id> --name="Fix auth bug" --status="open" --priority=2 --assignee=<user_id>
```

### Time tracking
```bash
node cu.js time-start <task_id>
node cu.js time-current
node cu.js time-stop
```

### Browse workspace
```bash
node cu.js hierarchy                  # full tree
node cu.js spaces                     # just spaces
node cu.js folders <space_id>         # folders in a space
```

Task IDs can be ClickUp's own IDs or custom IDs like `ABC-123`.

## All flags

| Flag | Description |
|---|---|
| `--name=<text>` | Task/list/folder/doc name |
| `--markdown-description=<text>` | Task description **as Markdown** — use this for anything with headings, tables, lists or code fences |
| `--description=<text>` | Task description as **plain text**. ClickUp renders it literally, so Markdown arrives with visible `#`, `\|` and backticks |
| `--status=<text>` | Task status (must match list's statuses) |
| `--assignee=<uid>` | Assign; repeatable |
| `--add-assignee=<uid>` | Add assignee to existing list |
| `--remove-assignee=<uid>` | Remove assignee |
| `--priority=<1-4>` | 1=urgent 2=high 3=normal 4=low |
| `--due=<ms>` | Due date in Unix milliseconds |
| `--tag=<name>` | Filter/add tag; repeatable |
| `--text=<text>` | Comment or message body |
| `--value=<any>` | Custom field value (JSON or string) |
| `--depends-on=<id>` | Dependency target |
| `--dep-of=<id>` | Dependency target (reverse) |
| `--start=<ms>` | Start time (ms) for time log |
| `--end=<ms>` | End time (ms) for time log |
| `--duration=<ms>` | Duration (ms) instead of end |
| `--query=<text>` | Search query |
| `--page=<n>` | Pagination (0-indexed) |
| `--subtasks` | Include subtasks in task list |
| `--archived` | Include archived items |
| `--closed` | Include closed tasks in search |
| `--team=<id>` | Override team/workspace ID |
| `--workspace=<id>` | Override workspace ID (v3) |
| `--raw` | Print raw JSON response |
| `--token=<key>` | Override CLICKUP_API_KEY |

See [REFERENCE.md](REFERENCE.md) for full API endpoint list.
