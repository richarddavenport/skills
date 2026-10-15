#!/usr/bin/env node
/**
 * cu.js — ClickUp API CLI (v2 + v3), zero dependencies
 *
 * Auth:
 *   --token=<key>          # flag override
 *   CLICKUP_API_KEY        # env var (required)
 *
 * Workspace:
 *   --team=<id>            # flag override
 *   CLICKUP_TEAM_ID        # env var (optional when the token sees one workspace)
 *
 * Usage:  node cu.js <command> [args] [--flags]
 *         node cu.js help
 */

const https = require('https');
const path  = require('path');
const args  = process.argv.slice(2);
const cmd   = args[0];

// ── Flags ─────────────────────────────────────────────────────────────────────
function flag(name, fallback = null) {
  for (const a of args) {
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
    if (a === `--${name}`) return true;
  }
  return fallback;
}
function flags(name) {
  return args.filter(a => a.startsWith(`--${name}=`)).map(a => a.slice(name.length + 3));
}

const TOKEN  = flag('token') || process.env.CLICKUP_API_KEY;
const RAW    = flag('raw') !== null;
let   W_ID   = flag('team') || flag('workspace') || process.env.CLICKUP_TEAM_ID || null;

if (!TOKEN) {
  console.error('❌  No API token. Set CLICKUP_API_KEY in your environment, or pass --token=<key>.');
  process.exit(1);
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
function request(method, version, path, body = null, qs = {}) {
  return new Promise((resolve, reject) => {
    const query = Object.entries(qs)
      .filter(([, v]) => v != null && v !== false && v !== '')
      .flatMap(([k, v]) => Array.isArray(v) ? v.map(i => `${k}=${encodeURIComponent(i)}`) : [`${k}=${encodeURIComponent(v)}`])
      .join('&');
    const fullPath = `/api/${version}${path}${query ? '?' + query : ''}`;
    const payload  = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.clickup.com',
      path: fullPath,
      method,
      headers: {
        Authorization: TOKEN,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Custom task ID support ───────────────────────────────────────────────────
// ClickUp custom IDs (e.g. ABC-123) require ?custom_task_ids=true&team_id=<W_ID>
function customQs(id) {
  return /^[A-Z]+-\d+$/.test(id) ? { custom_task_ids: 'true', team_id: W_ID } : {};
}

const v2 = {
  get:   (path, qs)       => request('GET',    'v2', path, null, qs),
  post:  (path, body, qs) => request('POST',   'v2', path, body, qs),
  put:   (path, body, qs) => request('PUT',    'v2', path, body, qs),
  patch: (path, body, qs) => request('PATCH',  'v2', path, body, qs),
  del:   (path, qs)       => request('DELETE', 'v2', path, null, qs),
};
const v3 = {
  get:   (path, qs)  => request('GET',    'v3', path, null, qs),
  post:  (path, body) => request('POST',   'v3', path, body),
  put:   (path, body) => request('PUT',    'v3', path, body),
  patch: (path, body) => request('PATCH',  'v3', path, body),
  del:   (path, qs)  => request('DELETE', 'v3', path, null, qs),
};

function ok(res) {
  if (res.status >= 400) {
    const msg = res.body?.err || res.body?.message || JSON.stringify(res.body);
    console.error(`❌  HTTP ${res.status}: ${msg}`);
    process.exit(1);
  }
  return res.body;
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtTask(t) {
  const due       = t.due_date ? new Date(+t.due_date).toLocaleDateString() : '—';
  const assignees = (t.assignees || []).map(a => a.username || a.email).join(', ') || '—';
  const priority  = ['', 'urgent', 'high', 'normal', 'low'][t.priority?.priority || 0] || '—';
  const tags      = (t.tags || []).map(g => g.name).join(', ') || '—';
  return [
    `🔹 ${t.name}`,
    `   ID: ${t.id}  │  Status: ${t.status?.status || '—'}  │  Priority: ${priority}`,
    `   Assignees: ${assignees}  │  Due: ${due}  │  Tags: ${tags}`,
    `   URL: ${t.url}`,
  ].join('\n');
}
function fmtList(l)   { return `📋  ${l.name}  (id: ${l.id})  tasks: ${l.task_count ?? '?'}`; }
function fmtFolder(f) { return `📁  ${f.name}  (id: ${f.id})`; }
function fmtSpace(s)  { return `🌐  ${s.name}  (id: ${s.id})`; }
function ms2dur(ms)   {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// ── Commands ──────────────────────────────────────────────────────────────────
const commands = {

  // ── Workspace / Teams ──────────────────────────────────────────────────────
  async teams() {
    const d = ok(await v2.get('/team'));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const t of d.teams || []) console.log(`👥  ${t.name}  (id: ${t.id})`);
  },

  // ── Spaces ────────────────────────────────────────────────────────────────
  async spaces() {
    const teamId = args[1] || W_ID;
    const d = ok(await v2.get(`/team/${teamId}/space`, { archived: 'false' }));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const s of d.spaces || []) console.log(fmtSpace(s));
  },

  // ── Folders ───────────────────────────────────────────────────────────────
  async folders() {
    const spaceId = args[1];
    if (!spaceId) return console.error('Usage: cu.js folders <space_id>') || process.exit(1);
    const d = ok(await v2.get(`/space/${spaceId}/folder`, { archived: flag('archived') ? 'true' : 'false' }));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const f of d.folders || []) console.log(fmtFolder(f));
  },

  async 'get-folder'() {
    const folderId = args[1];
    if (!folderId) return console.error('Usage: cu.js get-folder <folder_id>') || process.exit(1);
    const d = ok(await v2.get(`/folder/${folderId}`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(fmtFolder(d));
    console.log(`   Lists: ${(d.lists || []).map(l => l.name).join(', ') || '—'}`);
  },

  async 'create-folder'() {
    const spaceId = args[1];
    const name    = flag('name');
    if (!spaceId || !name) return console.error('Usage: cu.js create-folder <space_id> --name="..."') || process.exit(1);
    const d = ok(await v2.post(`/space/${spaceId}/folder`, { name }));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Folder created: ${d.id}  "${d.name}"`);
  },

  async 'update-folder'() {
    const folderId = args[1];
    if (!folderId) return console.error('Usage: cu.js update-folder <folder_id> --name="..."') || process.exit(1);
    const body = {};
    if (flag('name')) body.name = flag('name');
    const d = ok(await v2.put(`/folder/${folderId}`, body));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Folder updated: ${d.id}  "${d.name}"`);
  },

  async 'delete-folder'() {
    const folderId = args[1];
    if (!folderId) return console.error('Usage: cu.js delete-folder <folder_id>') || process.exit(1);
    ok(await v2.del(`/folder/${folderId}`));
    console.log(`✅  Folder ${folderId} deleted.`);
  },

  // ── Lists ─────────────────────────────────────────────────────────────────
  async lists() {
    const spaceId = args[1];
    if (!spaceId) return console.error('Usage: cu.js lists <space_id>') || process.exit(1);
    const d = ok(await v2.get(`/space/${spaceId}/list`, { archived: 'false' }));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const l of d.lists || []) console.log(fmtList(l));
  },

  async 'folder-lists'() {
    const folderId = args[1];
    if (!folderId) return console.error('Usage: cu.js folder-lists <folder_id>') || process.exit(1);
    const d = ok(await v2.get(`/folder/${folderId}/list`, { archived: 'false' }));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const l of d.lists || []) console.log(fmtList(l));
  },

  async 'get-list'() {
    const listId = args[1];
    if (!listId) return console.error('Usage: cu.js get-list <list_id>') || process.exit(1);
    const d = ok(await v2.get(`/list/${listId}`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(fmtList(d));
    console.log(`   Statuses: ${(d.statuses || []).map(s => s.status).join(', ')}`);
  },

  async statuses() {
    const listId = args[1];
    if (!listId) return console.error('Usage: cu.js statuses <list_id>') || process.exit(1);
    const d = ok(await v2.get(`/list/${listId}`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const s of d.statuses || []) console.log(`  ${s.status}  (color: ${s.color}  type: ${s.type})`);
  },

  async 'create-list'() {
    const folderId = args[1];
    const name     = flag('name');
    if (!folderId || !name) return console.error('Usage: cu.js create-list <folder_id> --name="..."') || process.exit(1);
    const d = ok(await v2.post(`/folder/${folderId}/list`, { name }));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  List created in folder: ${d.id}  "${d.name}"`);
  },

  async 'create-space-list'() {
    const spaceId = args[1];
    const name    = flag('name');
    if (!spaceId || !name) return console.error('Usage: cu.js create-space-list <space_id> --name="..."') || process.exit(1);
    const d = ok(await v2.post(`/space/${spaceId}/list`, { name }));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Folderless list created: ${d.id}  "${d.name}"`);
  },

  async 'update-list'() {
    const listId = args[1];
    if (!listId) return console.error('Usage: cu.js update-list <list_id> --name="..." [--content=...] [--status=...]') || process.exit(1);
    const body = {};
    if (flag('name'))    body.name    = flag('name');
    if (flag('content')) body.content = flag('content');
    if (flag('status'))  body.status  = flag('status');
    const d = ok(await v2.put(`/list/${listId}`, body));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  List updated: ${d.id}  "${d.name}"`);
  },

  async 'delete-list'() {
    const listId = args[1];
    if (!listId) return console.error('Usage: cu.js delete-list <list_id>') || process.exit(1);
    ok(await v2.del(`/list/${listId}`));
    console.log(`✅  List ${listId} deleted.`);
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────
  async tasks() {
    const listId = args[1];
    if (!listId) return console.error('Usage: cu.js tasks <list_id>') || process.exit(1);
    const qs = {
      archived:  flag('archived') ? 'true' : 'false',
      subtasks:  flag('subtasks') ? 'true' : undefined,
      page:      flag('page', '0'),
      'statuses[]': flag('status') ? [flag('status')] : undefined,
    };
    const asgns = flags('assignee');
    if (asgns.length) qs['assignees[]'] = asgns;
    const tagList = flags('tag');
    if (tagList.length) qs['tags[]'] = tagList;
    const d = ok(await v2.get(`/list/${listId}/task`, qs));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    const tasks = d.tasks || [];
    console.log(`Found ${tasks.length} task(s):\n`);
    for (const t of tasks) console.log(fmtTask(t) + '\n');
  },

  async task() {
    const taskId = args[1];
    if (!taskId) return console.error('Usage: cu.js task <task_id>') || process.exit(1);
    const d = ok(await v2.get(`/task/${taskId}`, { include_subtasks: flag('subtasks') ? 'true' : undefined, ...customQs(taskId) }));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(fmtTask(d));
    if (d.description) console.log(`\n   Description:\n${d.description}`);
    if (d.custom_fields?.length) {
      console.log(`\n   Custom Fields:`);
      for (const f of d.custom_fields) {
        const val = f.value != null ? JSON.stringify(f.value) : '—';
        console.log(`     ${f.name} (${f.id}): ${val}`);
      }
    }
  },

  async create() {
    const listId = args[1];
    const name   = flag('name');
    if (!listId || !name) return console.error('Usage: cu.js create <list_id> --name="..." [--markdown-description=...] [--description=...] [--status=...] [--assignee=uid] [--priority=1-4] [--due=ms] [--tag=name]') || process.exit(1);
    const body = {
      name,
      description: flag('markdown-description') ? undefined : (flag('description') || undefined),
      markdown_content: flag('markdown-description') || undefined,
      status:      flag('status')      || undefined,
      priority:    flag('priority')    ? +flag('priority') : undefined,
      due_date:    flag('due')         ? +flag('due') : undefined,
      assignees:   flags('assignee').map(Number).filter(Boolean),
      tags:        flags('tag').map(name => ({ name })),
    };
    Object.keys(body).forEach(k => {
      if (body[k] === undefined || (Array.isArray(body[k]) && !body[k].length)) delete body[k];
    });
    const d = ok(await v2.post(`/list/${listId}/task`, body));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Task created:`);
    console.log(fmtTask(d));
  },

  async 'bulk-create'() {
    const listId = args[1];
    const names  = flags('name');
    if (!listId || !names.length) return console.error('Usage: cu.js bulk-create <list_id> --name="Task 1" --name="Task 2" ...') || process.exit(1);
    const results = [];
    for (const name of names) {
      const body = {
        name,
        status:   flag('status')   || undefined,
        priority: flag('priority') ? +flag('priority') : undefined,
        due_date: flag('due')      ? +flag('due') : undefined,
        assignees: flags('assignee').map(Number).filter(Boolean),
      };
      Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
      const d = ok(await v2.post(`/list/${listId}/task`, body));
      results.push(d);
      console.log(`  ✅  Created: ${d.id}  "${d.name}"`);
    }
    if (RAW) console.log(JSON.stringify(results, null, 2));
  },

  async update() {
    const taskId = args[1];
    if (!taskId) return console.error('Usage: cu.js update <task_id> [--name=...] [--markdown-description=...] [--description=...] [--status=...] [--priority=1-4] [--due=ms] [--assignee=uid] [--add-assignee=uid] [--remove-assignee=uid]') || process.exit(1);
    const body = {};
    if (flag('name'))        body.name        = flag('name');
    // --description stores PLAIN TEXT: ClickUp renders it literally, so markdown
    // arrives as visible #, | and ``` characters. Use --markdown-description for
    // anything with formatting; it sets markdown_content, which ClickUp parses.
    if (flag('markdown-description')) body.markdown_content = flag('markdown-description');
    else if (flag('description'))     body.description      = flag('description');
    if (flag('status'))      body.status      = flag('status');
    if (flag('priority'))    body.priority    = +flag('priority');
    if (flag('due'))         body.due_date    = +flag('due');
    const add    = flags('add-assignee').map(Number).filter(Boolean);
    const remove = flags('remove-assignee').map(Number).filter(Boolean);
    const direct = flags('assignee').map(Number).filter(Boolean);
    if (add.length || remove.length)  body.assignees = { add, rem: remove };
    else if (direct.length)           body.assignees = { add: direct };
    const d = ok(await v2.put(`/task/${taskId}`, body, customQs(taskId)));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Task updated:`);
    console.log(fmtTask(d));
  },

  async 'bulk-update'() {
    // Updates multiple tasks with the same fields
    const taskIds = args.slice(1).filter(a => !a.startsWith('--'));
    if (!taskIds.length) return console.error('Usage: cu.js bulk-update <id1> <id2> ... --status="..." [--priority=...] [--assignee=...]') || process.exit(1);
    for (const taskId of taskIds) {
      const body = {};
      if (flag('status'))   body.status   = flag('status');
      if (flag('priority')) body.priority = +flag('priority');
      if (flag('due'))      body.due_date = +flag('due');
      const add = flags('assignee').map(Number).filter(Boolean);
      if (add.length)       body.assignees = { add };
      const d = ok(await v2.put(`/task/${taskId}`, body, customQs(taskId)));
      console.log(`  ✅  Updated: ${d.id}  "${d.name}"  status: ${d.status?.status}`);
    }
  },

  async 'delete-task'() {
    const taskId = args[1];
    if (!taskId) return console.error('Usage: cu.js delete-task <task_id>') || process.exit(1);
    ok(await v2.del(`/task/${taskId}`, customQs(taskId)));
    console.log(`✅  Task ${taskId} deleted.`);
  },

  // ── Move / Add to List ────────────────────────────────────────────────────
  async 'move-task'() {
    const taskId = args[1];
    const listId = args[2] || flag('list');
    if (!taskId || !listId) return console.error('Usage: cu.js move-task <task_id> <new_list_id>') || process.exit(1);
    const d = ok(await v3.put(`/workspaces/${W_ID}/tasks/${taskId}/home_list/${listId}`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Task ${taskId} moved to list ${listId}.`);
  },

  async 'add-to-list'() {
    const taskId = args[1];
    const listId = args[2] || flag('list');
    if (!taskId || !listId) return console.error('Usage: cu.js add-to-list <task_id> <list_id>') || process.exit(1);
    ok(await v2.post(`/list/${listId}/task/${taskId}`));
    console.log(`✅  Task ${taskId} added to list ${listId}.`);
  },

  async 'remove-from-list'() {
    const taskId = args[1];
    const listId = args[2] || flag('list');
    if (!taskId || !listId) return console.error('Usage: cu.js remove-from-list <task_id> <list_id>') || process.exit(1);
    ok(await v2.del(`/list/${listId}/task/${taskId}`));
    console.log(`✅  Task ${taskId} removed from list ${listId}.`);
  },

  // ── Custom Fields ─────────────────────────────────────────────────────────
  async 'custom-fields'() {
    const listId = args[1];
    if (!listId) return console.error('Usage: cu.js custom-fields <list_id>') || process.exit(1);
    const d = ok(await v2.get(`/list/${listId}/field`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const f of d.fields || []) {
      console.log(`🔧  ${f.name}  (id: ${f.id}  type: ${f.type})`);
      const opts = f.type_config?.options || f.type_config?.new_drop_down?.options || [];
      for (const opt of opts) {
        if (opt.name) console.log(`     - ${opt.name} (${opt.id})`);
      }
    }
  },

  async 'set-field'() {
    const taskId  = args[1];
    const fieldId = args[2];
    const value   = flag('value');
    if (!taskId || !fieldId || value === null) return console.error('Usage: cu.js set-field <task_id> <field_id> --value="..."') || process.exit(1);
    // Try to parse value as JSON, fall back to string
    let parsed;
    try { parsed = JSON.parse(value); } catch { parsed = value; }
    const d = ok(await v2.post(`/task/${taskId}/field/${fieldId}`, { value: parsed }, customQs(taskId)));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Custom field ${fieldId} set on task ${taskId}.`);
  },

  // ── Tags ──────────────────────────────────────────────────────────────────
  async tags() {
    const spaceId = args[1];
    if (!spaceId) return console.error('Usage: cu.js tags <space_id>') || process.exit(1);
    const d = ok(await v2.get(`/space/${spaceId}/tag`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const t of d.tags || []) console.log(`🏷   ${t.name}  (bg: ${t.tag_bg})`);
  },

  async 'add-tag'() {
    const taskId  = args[1];
    const tagName = args[2] || flag('tag');
    if (!taskId || !tagName) return console.error('Usage: cu.js add-tag <task_id> <tag_name>') || process.exit(1);
    ok(await v2.post(`/task/${taskId}/tag/${encodeURIComponent(tagName)}`, null, customQs(taskId)));
    console.log(`✅  Tag "${tagName}" added to task ${taskId}.`);
  },

  async 'remove-tag'() {
    const taskId  = args[1];
    const tagName = args[2] || flag('tag');
    if (!taskId || !tagName) return console.error('Usage: cu.js remove-tag <task_id> <tag_name>') || process.exit(1);
    ok(await v2.del(`/task/${taskId}/tag/${encodeURIComponent(tagName)}`, customQs(taskId)));
    console.log(`✅  Tag "${tagName}" removed from task ${taskId}.`);
  },

  // ── Comments ──────────────────────────────────────────────────────────────
  async comments() {
    const taskId = args[1];
    if (!taskId) return console.error('Usage: cu.js comments <task_id>') || process.exit(1);
    const d = ok(await v2.get(`/task/${taskId}/comment`, customQs(taskId)));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const c of d.comments || []) {
      const who  = c.user?.username || c.user?.email || 'unknown';
      const when = new Date(+c.date).toLocaleString();
      console.log(`💬  ${who}  [${when}]  (id: ${c.id})\n    ${c.comment_text}\n`);
    }
  },

  async comment() {
    const taskId = args[1];
    const text   = flag('text');
    if (!taskId || !text) return console.error('Usage: cu.js comment <task_id> --text="..."') || process.exit(1);
    const d = ok(await v2.post(`/task/${taskId}/comment`, { comment_text: text, notify_all: flag('notify') ? true : undefined }, customQs(taskId)));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Comment posted (id: ${d.id})`);
  },

  async 'threaded-comments'() {
    const commentId = args[1];
    if (!commentId) return console.error('Usage: cu.js threaded-comments <comment_id>') || process.exit(1);
    const d = ok(await v2.get(`/comment/${commentId}/reply`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const c of d.comments || []) {
      const who  = c.user?.username || c.user?.email || 'unknown';
      const when = new Date(+c.date).toLocaleString();
      console.log(`↩️   ${who}  [${when}]\n    ${c.comment_text}\n`);
    }
  },

  async reply() {
    const commentId = args[1];
    const text      = flag('text');
    if (!commentId || !text) return console.error('Usage: cu.js reply <comment_id> --text="..."') || process.exit(1);
    const d = ok(await v2.post(`/comment/${commentId}/reply`, { comment_text: text }));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Reply posted (id: ${d.id})`);
  },

  // ── Task Relationships ────────────────────────────────────────────────────
  async 'add-link'() {
    const taskId  = args[1];
    const linksTo = args[2] || flag('to');
    if (!taskId || !linksTo) return console.error('Usage: cu.js add-link <task_id> <linked_task_id>') || process.exit(1);
    const d = ok(await v2.post(`/task/${taskId}/link/${linksTo}`, null, customQs(taskId)));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Linked task ${taskId} ↔ ${linksTo}.`);
  },

  async 'remove-link'() {
    const taskId  = args[1];
    const linksTo = args[2] || flag('to');
    if (!taskId || !linksTo) return console.error('Usage: cu.js remove-link <task_id> <linked_task_id>') || process.exit(1);
    ok(await v2.del(`/task/${taskId}/link/${linksTo}`, customQs(taskId)));
    console.log(`✅  Link between ${taskId} and ${linksTo} removed.`);
  },

  async 'add-dep'() {
    const taskId     = args[1];
    const dependsOn  = flag('depends-on');
    const depOf      = flag('dep-of');
    if (!taskId || (!dependsOn && !depOf)) return console.error('Usage: cu.js add-dep <task_id> --depends-on=<id>  OR  --dep-of=<id>') || process.exit(1);
    const body = dependsOn ? { depends_on: dependsOn } : { dependency_of: depOf };
    ok(await v2.post(`/task/${taskId}/dependency`, body, customQs(taskId)));
    console.log(`✅  Dependency added to task ${taskId}.`);
  },

  async 'remove-dep'() {
    const taskId     = args[1];
    const dependsOn  = flag('depends-on');
    const depOf      = flag('dep-of');
    if (!taskId || (!dependsOn && !depOf)) return console.error('Usage: cu.js remove-dep <task_id> --depends-on=<id>  OR  --dep-of=<id>') || process.exit(1);
    const qs = { ...(dependsOn ? { depends_on: dependsOn } : { dependency_of: depOf }), ...customQs(taskId) };
    ok(await v2.del(`/task/${taskId}/dependency`, qs));
    console.log(`✅  Dependency removed from task ${taskId}.`);
  },

  // ── Time Tracking ─────────────────────────────────────────────────────────
  async 'time-entries'() {
    const teamId = flag('team') || W_ID;
    const qs = {
      start_date:  flag('start') || undefined,
      end_date:    flag('end')   || undefined,
      'task_id[]': flag('task')  ? [flag('task')] : undefined,
      assignee:    flag('assignee') || undefined,
    };
    const d = ok(await v2.get(`/team/${teamId}/time_entries`, qs));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const e of d.data || []) {
      const who  = e.user?.username || '—';
      const task = e.task?.name     || e.tid || '—';
      const dur  = ms2dur(+e.duration);
      const when = new Date(+e.start).toLocaleDateString();
      console.log(`⏱   ${dur}  on "${task}"  by ${who}  [${when}]  (id: ${e.id})`);
    }
  },

  async 'time-log'() {
    const taskId   = args[1];
    const teamId   = flag('team') || W_ID;
    const duration = flag('duration');
    const start    = flag('start');
    const end      = flag('end');
    if (!taskId || !start) return console.error('Usage: cu.js time-log <task_id> --start=<ms> [--end=<ms> | --duration=<ms>]') || process.exit(1);
    const body = { tid: taskId, start: +start };
    if (end)      body.end      = +end;
    if (duration) body.duration = +duration;
    const d = ok(await v2.post(`/team/${teamId}/time_entries`, body));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Time entry logged (id: ${d.data?.id}).`);
  },

  async 'time-start'() {
    const taskId = args[1] || flag('task');
    const teamId = flag('team') || W_ID;
    if (!taskId) return console.error('Usage: cu.js time-start <task_id>') || process.exit(1);
    const d = ok(await v2.post(`/team/${teamId}/time_entries/start`, { tid: taskId }));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`▶️   Timer started for task ${taskId}.`);
  },

  async 'time-stop'() {
    const teamId = flag('team') || W_ID;
    const d = ok(await v2.post(`/team/${teamId}/time_entries/stop`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    const e = d.data;
    console.log(`⏹   Timer stopped. Duration: ${ms2dur(+e?.duration || 0)}  Task: ${e?.task?.name || e?.tid || '—'}`);
  },

  async 'time-current'() {
    const teamId = flag('team') || W_ID;
    const d = ok(await v2.get(`/team/${teamId}/time_entries/current`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    if (!d.data) return console.log('⏹   No timer running.');
    const e = d.data;
    const elapsed = Date.now() - +e.start;
    console.log(`▶️   Timer running: "${e.task?.name || e.tid}"  elapsed: ${ms2dur(elapsed)}`);
  },

  async 'time-in-status'() {
    const taskId = args[1];
    if (!taskId) return console.error('Usage: cu.js time-in-status <task_id>') || process.exit(1);
    const d = ok(await v2.get(`/task/${taskId}/time_in_status`, customQs(taskId)));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    const cur = d.current_status;
    if (cur) console.log(`📍 Current: "${cur.status}"  for ${ms2dur((cur.total_time?.by_minute || 0) * 60000)}`);
    for (const entry of d.status_history || []) {
      const dur = ms2dur((entry.total_time?.by_minute || 0) * 60000);
      console.log(`   ${entry.status}: ${dur}`);
    }
  },

  async 'time-in-status-bulk'() {
    const taskIds = args.slice(1).filter(a => !a.startsWith('--'));
    if (!taskIds.length) return console.error('Usage: cu.js time-in-status-bulk <id1> <id2> ...') || process.exit(1);
    const qs = { 'task_ids[]': taskIds };
    const d = ok(await v2.get('/task/bulk_time_in_status/task_ids', qs));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const [taskId, info] of Object.entries(d)) {
      console.log(`\n🔹 Task ${taskId}:`);
      if (info.current_status) console.log(`   Current: "${info.current_status.status}"`);
      for (const [status, data] of Object.entries(info.status_history || {})) {
        const dur = ms2dur((data.total_time?.by_minute || 0) * 60000);
        console.log(`   ${status}: ${dur}  (task ${taskId})`);
      }
    }
  },

  // ── Members ───────────────────────────────────────────────────────────────
  async members() {
    const teamId = args[1] || W_ID;
    // Members are embedded in the GET /team response
    const d = ok(await v2.get('/team'));
    const team = (d.teams || []).find(t => String(t.id) === String(teamId)) || d.teams?.[0];
    if (!team) return console.error(`Team ${teamId} not found.`);
    if (RAW) return console.log(JSON.stringify(team.members, null, 2));
    for (const m of team.members || []) {
      const u = m.user;
      console.log(`👤  ${u.username || u.email}  (id: ${u.id}  email: ${u.email})`);
    }
  },

  async 'find-member'() {
    const query  = (args[1] || flag('name') || '').toLowerCase();
    if (!query) return console.error('Usage: cu.js find-member <name_or_email>') || process.exit(1);
    const d = ok(await v2.get('/team'));
    const team = (d.teams || []).find(t => String(t.id) === String(W_ID)) || d.teams?.[0];
    if (!team) return console.error('No team found.');
    const found = (team.members || []).filter(m => {
      const u = m.user;
      return (u.username || '').toLowerCase().includes(query) ||
             (u.email    || '').toLowerCase().includes(query);
    });
    if (!found.length) return console.log('No matching members found.');
    if (RAW) return console.log(JSON.stringify(found, null, 2));
    for (const m of found) {
      const u = m.user;
      console.log(`👤  ${u.username || u.email}  (id: ${u.id}  email: ${u.email})`);
    }
  },

  // ── Search ────────────────────────────────────────────────────────────────
  async search() {
    const query  = args[1];
    const teamId = W_ID;
    const qs = {
      query,
      include_closed: flag('closed') ? 'true' : undefined,
      page:           flag('page', '0'),
      'statuses[]':   flag('status') ? [flag('status')] : undefined,
      'tags[]':       flags('tag').length ? flags('tag') : undefined,
      task_type:      flag('type') || undefined,
    };
    if (!query) return console.error('Usage: cu.js search "<query>" [--status=...] [--tag=...] [--type=...] [--closed]') || process.exit(1);
    const d = ok(await v2.get(`/team/${teamId}/task`, qs));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    const tasks = d.tasks || [];
    console.log(`Found ${tasks.length} task(s) matching "${query}":\n`);
    for (const t of tasks) console.log(fmtTask(t) + '\n');
  },

  // ── Workspace Hierarchy ───────────────────────────────────────────────────
  async hierarchy() {
    const teamId = args[1] || W_ID;
    console.log(`\n🏢  Workspace ${teamId}\n`);
    const spacesRes = ok(await v2.get(`/team/${teamId}/space`, { archived: 'false' }));
    for (const space of spacesRes.spaces || []) {
      console.log(`${fmtSpace(space)}`);
      // Folders
      const foldersRes = ok(await v2.get(`/space/${space.id}/folder`, { archived: 'false' }));
      for (const folder of foldersRes.folders || []) {
        console.log(`  ${fmtFolder(folder)}`);
        const listsRes = ok(await v2.get(`/folder/${folder.id}/list`, { archived: 'false' }));
        for (const list of listsRes.lists || []) console.log(`    ${fmtList(list)}`);
      }
      // Folderless lists
      const listsRes = ok(await v2.get(`/space/${space.id}/list`, { archived: 'false' }));
      for (const list of listsRes.lists || []) console.log(`  ${fmtList(list)}`);
      console.log('');
    }
  },

  // ── Chat (v3) ─────────────────────────────────────────────────────────────
  async 'chat-channels'() {
    const d = ok(await v3.get(`/workspaces/${W_ID}/chat/channels`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const c of d.data || d.channels || []) {
      const name = c.name || (c.type === 'DM' ? `DM (creator: ${c.creator})` : c.id);
      console.log(`💬  ${name}  (id: ${c.id}  type: ${c.type || '—'}  visibility: ${c.visibility || '—'})`);
    }
  },

  async 'chat-send'() {
    const channelId = args[1] || flag('channel');
    const content   = flag('text') || flag('message');
    if (!channelId || !content) return console.error('Usage: cu.js chat-send <channel_id> --text="..."') || process.exit(1);
    const d = ok(await v3.post(`/workspaces/${W_ID}/chat/channels/${channelId}/messages`, { content }));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    console.log(`✅  Message sent (id: ${d.data?.id || d.id}).`);
  },

  // ── Docs (v3) ─────────────────────────────────────────────────────────────
  async docs() {
    const qs = { query: flag('query') || undefined };
    const d = ok(await v3.get(`/workspaces/${W_ID}/docs`, qs));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    for (const doc of d.data?.docs || d.docs || []) {
      console.log(`📄  ${doc.name || doc.title}  (id: ${doc.id})`);
    }
  },

  async 'create-doc'() {
    const name = flag('name') || flag('title');
    if (!name) return console.error('Usage: cu.js create-doc --name="..." [--space=<space_id>]') || process.exit(1);
    const body = {
      name,
      parent: flag('space')  ? { id: flag('space'),  type: 4 } :
              flag('folder') ? { id: flag('folder'), type: 5 } :
              flag('list')   ? { id: flag('list'),   type: 6 } : undefined,
    };
    if (!body.parent) delete body.parent;
    const d = ok(await v3.post(`/workspaces/${W_ID}/docs`, body));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    const doc = d.data || d;
    console.log(`✅  Doc created: ${doc.id}  "${doc.name || doc.title}"`);
  },

  async 'get-doc'() {
    const docId = args[1];
    if (!docId) return console.error('Usage: cu.js get-doc <doc_id>') || process.exit(1);
    const d = ok(await v3.get(`/workspaces/${W_ID}/docs/${docId}`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    const doc = d.data || d;
    console.log(`📄  ${doc.name || doc.title}  (id: ${doc.id})`);
  },

  async 'doc-page-list'() {
    const docId = args[1];
    if (!docId) return console.error('Usage: cu.js doc-page-list <doc_id>') || process.exit(1);
    const d = ok(await v3.get(`/workspaces/${W_ID}/docs/${docId}/page_listing`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    function printPages(pages, indent = '') {
      for (const p of pages || []) {
        console.log(`${indent}📃  ${p.name}  (id: ${p.id})`);
        if (p.pages?.length) printPages(p.pages, indent + '  ');
      }
    }
    const pages = Array.isArray(d) ? d : d.data?.pages || d.pages || [];
    printPages(pages);
  },

  async 'doc-pages'() {
    const docId = args[1];
    if (!docId) return console.error('Usage: cu.js doc-pages <doc_id>') || process.exit(1);
    const d = ok(await v3.get(`/workspaces/${W_ID}/docs/${docId}/pages`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    const pages = Array.isArray(d) ? d : d.data?.pages || d.pages || [];
    for (const p of pages) {
      console.log(`📃  ${p.name}  (id: ${p.id})`);
      if (p.content) console.log(`    ${p.content.substring(0, 120).replace(/\n/g, ' ')}...`);
    }
  },

  async 'get-doc-page'() {
    const docId  = args[1];
    const pageId = args[2];
    if (!docId || !pageId) return console.error('Usage: cu.js get-doc-page <doc_id> <page_id>') || process.exit(1);
    const d = ok(await v3.get(`/workspaces/${W_ID}/docs/${docId}/pages/${pageId}`));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    const p = d.data || d;
    console.log(`📃  ${p.name}  (id: ${p.id})\n`);
    console.log(p.content || '(no content)');
  },

  async 'create-page'() {
    const docId   = args[1];
    const name    = flag('name') || flag('title');
    const content = flag('content');
    if (!docId || !name) return console.error('Usage: cu.js create-page <doc_id> --name="..." [--content="..."] [--parent-page=<id>]') || process.exit(1);
    const body = {
      name,
      content:       content || undefined,
      parent_page_id: flag('parent-page') || undefined,
    };
    Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
    const d = ok(await v3.post(`/workspaces/${W_ID}/docs/${docId}/pages`, body));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    const p = d.data || d;
    console.log(`✅  Page created: ${p.id}  "${p.name}"`);
  },

  async 'update-page'() {
    const docId   = args[1];
    const pageId  = args[2];
    const content = flag('content');
    const name    = flag('name');
    const mode    = flag('mode');
    if (!docId || !pageId) return console.error('Usage: cu.js update-page <doc_id> <page_id> [--name=...] [--content="..."] [--mode=replace|append|prepend]') || process.exit(1);
    const body = {};
    if (name)    body.name    = name;
    if (content) body.content = content;
    if (mode)    body.content_edit_mode = mode;
    const d = ok(await v3.put(`/workspaces/${W_ID}/docs/${docId}/pages/${pageId}`, body));
    if (RAW) return console.log(JSON.stringify(d, null, 2));
    const p = d.data || d;
    console.log(`✅  Page updated: ${p.id || pageId}.`);
  },

  // ── Help ──────────────────────────────────────────────────────────────────
  help() {
    const groups = {
      'Workspace':     ['teams', 'spaces', 'hierarchy'],
      'Folders':       ['folders', 'get-folder', 'create-folder', 'update-folder', 'delete-folder'],
      'Lists':         ['lists', 'folder-lists', 'get-list', 'statuses', 'custom-fields', 'create-list', 'create-space-list', 'update-list', 'delete-list'],
      'Tasks':         ['tasks', 'task', 'create', 'bulk-create', 'update', 'bulk-update', 'delete-task', 'search'],
      'Task actions':  ['move-task', 'add-to-list', 'remove-from-list', 'add-tag', 'remove-tag', 'set-field'],
      'Relationships': ['add-link', 'remove-link', 'add-dep', 'remove-dep'],
      'Comments':      ['comments', 'comment', 'threaded-comments', 'reply'],
      'Members':       ['members', 'find-member'],
      'Time tracking': ['time-entries', 'time-log', 'time-start', 'time-stop', 'time-current', 'time-in-status', 'time-in-status-bulk'],
      'Chat (v3)':     ['chat-channels', 'chat-send'],
      'Docs (v3)':     ['docs', 'create-doc', 'get-doc', 'doc-page-list', 'doc-pages', 'get-doc-page', 'create-page', 'update-page'],
      'Tags':          ['tags'],
    };
    console.log('Usage: node cu.js <command> [args] [--flags]\n');
    for (const [group, cmds] of Object.entries(groups)) {
      console.log(`${group}:`);
      console.log('  ' + cmds.join('  '));
    }
    console.log('\nGlobal flags: --token=<key>  --team=<id>  --workspace=<id>  --raw');
    console.log('Env: CLICKUP_API_KEY (required), CLICKUP_TEAM_ID (needed when the token sees more than one workspace)');
  },
};

// With no --team or CLICKUP_TEAM_ID, use the token's workspace when it has exactly one.
async function resolveWorkspace() {
  if (W_ID) return;
  const teams = ok(await v2.get('/team')).teams || [];
  if (teams.length === 1) { W_ID = String(teams[0].id); return; }
  console.error(teams.length
    ? '❌  This token can see more than one workspace. Set CLICKUP_TEAM_ID or pass --team=<id>:'
    : '❌  This token can\'t see any workspaces.');
  for (const t of teams) console.error(`    ${t.name}  (id: ${t.id})`);
  process.exit(1);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
if (!cmd || cmd === '--help' || cmd === 'help') {
  commands.help();
  process.exit(0);
}

const fn = commands[cmd];
if (!fn) {
  console.error(`❌  Unknown command: "${cmd}"`);
  console.error('Run `node cu.js help` to see all commands.');
  process.exit(1);
}

(cmd === 'teams' ? Promise.resolve() : resolveWorkspace()).then(fn).catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
