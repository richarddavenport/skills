# ClickUp API Reference

## Base URLs
- v2: `https://api.clickup.com/api/v2`
- v3: `https://api.clickup.com/api/v3`

## Auth
Pass your personal API token in the `Authorization` header (no `Bearer` prefix).

## Workspace Hierarchy
```
Team (Workspace)
└── Space
    ├── Folder
    │   └── List
    │       └── Task
    └── List (folderless)
        └── Task
```

## Priority values
| Value | Meaning |
|---|---|
| `1` | Urgent |
| `2` | High |
| `3` | Normal |
| `4` | Low |

## Statuses
Statuses are **list-specific**. Always run `statuses <list_id>` before updating.

## Timestamps
All timestamps are **Unix milliseconds** (13-digit). Example: `Date.now()` in JS, or `date +%s000` in shell.

## Custom field value formats (by type)
| Type | Value format |
|---|---|
| `text` | `"string"` |
| `number` | `42` |
| `drop_down` | `"<option_id>"` (UUID) |
| `labels` | `["<option_id>"]` |
| `date` | Unix ms as number |
| `checkbox` | `true` / `false` |
| `url` | `"https://..."` |

## Doc `parent` type codes (create-doc)
| Code | Meaning |
|---|---|
| `4` | Space |
| `5` | Folder |
| `6` | List |
| `7` | Workspace |
| `12` | Workspace (DM parent) |

## All v2 endpoints used by cu.js

| cu.js command | Method | Path |
|---|---|---|
| `teams` | GET | `/team` |
| `spaces` | GET | `/team/:id/space` |
| `hierarchy` | GET | `/team/:id/space` + `/space/:id/folder` + `/folder/:id/list` + `/space/:id/list` |
| `folders` | GET | `/space/:id/folder` |
| `get-folder` | GET | `/folder/:id` |
| `create-folder` | POST | `/space/:id/folder` |
| `update-folder` | PUT | `/folder/:id` |
| `delete-folder` | DELETE | `/folder/:id` |
| `lists` | GET | `/space/:id/list` |
| `folder-lists` | GET | `/folder/:id/list` |
| `get-list` / `statuses` | GET | `/list/:id` |
| `create-list` | POST | `/folder/:id/list` |
| `create-space-list` | POST | `/space/:id/list` |
| `update-list` | PUT | `/list/:id` |
| `delete-list` | DELETE | `/list/:id` |
| `custom-fields` | GET | `/list/:id/field` |
| `tasks` | GET | `/list/:id/task` |
| `task` | GET | `/task/:id` |
| `create` | POST | `/list/:id/task` |
| `update` | PUT | `/task/:id` |
| `delete-task` | DELETE | `/task/:id` |
| `search` | GET | `/team/:id/task` |
| `add-to-list` | POST | `/list/:id/task/:task_id` |
| `remove-from-list` | DELETE | `/list/:id/task/:task_id` |
| `set-field` | POST | `/task/:id/field/:field_id` |
| `add-tag` | POST | `/task/:id/tag/:tag_name` |
| `remove-tag` | DELETE | `/task/:id/tag/:tag_name` |
| `tags` | GET | `/space/:id/tag` |
| `add-link` | POST | `/task/:id/link/:links_to` |
| `remove-link` | DELETE | `/task/:id/link/:links_to` |
| `add-dep` | POST | `/task/:id/dependency` |
| `remove-dep` | DELETE | `/task/:id/dependency` |
| `comments` | GET | `/task/:id/comment` |
| `comment` | POST | `/task/:id/comment` |
| `threaded-comments` | GET | `/comment/:id/reply` |
| `reply` | POST | `/comment/:id/reply` |
| `members` | GET | `/team` (members embedded in response) |
| `time-entries` | GET | `/team/:id/time_entries` |
| `time-log` | POST | `/team/:id/time_entries` |
| `time-start` | POST | `/team/:id/time_entries/start` |
| `time-stop` | POST | `/team/:id/time_entries/stop` |
| `time-current` | GET | `/team/:id/time_entries/current` |
| `time-in-status` | GET | `/task/:id/time_in_status` |
| `time-in-status-bulk` | GET | `/task/bulk_time_in_status/task_ids` |

## All v3 endpoints used by cu.js

| cu.js command | Method | Path |
|---|---|---|
| `move-task` | PUT | `/workspaces/:wid/tasks/:tid/home_list/:lid` |
| `chat-channels` | GET | `/workspaces/:wid/chat/channels` |
| `chat-send` | POST | `/workspaces/:wid/chat/channels/:cid/messages` |
| `docs` | GET | `/workspaces/:wid/docs` |
| `create-doc` | POST | `/workspaces/:wid/docs` |
| `get-doc` | GET | `/workspaces/:wid/docs/:did` |
| `doc-page-list` | GET | `/workspaces/:wid/docs/:did/page_listing` |
| `doc-pages` | GET | `/workspaces/:wid/docs/:did/pages` |
| `get-doc-page` | GET | `/workspaces/:wid/docs/:did/pages/:pid` |
| `create-page` | POST | `/workspaces/:wid/docs/:did/pages` |
| `update-page` | PUT | `/workspaces/:wid/docs/:did/pages/:pid` |

## MCP Tool → cu.js command mapping

| MCP Tool | cu.js command |
|---|---|
| Search Workspace | `search` |
| Search tasks by task type | `search --type=<type>` |
| Search tasks by tag | `tasks <list_id> --tag=<name>` |
| Create Task | `create` |
| Get Task | `task` |
| Update Task | `update` |
| Set Custom Fields | `set-field` |
| Delete task | `delete-task` |
| Create Bulk Tasks | `bulk-create` |
| Update Bulk Tasks | `bulk-update` |
| Attach File to Task | ⚠️ not yet (requires multipart upload) |
| Get Task Comments | `comments` |
| Get Threaded Replies | `threaded-comments` |
| Create Task Comment | `comment` |
| Add Tag to Task | `add-tag` |
| Remove Tag from Task | `remove-tag` |
| Add task link | `add-link` |
| Remove task link | `remove-link` |
| Add dependency | `add-dep` |
| Remove dependency | `remove-dep` |
| Move task to a new List | `move-task` |
| Add task to another List | `add-to-list` |
| Get Task Time Entries | `time-entries --task=<id>` |
| Get time entries for multiple tasks | `time-entries` |
| Start Time Tracking | `time-start` |
| Stop Time Tracking | `time-stop` |
| Add Time Entry | `time-log` |
| Get Current Time Entry | `time-current` |
| Get Workspace Hierarchy | `hierarchy` |
| Create List | `create-list` |
| Create List in Folder | `create-list` |
| Get List | `get-list` |
| Update List | `update-list` |
| Get Folder | `get-folder` |
| Create Folder | `create-folder` |
| Update Folder | `update-folder` |
| Get Workspace Members | `members` |
| Find Member by Name | `find-member` |
| Resolve Assignees | `find-member` (then use id in `--assignee`) |
| Get Chat Channels | `chat-channels` |
| Send Chat Message | `chat-send` |
| Create Document | `create-doc` |
| List Document Pages | `doc-page-list` |
| Get Document Pages | `doc-pages` |
| Create Document Page | `create-page` |
| Update Document Page | `update-page` |
| Get Time in Status for a task | `time-in-status` |
| Get Time in Status for tasks in a List | `time-in-status-bulk` |

## Rate limits
- 100 requests/minute per token
- 429 responses include a `Retry-After` header

## API docs
- https://developer.clickup.com/docs/authentication
- https://developer.clickup.com/reference/getaccesstoken
