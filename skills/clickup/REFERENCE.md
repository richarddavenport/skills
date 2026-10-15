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

## Attachments (v3)
The v3 attachment endpoints take an entity type in the path. Use `tasks` for a task and `custom_fields` for a Files custom field. ClickUp's spec lists `attachments` for tasks, but that returns 404.

## Built-in commands

These were written by hand and print friendlier output. Every other endpoint has a generated command, listed under [Endpoint commands](#endpoint-commands).

### v2 endpoints

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
| `checklists` | GET | `/task/:id` (checklists embedded in the task) |

### v3 endpoints

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
| Attach File to Task | `attach` |
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

## Endpoint commands

One command per endpoint, generated from the table in `cu.js`. IDs go in the order the path uses them, and `{team_id}` and `{workspace_id}` come from the workspace. Anything the flags don't cover goes in `--body='{json}'`.

<!-- endpoint-commands:start -->
<!-- Generated by `node tools/endpoints.mjs docs --write`. Don't edit by hand. -->

### Attachments

| Command | What it does | Endpoint |
|---|---|---|
| `attach <task_id> <file>` | Upload a file to a task | POST `/v2/task/{task_id}/attachment` |
| `attachments <entity_type> <entity_id> [--cursor=<string>] [--limit=<int>]` | List attachments on a task or a Files custom field (entity type is tasks or custom_fields) | GET `/v3/workspaces/{workspace_id}/{entity_type}/{entity_id}/attachments` |
| `upload-attachment <entity_type> <entity_id> <file> [--filename=<string>]` | Upload a file to a task or a Files custom field (entity type is tasks or custom_fields) | POST `/v3/workspaces/{workspace_id}/{entity_type}/{entity_id}/attachments` |

### Workspace

| Command | What it does | Endpoint |
|---|---|---|
| `me` | Show the user the token belongs to | GET `/v2/user` |
| `oauth-token --client-id=<string> --client-secret=<string> --code=<string>` | Exchange an OAuth code for an access token | POST `/v2/oauth/token` |
| `seats` | Show used and available seats | GET `/v2/team/{team_id}/seats` |
| `plan` | Show the workspace's plan | GET `/v2/team/{team_id}/plan` |
| `shared` | List the tasks, lists and folders shared with you | GET `/v2/team/{team_id}/shared` |
| `roles [--include-members]` | List custom roles | GET `/v2/team/{team_id}/customroles` |

### Spaces

| Command | What it does | Endpoint |
|---|---|---|
| `create-space --name=<string> [--multiple-assignees] [--features=<json>]` | Create a space | POST `/v2/team/{team_id}/space` |
| `get-space <space_id>` | Show a space | GET `/v2/space/{space_id}` |
| `update-space <space_id> [--name=<string>] [--color=<string>] [--private] [--admin-can-manage] [--multiple-assignees] [--features=<json>]` | Update a space | PUT `/v2/space/{space_id}` |
| `delete-space <space_id>` | Delete a space | DELETE `/v2/space/{space_id}` |

### Folders

| Command | What it does | Endpoint |
|---|---|---|
| `move-folder <folder_id> [--parent-folder=<string>] [--space=<string>] [--position=<int>] [--custom-type-map=<json>]` | Move a folder into another folder, or to another space | PUT `/v2/folder/{folder_id}/position` |
| `create-folder-from-template <space_id> <template_id> --name=<string> [--parent-folder=<string>] [--options=<json>]` | Create a folder from a template | POST `/v2/space/{space_id}/folder_template/{template_id}` |

### Lists

| Command | What it does | Endpoint |
|---|---|---|
| `create-list-from-template <folder_id> <template_id> --name=<string> [--options=<json>]` | Create a list in a folder from a template | POST `/v2/folder/{folder_id}/list_template/{template_id}` |
| `create-space-list-from-template <space_id> <template_id> --name=<string> [--options=<json>]` | Create a folderless list from a template | POST `/v2/space/{space_id}/list_template/{template_id}` |

### Tasks

| Command | What it does | Endpoint |
|---|---|---|
| `merge-tasks <task_id> --source=<strings>` | Merge source tasks into a target task (ClickUp task IDs only) | POST `/v2/task/{task_id}/merge` |
| `create-from-template <list_id> <template_id> --name=<string>` | Create a task from a template | POST `/v2/list/{list_id}/taskTemplate/{template_id}` |
| `task-types` | List custom task types | GET `/v2/team/{team_id}/custom_item` |
| `update-time-estimates <task_id>` | Change time estimates per assignee with --estimate=<user_id|unassigned>:<ms> (Business plan or above) | PATCH `/v3/workspaces/{workspace_id}/tasks/{task_id}/time_estimates_by_user` |
| `replace-time-estimates <task_id>` | Replace all time estimates with --estimate=<user_id|unassigned>:<ms> (Business plan or above) | PUT `/v3/workspaces/{workspace_id}/tasks/{task_id}/time_estimates_by_user` |

### Checklists

| Command | What it does | Endpoint |
|---|---|---|
| `create-checklist <task_id> --name=<string>` | Add a checklist to a task | POST `/v2/task/{task_id}/checklist` |
| `update-checklist <checklist_id> [--name=<string>] [--position=<int>]` | Rename or reorder a checklist | PUT `/v2/checklist/{checklist_id}` |
| `delete-checklist <checklist_id>` | Delete a checklist | DELETE `/v2/checklist/{checklist_id}` |
| `add-checklist-item <checklist_id> --name=<string> [--assignee=<int>]` | Add an item to a checklist | POST `/v2/checklist/{checklist_id}/checklist_item` |
| `update-checklist-item <checklist_id> <checklist_item_id> [--name=<string>] [--assignee=<nullable>] [--resolved] [--parent=<nullable>]` | Rename, assign, nest or resolve a checklist item | PUT `/v2/checklist/{checklist_id}/checklist_item/{checklist_item_id}` |
| `check-item <checklist_id> <checklist_item_id>` | Tick a checklist item off | PUT `/v2/checklist/{checklist_id}/checklist_item/{checklist_item_id}` |
| `uncheck-item <checklist_id> <checklist_item_id>` | Untick a checklist item | PUT `/v2/checklist/{checklist_id}/checklist_item/{checklist_item_id}` |
| `delete-checklist-item <checklist_id> <checklist_item_id>` | Delete a checklist item | DELETE `/v2/checklist/{checklist_id}/checklist_item/{checklist_item_id}` |

### Comments

| Command | What it does | Endpoint |
|---|---|---|
| `update-comment <comment_id> [--text=<string>] [--assignee=<int>] [--group-assignee=<int>] [--resolved]` | Edit, assign or resolve a comment | PUT `/v2/comment/{comment_id}` |
| `delete-comment <comment_id>` | Delete a comment | DELETE `/v2/comment/{comment_id}` |
| `list-comments <list_id> [--start=<int>] [--start-id=<string>]` | List comments on a list | GET `/v2/list/{list_id}/comment` |
| `create-list-comment <list_id> --text=<string> [--assignee=<int>] [--notify]` | Comment on a list | POST `/v2/list/{list_id}/comment` |
| `view-comments <view_id> [--start=<int>] [--start-id=<string>]` | List comments on a chat view | GET `/v2/view/{view_id}/comment` |
| `create-view-comment <view_id> --text=<string> [--notify]` | Comment on a chat view | POST `/v2/view/{view_id}/comment` |
| `comment-subtypes <comment_type>` | List post subtype IDs for a comment type (post, ai, syncup or ai_via_brain) | GET `/v3/workspaces/{workspace_id}/comments/types/{comment_type}/subtypes` |

### Custom fields

| Command | What it does | Endpoint |
|---|---|---|
| `space-fields <space_id> [--include-applied-objects]` | List a space's custom fields | GET `/v2/space/{space_id}/field` |
| `folder-fields <folder_id> [--include-applied-objects]` | List a folder's custom fields | GET `/v2/folder/{folder_id}/field` |
| `workspace-fields [--include-applied-objects]` | List the workspace's custom fields | GET `/v2/team/{team_id}/field` |
| `clear-field <task_id> <field_id>` | Clear a custom field's value on a task | DELETE `/v2/task/{task_id}/field/{field_id}` |

### Members

| Command | What it does | Endpoint |
|---|---|---|
| `task-members <task_id>` | List the people who can see a task | GET `/v2/task/{task_id}/member` |
| `list-members <list_id>` | List the people who can see a list | GET `/v2/list/{list_id}/member` |

### Tags

| Command | What it does | Endpoint |
|---|---|---|
| `create-tag <space_id> --name=<string> [--fg=<string>] [--bg=<string>]` | Create a tag in a space (--fg and --bg are hex colors) | POST `/v2/space/{space_id}/tag` |
| `update-tag <space_id> <tag_name> [--name=<string>] [--fg=<string>] [--bg=<string>]` | Rename a tag or change its colors | PUT `/v2/space/{space_id}/tag/{tag_name}` |
| `delete-tag <space_id> <tag_name>` | Delete a tag from a space | DELETE `/v2/space/{space_id}/tag/{tag_name}` |

### Templates

| Command | What it does | Endpoint |
|---|---|---|
| `task-templates [--page=<int>]` | List task templates | GET `/v2/team/{team_id}/taskTemplate` |
| `list-templates` | List list templates | GET `/v2/team/{team_id}/list_template` |
| `folder-templates` | List folder templates | GET `/v2/team/{team_id}/folder_template` |

### Time tracking

| Command | What it does | Endpoint |
|---|---|---|
| `time-entry <timer_id> [--include-task-tags] [--include-location-names] [--include-approval-history] [--include-approval-details]` | Show one time entry | GET `/v2/team/{team_id}/time_entries/{timer_id}` |
| `update-time-entry <timer_id> [--description=<string>] [--tags=<json>] [--tag-action=<string>] [--start=<int>] [--end=<int>] [--task=<string>] [--billable] [--duration=<int>]` | Update a time entry | PUT `/v2/team/{team_id}/time_entries/{timer_id}` |
| `delete-time-entry <timer_id>` | Delete a time entry | DELETE `/v2/team/{team_id}/time_entries/{timer_id}` |
| `time-entry-history <timer_id>` | Show a time entry's change history | GET `/v2/team/{team_id}/time_entries/{timer_id}/history` |
| `time-tags` | List the tags used on time entries | GET `/v2/team/{team_id}/time_entries/tags` |
| `add-time-tags --entry=<strings> --tag=<names>` | Tag time entries | POST `/v2/team/{team_id}/time_entries/tags` |
| `remove-time-tags --entry=<strings> --tag=<names>` | Remove tags from time entries | DELETE `/v2/team/{team_id}/time_entries/tags` |
| `rename-time-tag --name=<string> --new-name=<string> [--bg=<string>] [--fg=<string>]` | Rename a time entry tag or change its colors | PUT `/v2/team/{team_id}/time_entries/tags` |
| `task-time <task_id>` | List time tracked on a task (legacy endpoint) | GET `/v2/task/{task_id}/time` |
| `track-time <task_id> --start=<int> --end=<int> --time=<int>` | Track time on a task (legacy endpoint, times in ms) | POST `/v2/task/{task_id}/time` |
| `update-tracked-time <task_id> <interval_id> [--start=<int>] [--end=<int>] [--time=<int>]` | Edit tracked time on a task (legacy endpoint) | PUT `/v2/task/{task_id}/time/{interval_id}` |
| `delete-tracked-time <task_id> <interval_id>` | Delete tracked time from a task (legacy endpoint) | DELETE `/v2/task/{task_id}/time/{interval_id}` |

### Goals

| Command | What it does | Endpoint |
|---|---|---|
| `goals [--include-completed]` | List goals | GET `/v2/team/{team_id}/goal` |
| `goal <goal_id>` | Show a goal and its key results | GET `/v2/goal/{goal_id}` |
| `create-goal --name=<string> [--due=<int>] [--description=<string>] [--multiple-owners] [--owner=<ints>] [--color=<string>]` | Create a goal | POST `/v2/team/{team_id}/goal` |
| `update-goal <goal_id> [--name=<string>] [--due=<int>] [--description=<string>] [--add-owner=<ints>] [--remove-owner=<ints>] [--color=<string>]` | Update a goal | PUT `/v2/goal/{goal_id}` |
| `delete-goal <goal_id>` | Delete a goal | DELETE `/v2/goal/{goal_id}` |
| `create-key-result <goal_id> --name=<string> --type=<string> [--owner=<ints>] [--steps-start=<int>] [--steps-end=<int>] [--unit=<string>] [--task=<strings>] [--list=<strings>]` | Add a key result to a goal (type is number, currency, boolean, percentage or automatic) | POST `/v2/goal/{goal_id}/key_result` |
| `update-key-result <key_result_id> [--steps-current=<int>] [--note=<string>]` | Record progress on a key result | PUT `/v2/key_result/{key_result_id}` |
| `delete-key-result <key_result_id>` | Delete a key result | DELETE `/v2/key_result/{key_result_id}` |

### Views

| Command | What it does | Endpoint |
|---|---|---|
| `views` | List Everything-level views | GET `/v2/team/{team_id}/view` |
| `space-views <space_id>` | List a space's views | GET `/v2/space/{space_id}/view` |
| `folder-views <folder_id>` | List a folder's views | GET `/v2/folder/{folder_id}/view` |
| `list-views <list_id>` | List a list's views | GET `/v2/list/{list_id}/view` |
| `view <view_id>` | Show a view and its settings | GET `/v2/view/{view_id}` |
| `view-tasks <view_id> [--page=<int>]` | List the tasks in a view | GET `/v2/view/{view_id}/task` |
| `create-view --name=<string> --type=<string>` | Create an Everything-level view (type is list, board, calendar, gantt and so on; pass settings with --body) | POST `/v2/team/{team_id}/view` |
| `create-space-view <space_id> --name=<string> --type=<string>` | Create a view on a space | POST `/v2/space/{space_id}/view` |
| `create-folder-view <folder_id> --name=<string> --type=<string>` | Create a view on a folder | POST `/v2/folder/{folder_id}/view` |
| `create-list-view <list_id> --name=<string> --type=<string>` | Create a view on a list | POST `/v2/list/{list_id}/view` |
| `update-view <view_id> [--name=<string>] [--type=<string>]` | Update a view (pass settings with --body) | PUT `/v2/view/{view_id}` |
| `delete-view <view_id>` | Delete a view | DELETE `/v2/view/{view_id}` |

### Webhooks

| Command | What it does | Endpoint |
|---|---|---|
| `webhooks` | List webhooks | GET `/v2/team/{team_id}/webhook` |
| `create-webhook --endpoint=<string> --event=<strings> [--space=<int>] [--folder=<int>] [--list=<int>] [--task=<string>]` | Create a webhook (--event is repeatable; * means every event) | POST `/v2/team/{team_id}/webhook` |
| `update-webhook <webhook_id> [--endpoint=<string>] [--events=<string>] [--status=<string>]` | Update a webhook | PUT `/v2/webhook/{webhook_id}` |
| `delete-webhook <webhook_id>` | Delete a webhook | DELETE `/v2/webhook/{webhook_id}` |

### User groups

| Command | What it does | Endpoint |
|---|---|---|
| `groups [--group=<strings>]` | List user groups | GET `/v2/group` |
| `create-group --name=<string> [--handle=<string>] [--member=<ints>]` | Create a user group | POST `/v2/team/{team_id}/group` |
| `update-group <group_id> [--name=<string>] [--handle=<string>]` | Rename a user group, or change its members with --add-member and --remove-member | PUT `/v2/group/{group_id}` |
| `delete-group <group_id>` | Delete a user group | DELETE `/v2/group/{group_id}` |

### Users

| Command | What it does | Endpoint |
|---|---|---|
| `invite-user --email=<string> [--admin] [--custom-role-id=<int>]` | Invite someone to the workspace (Enterprise) | POST `/v2/team/{team_id}/user` |
| `user <user_id> [--include-shared]` | Show a workspace member (Enterprise) | GET `/v2/team/{team_id}/user/{user_id}` |
| `update-user <user_id> [--username=<string>] [--admin] [--custom-role-id=<int>]` | Change a member's name, admin flag or role (Enterprise) | PUT `/v2/team/{team_id}/user/{user_id}` |
| `remove-user <user_id>` | Remove someone from the workspace (Enterprise) | DELETE `/v2/team/{team_id}/user/{user_id}` |

### Guests

| Command | What it does | Endpoint |
|---|---|---|
| `invite-guest --email=<string> [--can-edit-tags] [--can-see-time-spent] [--can-see-time-estimated] [--can-create-views] [--can-see-points-estimated] [--custom-role-id=<int>]` | Invite a guest to the workspace (Enterprise) | POST `/v2/team/{team_id}/guest` |
| `guest <guest_id>` | Show a guest (Enterprise) | GET `/v2/team/{team_id}/guest/{guest_id}` |
| `update-guest <guest_id> [--can-edit-tags] [--can-see-time-spent] [--can-see-time-estimated] [--can-create-views] [--can-see-points-estimated] [--custom-role-id=<int>]` | Change a guest's permissions (Enterprise) | PUT `/v2/team/{team_id}/guest/{guest_id}` |
| `remove-guest <guest_id>` | Remove a guest from the workspace (Enterprise) | DELETE `/v2/team/{team_id}/guest/{guest_id}` |
| `add-guest-to-task <task_id> <guest_id> --permission=<string> [--include-shared]` | Share a task with a guest (permission is read, comment, edit or create; Enterprise) | POST `/v2/task/{task_id}/guest/{guest_id}` |
| `remove-guest-from-task <task_id> <guest_id> [--include-shared]` | Stop sharing a task with a guest (Enterprise) | DELETE `/v2/task/{task_id}/guest/{guest_id}` |
| `add-guest-to-list <list_id> <guest_id> --permission=<string> [--include-shared]` | Share a list with a guest (Enterprise) | POST `/v2/list/{list_id}/guest/{guest_id}` |
| `remove-guest-from-list <list_id> <guest_id> [--include-shared]` | Stop sharing a list with a guest (Enterprise) | DELETE `/v2/list/{list_id}/guest/{guest_id}` |
| `add-guest-to-folder <folder_id> <guest_id> --permission=<string> [--include-shared]` | Share a folder with a guest (Enterprise) | POST `/v2/folder/{folder_id}/guest/{guest_id}` |
| `remove-guest-from-folder <folder_id> <guest_id> [--include-shared]` | Stop sharing a folder with a guest (Enterprise) | DELETE `/v2/folder/{folder_id}/guest/{guest_id}` |

### Access and audit (v3)

| Command | What it does | Endpoint |
|---|---|---|
| `update-acl <object_type> <object_id> [--private]` | Change who can see an object (pass entries with --body) | PATCH `/v3/workspaces/{workspace_id}/{object_type}/{object_id}/acls` |
| `audit-logs [--applicability=<string>]` | Query workspace audit logs (Enterprise; pass filter and pagination with --body) | POST `/v3/workspaces/{workspace_id}/auditlogs` |

### Chat (v3)

| Command | What it does | Endpoint |
|---|---|---|
| `create-channel --name=<string> [--description=<string>] [--topic=<string>] [--user=<strings>] [--visibility=<string>]` | Create a channel | POST `/v3/workspaces/{workspace_id}/chat/channels` |
| `create-location-channel [--description=<string>] [--topic=<string>] [--user=<strings>] [--visibility=<string>]` | Create the channel for a space, folder or list (--space, --folder or --list) | POST `/v3/workspaces/{workspace_id}/chat/channels/location` |
| `create-dm --user=<strings>` | Open a direct message with one or more people | POST `/v3/workspaces/{workspace_id}/chat/channels/direct_message` |
| `chat-channel <channel_id> [--description-format=<string>]` | Show a channel | GET `/v3/workspaces/{workspace_id}/chat/channels/{channel_id}` |
| `update-channel <channel_id> [--name=<string>] [--description=<string>] [--topic=<string>] [--visibility=<string>] [--content-format=<string>]` | Update a channel | PATCH `/v3/workspaces/{workspace_id}/chat/channels/{channel_id}` |
| `delete-channel <channel_id>` | Delete a channel | DELETE `/v3/workspaces/{workspace_id}/chat/channels/{channel_id}` |
| `channel-followers <channel_id> [--cursor=<string>] [--limit=<int>]` | List a channel's followers | GET `/v3/workspaces/{workspace_id}/chat/channels/{channel_id}/followers` |
| `channel-members <channel_id> [--cursor=<string>] [--limit=<int>]` | List a channel's members | GET `/v3/workspaces/{workspace_id}/chat/channels/{channel_id}/members` |
| `chat-messages <channel_id> [--cursor=<string>] [--limit=<int>] [--content-format=<string>]` | Read a channel's messages | GET `/v3/workspaces/{workspace_id}/chat/channels/{channel_id}/messages` |
| `update-message <message_id> [--text=<string>] [--content-format=<string>] [--assignee=<string>] [--group-assignee=<string>] [--resolved]` | Edit, assign or resolve a message | PATCH `/v3/workspaces/{workspace_id}/chat/messages/{message_id}` |
| `delete-message <message_id>` | Delete a message | DELETE `/v3/workspaces/{workspace_id}/chat/messages/{message_id}` |
| `message-replies <message_id> [--cursor=<string>] [--limit=<int>] [--content-format=<string>]` | Read the replies to a message | GET `/v3/workspaces/{workspace_id}/chat/messages/{message_id}/replies` |
| `reply-message <message_id> --text=<string> [--type=<string>] [--content-format=<string>] [--assignee=<string>] [--group-assignee=<string>] [--follower=<strings>]` | Reply to a message | POST `/v3/workspaces/{workspace_id}/chat/messages/{message_id}/replies` |
| `message-reactions <message_id> [--cursor=<string>] [--limit=<int>]` | List reactions to a message | GET `/v3/workspaces/{workspace_id}/chat/messages/{message_id}/reactions` |
| `react <message_id> --reaction=<string>` | React to a message (--reaction is the emoji name) | POST `/v3/workspaces/{workspace_id}/chat/messages/{message_id}/reactions` |
| `unreact <message_id> <reaction>` | Remove your reaction from a message | DELETE `/v3/workspaces/{workspace_id}/chat/messages/{message_id}/reactions/{reaction}` |
| `tagged-users <message_id> [--cursor=<string>] [--limit=<int>]` | List the people tagged in a message | GET `/v3/workspaces/{workspace_id}/chat/messages/{message_id}/tagged_users` |

<!-- endpoint-commands:end -->

## Rate limits
Requests per minute, per token, by plan ([docs](https://developer.clickup.com/docs/rate-limits)).

| Plan | Limit |
|---|---|
| Free Forever, Unlimited, Business | 100 |
| Business Plus | 1,000 |
| Enterprise | 10,000 |

A 429 response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (a Unix timestamp). There's no `Retry-After` header. `cu.js` waits until the reset and retries up to 3 times, then reports the reset time.

## API docs
- https://developer.clickup.com/docs/authentication
- https://developer.clickup.com/reference/getaccesstoken
