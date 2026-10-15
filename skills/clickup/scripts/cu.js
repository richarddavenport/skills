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
 *         node cu.js <command> ... --dry-run    # print a write request instead of sending it
 */

const https  = require('https');
const fs     = require('fs');
const crypto = require('crypto');
const path   = require('path');
const args   = process.argv.slice(2);
const cmd    = args[0];

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

const TOKEN   = flag('token') || process.env.CLICKUP_API_KEY;
const RAW     = flag('raw') !== null;
const DRY_RUN = flag('dry-run') !== null;
let   W_ID    = flag('team') || flag('workspace') || process.env.CLICKUP_TEAM_ID || null;

// ── HTTP ──────────────────────────────────────────────────────────────────────
// A multipart/form-data body, for file uploads.
class Multipart {
  constructor() { this.parts = []; }
  field(name, value) { this.parts.push({ name, value: String(value) }); return this; }
  file(name, filePath) {
    this.parts.push({ name, filename: path.basename(filePath), data: fs.readFileSync(filePath) });
    return this;
  }
  encode() {
    const boundary = `----cujs${crypto.randomBytes(12).toString('hex')}`;
    const chunks = [];
    for (const p of this.parts) {
      const disposition = `Content-Disposition: form-data; name="${p.name}"` +
        (p.filename ? `; filename="${p.filename}"\r\nContent-Type: application/octet-stream` : '');
      chunks.push(Buffer.from(`--${boundary}\r\n${disposition}\r\n\r\n`), p.data || Buffer.from(p.value), Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
  }
}

// An application/x-www-form-urlencoded body.
class Form {
  constructor(fields) { this.fields = fields; }
  encode() {
    return { payload: new URLSearchParams(this.fields).toString(), contentType: 'application/x-www-form-urlencoded' };
  }
}

function encodeBody(body) {
  if (body == null) return { payload: null, contentType: 'application/json' };
  if (body instanceof Multipart || body instanceof Form) return body.encode();
  return { payload: JSON.stringify(body), contentType: 'application/json' };
}

function send(method, fullPath, payload, contentType) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.clickup.com',
      path: fullPath,
      method,
      headers: {
        ...(TOKEN ? { Authorization: TOKEN } : {}),
        'Content-Type': contentType,
        Accept: 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ClickUp's X-RateLimit-Reset is a Unix timestamp.
function rateLimitReset(headers = {}) {
  const reset = Number(headers['x-ratelimit-reset']);
  if (!reset) return null;
  return new Date(reset > 1e12 ? reset : reset * 1000);
}

const RATE_LIMIT_RETRIES  = 3;
const RATE_LIMIT_MAX_WAIT = 90_000;

async function request(method, version, path, body = null, qs = {}) {
  const query = Object.entries(qs)
    .filter(([, v]) => v != null && v !== false && v !== '')
    .flatMap(([k, v]) => Array.isArray(v) ? v.map(i => `${k}=${encodeURIComponent(i)}`) : [`${k}=${encodeURIComponent(v)}`])
    .join('&');
  const fullPath = `/api/${version}${path}${query ? '?' + query : ''}`;
  const { payload, contentType } = encodeBody(body);

  if (DRY_RUN && method !== 'GET') {
    console.log(`🧪  Dry run. Nothing was sent.\n    ${method} https://api.clickup.com${fullPath}`);
    if (body instanceof Multipart) {
      for (const p of body.parts) console.log(`    ${p.name}: ${p.filename ? `${p.filename} (${p.data.length} bytes)` : p.value}`);
    } else if (body instanceof Form) {
      console.log(`    ${payload}`);
    } else if (body != null) {
      console.log(JSON.stringify(body, null, 2).replace(/^/gm, '    '));
    }
    process.exit(0);
  }

  for (let attempt = 1; ; attempt++) {
    const res = await send(method, fullPath, payload, contentType);
    if (res.status !== 429 || attempt > RATE_LIMIT_RETRIES) return res;
    const reset = rateLimitReset(res.headers);
    const wait  = reset ? Math.max(1000, reset - Date.now() + 1000) : 60_000;
    if (wait > RATE_LIMIT_MAX_WAIT) return res;
    console.error(`⏳  Rate limit reached (${res.headers['x-ratelimit-limit'] || '?'} requests a minute). Waiting ${Math.ceil(wait / 1000)}s, then retrying (${attempt} of ${RATE_LIMIT_RETRIES}).`);
    await new Promise(r => setTimeout(r, wait));
  }
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
    const reset = res.status === 429 && rateLimitReset(res.headers);
    if (reset) console.error(`    The rate limit resets at ${reset.toLocaleTimeString()}.`);
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
function fmtUser(u)   { return `👤  ${u.username || u.email}  (id: ${u.id}  email: ${u.email})`; }
function fmtComment(c) {
  const who  = c.user?.username || c.user?.email || 'unknown';
  const when = new Date(+c.date).toLocaleString();
  return `💬  ${who}  [${when}]  (id: ${c.id})\n    ${c.comment_text}\n`;
}
function fmtFields(fields) {
  return (fields || []).map(f => {
    const opts = f.type_config?.options || f.type_config?.new_drop_down?.options || [];
    return [`🔧  ${f.name}  (id: ${f.id}  type: ${f.type})`, ...opts.filter(o => o.name).map(o => `     - ${o.name} (${o.id})`)].join('\n');
  }).join('\n');
}
function fmtChatMessage(m) {
  const when = m.date ? new Date(+m.date).toLocaleString() : '—';
  return `💬  ${m.user_id || m.userId || 'unknown'}  [${when}]  (id: ${m.id})\n    ${m.content || ''}\n`;
}
function ms2dur(ms)   {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// Formats each item of the response's array under `key` (or its first array, when the
// key isn't there) with `fmt`, or says there were none.
function listOf(key, fmt, empty = 'None found.') {
  return d => {
    const items = d?.[key] || Object.values(d || {}).find(Array.isArray) || [];
    return items.length ? items.map(fmt).join('\n') : empty;
  };
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
    if (d.fields?.length) console.log(fmtFields(d.fields));
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
    for (const c of d.comments || []) console.log(fmtComment(c));
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

  // ── Checklists ────────────────────────────────────────────────────────────
  async checklists() {
    const taskId = args[1];
    if (!taskId) return console.error('Usage: cu.js checklists <task_id>') || process.exit(1);
    const d = ok(await v2.get(`/task/${taskId}`, customQs(taskId)));
    if (RAW) return console.log(JSON.stringify(d.checklists || [], null, 2));
    if (!d.checklists?.length) return console.log('No checklists.');
    for (const c of d.checklists) {
      console.log(`☑️   ${c.name}  (id: ${c.id})  ${c.resolved}/${c.resolved + c.unresolved} done`);
      const printItems = (items, indent) => [...items]
        .sort((a, b) => a.orderindex - b.orderindex)
        .forEach(i => {
          console.log(`${indent}${i.resolved ? '✅' : '⬜'} ${i.name}  (id: ${i.id})`);
          printItems(i.children || [], indent + '   ');
        });
      printItems(c.items || [], '   ');
    }
  },

  // ── Any endpoint ──────────────────────────────────────────────────────────
  async api() {
    const method = (args[1] || '').toUpperCase();
    const match  = (args[2] || '').match(/^\/(?:api\/)?(v[23])(\/.*)$/);
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !match) {
      return console.error('Usage: cu.js api <GET|POST|PUT|PATCH|DELETE> </v2/...|/v3/...> [--body=\'{json}\'] [--query=\'a=1&b=2\']') || process.exit(1);
    }
    const apiPath = match[2].replace(/\{(team_id|workspace_id)\}/g, W_ID);
    const qs = {};
    for (const [k, v] of new URLSearchParams(flag('query') || '')) qs[k] = k in qs ? [].concat(qs[k], v) : v;
    const body = flag('body') ? JSON.parse(flag('body')) : null;
    const d = ok(await request(method, match[1], apiPath, body, qs));
    console.log(JSON.stringify(d, null, 2));
  },

  // ── Help ──────────────────────────────────────────────────────────────────
  help() {
    const topic = endpoints[args[1]];
    if (topic) return console.log(`${topic.d}\n\nUsage: ${usage(args[1], topic)}\n\n${topic.m} /api/v${topic.v}${topic.p}`);
    const groups = {
      'Workspace':     ['teams', 'spaces', 'hierarchy'],
      'Folders':       ['folders', 'get-folder', 'create-folder', 'update-folder', 'delete-folder'],
      'Lists':         ['lists', 'folder-lists', 'get-list', 'statuses', 'custom-fields', 'create-list', 'create-space-list', 'update-list', 'delete-list'],
      'Tasks':         ['tasks', 'task', 'create', 'bulk-create', 'update', 'bulk-update', 'delete-task', 'search'],
      'Task actions':  ['move-task', 'add-to-list', 'remove-from-list', 'add-tag', 'remove-tag', 'set-field'],
      'Relationships': ['add-link', 'remove-link', 'add-dep', 'remove-dep'],
      'Checklists':    ['checklists'],
      'Comments':      ['comments', 'comment', 'threaded-comments', 'reply'],
      'Members':       ['members', 'find-member'],
      'Time tracking': ['time-entries', 'time-log', 'time-start', 'time-stop', 'time-current', 'time-in-status', 'time-in-status-bulk'],
      'Chat (v3)':     ['chat-channels', 'chat-send'],
      'Docs (v3)':     ['docs', 'create-doc', 'get-doc', 'doc-page-list', 'doc-pages', 'get-doc-page', 'create-page', 'update-page'],
      'Tags':          ['tags'],
    };
    for (const [name, e] of Object.entries(endpoints)) (groups[e.g] ||= []).push(name);
    groups['Any endpoint'] = ['api'];
    console.log('Usage: node cu.js <command> [args] [--flags]\n');
    for (const [group, cmds] of Object.entries(groups)) {
      console.log(`${group}:`);
      console.log('  ' + cmds.join('  '));
    }
    console.log('\nGlobal flags: --token=<key>  --team=<id>  --workspace=<id>  --raw  --dry-run  --body=<json>');
    console.log('Env: CLICKUP_API_KEY (required), CLICKUP_TEAM_ID (needed when the token sees more than one workspace)');
    console.log('Run `node cu.js help <command>` for a command\'s usage and endpoint.');
  },
};

// ── Endpoint commands ─────────────────────────────────────────────────────────
// One command per endpoint. Positional args fill the path's {placeholders} in order,
// except {team_id} and {workspace_id}, which come from the workspace.
//
// `query` and `body` map each API field to a type, read from the flag of the same
// name in kebab-case unless `flag` names another:
//   string, int, bool, json, nullable ("null" sends null)   one flag
//   ints, strings                                          repeatable or comma-separated
//   names                                                  repeatable, sent as [{ name }]
//   workspace                                              the workspace ID, no flag
// `need` lists required flags. `file` uploads the path given after the IDs, under that
// form field name. `defaults` come before the flags and `fixed` after them. `wrap`
// nests the flag fields under one key. `build(a)` adds fields made from several flags,
// or returns the whole body when it's an array. --body='{json}' merges into any body,
// or replaces it with an array. Without `out`, a command prints the JSON response.
const done = msg => () => `✅  ${msg}`;
const fmtPerson = x => `👤  ${x.username || x.name || x.email || x.id}  (id: ${x.id})`;
const created = what => d => `✅  ${what} created: ${d.data?.id || d.id}${d.name ? `  "${d.name}"` : ''}`;
const viewList = listOf('views', x => `👁   ${x.name}  (id: ${x.id}  type: ${x.type})`, 'No views.');
const viewCreated = d => `✅  View created: ${d.view?.id}  "${d.view?.name}"`;
const viewBody = { name: 'string', type: 'string' };
const guestPerms = {
  can_edit_tags: 'bool', can_see_time_spent: 'bool', can_see_time_estimated: 'bool',
  can_create_views: 'bool', can_see_points_estimated: 'bool', custom_role_id: 'int',
};
const commentText = { type: 'string', flag: 'text' };
const notify = { type: 'bool', flag: 'notify' };
const page = { cursor: 'string', limit: 'int' };
const chatMessage = { cursor: 'string', limit: 'int', content_format: 'string' };
const trackedTime = { start: 'int', end: 'int', time: 'int' };
const timeEntryIncludes = {
  include_task_tags: 'bool', include_location_names: 'bool', include_approval_history: 'bool', include_approval_details: 'bool',
};

// --estimate=<user_id|unassigned>:<ms>, repeatable.
function timeEstimates() {
  return flags('estimate').map(s => {
    const [assignee, time] = s.split(':');
    return { assignee: assignee === 'unassigned' ? assignee : +assignee, time: +time };
  });
}

// --space=<id>, --folder=<id> or --list=<id>.
function channelLocation() {
  const [type, id] = [['space', flag('space')], ['folder', flag('folder')], ['list', flag('list')]].find(([, v]) => v) || [];
  return type ? { location: { type, id } } : {};
}

const endpoints = {
  // Attachments
  'attach':            { g: 'Attachments', m: 'POST', v: 2, p: '/task/{task_id}/attachment', file: 'attachment', d: 'Upload a file to a task', out: d => `✅  Attached: ${d.title || d.id}${d.url ? `  ${d.url}` : ''}` },
  'attachments':       { g: 'Attachments', m: 'GET', v: 3, p: '/workspaces/{workspace_id}/{entity_type}/{entity_id}/attachments', query: page, d: 'List attachments on a task or a Files custom field (entity type is tasks or custom_fields)', out: listOf('data', x => `📎  ${x.title || x.name || x.id}  (id: ${x.id})${x.url ? `  ${x.url}` : ''}`, 'No attachments.') },
  'upload-attachment': { g: 'Attachments', m: 'POST', v: 3, p: '/workspaces/{workspace_id}/{entity_type}/{entity_id}/attachments', file: 'attachment', body: { filename: 'string' }, d: 'Upload a file to a task or a Files custom field (entity type is tasks or custom_fields)' },

  // Authorization
  'me':          { g: 'Workspace', m: 'GET', v: 2, p: '/user', d: 'Show the user the token belongs to', out: d => fmtUser(d.user || {}) },
  'oauth-token': { g: 'Workspace', m: 'POST', v: 2, p: '/oauth/token', form: true, body: { client_id: 'string', client_secret: 'string', code: 'string' }, need: ['client-id', 'client-secret', 'code'], d: 'Exchange an OAuth code for an access token' },

  // Workspace
  'seats':  { g: 'Workspace', m: 'GET', v: 2, p: '/team/{team_id}/seats', d: 'Show used and available seats' },
  'plan':   { g: 'Workspace', m: 'GET', v: 2, p: '/team/{team_id}/plan', d: "Show the workspace's plan", out: d => `💳  ${d.plan_name}  (id: ${d.plan_id})` },
  'shared': { g: 'Workspace', m: 'GET', v: 2, p: '/team/{team_id}/shared', d: 'List the tasks, lists and folders shared with you' },
  'roles':  { g: 'Workspace', m: 'GET', v: 2, p: '/team/{team_id}/customroles', query: { include_members: 'bool' }, d: 'List custom roles', out: listOf('custom_roles', r => `🛡   ${r.name}  (id: ${r.id})`, 'No custom roles.') },

  // Spaces
  'create-space': { g: 'Spaces', m: 'POST', v: 2, p: '/team/{team_id}/space', body: { name: 'string', multiple_assignees: 'bool', features: 'json' }, need: ['name'], d: 'Create a space', out: created('Space') },
  'get-space':    { g: 'Spaces', m: 'GET', v: 2, p: '/space/{space_id}', d: 'Show a space', out: fmtSpace },
  'update-space': { g: 'Spaces', m: 'PUT', v: 2, p: '/space/{space_id}', body: { name: 'string', color: 'string', private: 'bool', admin_can_manage: 'bool', multiple_assignees: 'bool', features: 'json' }, d: 'Update a space', out: done('Space updated.') },
  'delete-space': { g: 'Spaces', m: 'DELETE', v: 2, p: '/space/{space_id}', d: 'Delete a space' },

  // Folders
  'move-folder':                 { g: 'Folders', m: 'PUT', v: 2, p: '/folder/{folder_id}/position', body: { parent_folder_id: { type: 'string', flag: 'parent-folder' }, space_id: { type: 'string', flag: 'space' }, position: 'int', custom_type_map: 'json' }, d: 'Move a folder into another folder, or to another space', out: done('Folder moved.') },
  'create-folder-from-template': { g: 'Folders', m: 'POST', v: 2, p: '/space/{space_id}/folder_template/{template_id}', body: { name: 'string', parent_folder_id: { type: 'string', flag: 'parent-folder' }, options: 'json' }, need: ['name'], d: 'Create a folder from a template', out: created('Folder') },

  // Lists
  'create-list-from-template':       { g: 'Lists', m: 'POST', v: 2, p: '/folder/{folder_id}/list_template/{template_id}', body: { name: 'string', options: 'json' }, need: ['name'], d: 'Create a list in a folder from a template', out: created('List') },
  'create-space-list-from-template': { g: 'Lists', m: 'POST', v: 2, p: '/space/{space_id}/list_template/{template_id}', body: { name: 'string', options: 'json' }, need: ['name'], d: 'Create a folderless list from a template', out: created('List') },

  // Tasks
  'merge-tasks':            { g: 'Tasks', m: 'POST', v: 2, p: '/task/{task_id}/merge', body: { source_task_ids: { type: 'strings', flag: 'source' } }, need: ['source'], noCustomIds: true, d: 'Merge source tasks into a target task (ClickUp task IDs only)', out: done('Tasks merged.') },
  'create-from-template':   { g: 'Tasks', m: 'POST', v: 2, p: '/list/{list_id}/taskTemplate/{template_id}', body: { name: 'string' }, need: ['name'], d: 'Create a task from a template', out: created('Task') },
  'task-types':             { g: 'Tasks', m: 'GET', v: 2, p: '/team/{team_id}/custom_item', d: 'List custom task types', out: listOf('custom_items', t => `🧩  ${t.name}  (id: ${t.id})`, 'No custom task types.') },
  'update-time-estimates':  { g: 'Tasks', m: 'PATCH', v: 3, p: '/workspaces/{workspace_id}/tasks/{task_id}/time_estimates_by_user', build: timeEstimates, d: 'Change time estimates per assignee with --estimate=<user_id|unassigned>:<ms> (Business plan or above)', out: done('Time estimates updated.') },
  'replace-time-estimates': { g: 'Tasks', m: 'PUT', v: 3, p: '/workspaces/{workspace_id}/tasks/{task_id}/time_estimates_by_user', build: timeEstimates, d: 'Replace all time estimates with --estimate=<user_id|unassigned>:<ms> (Business plan or above)', out: done('Time estimates replaced.') },

  // Checklists
  'create-checklist':      { g: 'Checklists', m: 'POST', v: 2, p: '/task/{task_id}/checklist', body: { name: 'string' }, need: ['name'], d: 'Add a checklist to a task', out: d => `✅  Checklist created: ${d.checklist?.id}  "${d.checklist?.name}"` },
  'update-checklist':      { g: 'Checklists', m: 'PUT', v: 2, p: '/checklist/{checklist_id}', body: { name: 'string', position: 'int' }, d: 'Rename or reorder a checklist', out: done('Checklist updated.') },
  'delete-checklist':      { g: 'Checklists', m: 'DELETE', v: 2, p: '/checklist/{checklist_id}', d: 'Delete a checklist' },
  'add-checklist-item':    { g: 'Checklists', m: 'POST', v: 2, p: '/checklist/{checklist_id}/checklist_item', body: { name: 'string', assignee: 'int' }, need: ['name'], d: 'Add an item to a checklist', out: d => {
    const item = (d.checklist?.items || []).filter(i => i.name === flag('name')).pop();
    return `✅  Item added: ${item?.id || '?'}  "${flag('name')}"`;
  } },
  'update-checklist-item': { g: 'Checklists', m: 'PUT', v: 2, p: '/checklist/{checklist_id}/checklist_item/{checklist_item_id}', body: { name: 'string', assignee: 'nullable', resolved: 'bool', parent: 'nullable' }, d: 'Rename, assign, nest or resolve a checklist item', out: done('Item updated.') },
  'check-item':            { g: 'Checklists', m: 'PUT', v: 2, p: '/checklist/{checklist_id}/checklist_item/{checklist_item_id}', fixed: { resolved: true }, d: 'Tick a checklist item off', out: done('Item checked off.') },
  'uncheck-item':          { g: 'Checklists', m: 'PUT', v: 2, p: '/checklist/{checklist_id}/checklist_item/{checklist_item_id}', fixed: { resolved: false }, d: 'Untick a checklist item', out: done('Item unchecked.') },
  'delete-checklist-item': { g: 'Checklists', m: 'DELETE', v: 2, p: '/checklist/{checklist_id}/checklist_item/{checklist_item_id}', d: 'Delete a checklist item' },

  // Comments
  'update-comment':      { g: 'Comments', m: 'PUT', v: 2, p: '/comment/{comment_id}', body: { comment_text: commentText, assignee: 'int', group_assignee: 'int', resolved: 'bool' }, d: 'Edit, assign or resolve a comment', out: done('Comment updated.') },
  'delete-comment':      { g: 'Comments', m: 'DELETE', v: 2, p: '/comment/{comment_id}', d: 'Delete a comment' },
  'list-comments':       { g: 'Comments', m: 'GET', v: 2, p: '/list/{list_id}/comment', query: { start: 'int', start_id: 'string' }, d: 'List comments on a list', out: listOf('comments', fmtComment, 'No comments.') },
  'create-list-comment': { g: 'Comments', m: 'POST', v: 2, p: '/list/{list_id}/comment', body: { comment_text: commentText, assignee: 'int', notify_all: notify }, defaults: { notify_all: false }, need: ['text'], d: 'Comment on a list', out: d => `✅  Comment posted (id: ${d.id})` },
  'view-comments':       { g: 'Comments', m: 'GET', v: 2, p: '/view/{view_id}/comment', query: { start: 'int', start_id: 'string' }, d: 'List comments on a chat view', out: listOf('comments', fmtComment, 'No comments.') },
  'create-view-comment': { g: 'Comments', m: 'POST', v: 2, p: '/view/{view_id}/comment', body: { comment_text: commentText, notify_all: notify }, defaults: { notify_all: false }, need: ['text'], d: 'Comment on a chat view', out: d => `✅  Comment posted (id: ${d.id})` },
  'comment-subtypes':    { g: 'Comments', m: 'GET', v: 3, p: '/workspaces/{workspace_id}/comments/types/{comment_type}/subtypes', d: 'List post subtype IDs for a comment type (post, ai, syncup or ai_via_brain)' },

  // Custom fields
  'space-fields':     { g: 'Custom fields', m: 'GET', v: 2, p: '/space/{space_id}/field', query: { include_applied_objects: 'bool' }, d: "List a space's custom fields", out: d => fmtFields(d.fields) || 'None found.' },
  'folder-fields':    { g: 'Custom fields', m: 'GET', v: 2, p: '/folder/{folder_id}/field', query: { include_applied_objects: 'bool' }, d: "List a folder's custom fields", out: d => fmtFields(d.fields) || 'None found.' },
  'workspace-fields': { g: 'Custom fields', m: 'GET', v: 2, p: '/team/{team_id}/field', query: { include_applied_objects: 'bool' }, d: "List the workspace's custom fields", out: d => fmtFields(d.fields) || 'None found.' },
  'clear-field':      { g: 'Custom fields', m: 'DELETE', v: 2, p: '/task/{task_id}/field/{field_id}', d: "Clear a custom field's value on a task", out: done('Field cleared.') },

  // Members
  'task-members': { g: 'Members', m: 'GET', v: 2, p: '/task/{task_id}/member', d: 'List the people who can see a task', out: listOf('members', fmtUser) },
  'list-members': { g: 'Members', m: 'GET', v: 2, p: '/list/{list_id}/member', d: 'List the people who can see a list', out: listOf('members', fmtUser) },

  // Tags
  'create-tag': { g: 'Tags', m: 'POST', v: 2, p: '/space/{space_id}/tag', wrap: 'tag', body: { name: 'string', tag_fg: { type: 'string', flag: 'fg' }, tag_bg: { type: 'string', flag: 'bg' } }, defaults: { tag_fg: '#ffffff', tag_bg: '#7b68ee' }, need: ['name'], d: 'Create a tag in a space (--fg and --bg are hex colors)', out: done('Tag created.') },
  'update-tag': { g: 'Tags', m: 'PUT', v: 2, p: '/space/{space_id}/tag/{tag_name}', wrap: 'tag', body: { name: 'string', tag_fg: { type: 'string', flag: 'fg' }, tag_bg: { type: 'string', flag: 'bg' } }, d: "Rename a tag or change its colors", out: done('Tag updated.') },
  'delete-tag': { g: 'Tags', m: 'DELETE', v: 2, p: '/space/{space_id}/tag/{tag_name}', fixed: a => ({ tag: { name: a.tag_name } }), d: 'Delete a tag from a space' },

  // Templates
  'task-templates':   { g: 'Templates', m: 'GET', v: 2, p: '/team/{team_id}/taskTemplate', query: { page: 'int' }, queryDefaults: { page: 0 }, d: 'List task templates', out: listOf('templates', t => `📐  ${t.name}  (id: ${t.id})`, 'No task templates.') },
  'list-templates':   { g: 'Templates', m: 'GET', v: 2, p: '/team/{team_id}/list_template', d: 'List list templates', out: listOf('templates', t => `📐  ${t.name}  (id: ${t.id})`, 'No list templates.') },
  'folder-templates': { g: 'Templates', m: 'GET', v: 2, p: '/team/{team_id}/folder_template', d: 'List folder templates', out: listOf('templates', t => `📐  ${t.name}  (id: ${t.id})`, 'No folder templates.') },

  // Time tracking
  'time-entry':          { g: 'Time tracking', m: 'GET', v: 2, p: '/team/{team_id}/time_entries/{timer_id}', query: timeEntryIncludes, d: 'Show one time entry' },
  'update-time-entry':   { g: 'Time tracking', m: 'PUT', v: 2, p: '/team/{team_id}/time_entries/{timer_id}', body: { description: 'string', tags: 'json', tag_action: 'string', start: 'int', end: 'int', tid: { type: 'string', flag: 'task' }, billable: 'bool', duration: 'int' }, d: 'Update a time entry', out: done('Time entry updated.') },
  'delete-time-entry':   { g: 'Time tracking', m: 'DELETE', v: 2, p: '/team/{team_id}/time_entries/{timer_id}', d: 'Delete a time entry' },
  'time-entry-history':  { g: 'Time tracking', m: 'GET', v: 2, p: '/team/{team_id}/time_entries/{timer_id}/history', d: "Show a time entry's change history" },
  'time-tags':           { g: 'Time tracking', m: 'GET', v: 2, p: '/team/{team_id}/time_entries/tags', d: 'List the tags used on time entries', out: listOf('data', t => `🏷   ${t.name}`, 'No time entry tags.') },
  'add-time-tags':       { g: 'Time tracking', m: 'POST', v: 2, p: '/team/{team_id}/time_entries/tags', body: { time_entry_ids: { type: 'strings', flag: 'entry' }, tags: { type: 'names', flag: 'tag' } }, need: ['entry', 'tag'], d: 'Tag time entries', out: done('Tags added.') },
  'remove-time-tags':    { g: 'Time tracking', m: 'DELETE', v: 2, p: '/team/{team_id}/time_entries/tags', body: { time_entry_ids: { type: 'strings', flag: 'entry' }, tags: { type: 'names', flag: 'tag' } }, need: ['entry', 'tag'], d: 'Remove tags from time entries', out: done('Tags removed.') },
  'rename-time-tag':     { g: 'Time tracking', m: 'PUT', v: 2, p: '/team/{team_id}/time_entries/tags', body: { name: 'string', new_name: 'string', tag_bg: { type: 'string', flag: 'bg' }, tag_fg: { type: 'string', flag: 'fg' } }, need: ['name', 'new-name'], d: 'Rename a time entry tag or change its colors', out: done('Tag updated.') },
  'task-time':           { g: 'Time tracking', m: 'GET', v: 2, p: '/task/{task_id}/time', d: 'List time tracked on a task (legacy endpoint)' },
  'track-time':          { g: 'Time tracking', m: 'POST', v: 2, p: '/task/{task_id}/time', body: trackedTime, need: ['start', 'end', 'time'], d: 'Track time on a task (legacy endpoint, times in ms)', out: done('Time tracked.') },
  'update-tracked-time': { g: 'Time tracking', m: 'PUT', v: 2, p: '/task/{task_id}/time/{interval_id}', body: trackedTime, d: 'Edit tracked time on a task (legacy endpoint)', out: done('Tracked time updated.') },
  'delete-tracked-time': { g: 'Time tracking', m: 'DELETE', v: 2, p: '/task/{task_id}/time/{interval_id}', d: 'Delete tracked time from a task (legacy endpoint)' },

  // Goals
  'goals':             { g: 'Goals', m: 'GET', v: 2, p: '/team/{team_id}/goal', query: { include_completed: 'bool' }, d: 'List goals', out: listOf('goals', x => `🎯  ${x.name}  (id: ${x.id})  ${x.percent_completed ?? 0}% done`, 'No goals.') },
  'goal':              { g: 'Goals', m: 'GET', v: 2, p: '/goal/{goal_id}', d: 'Show a goal and its key results' },
  'create-goal':       { g: 'Goals', m: 'POST', v: 2, p: '/team/{team_id}/goal', body: { name: 'string', due_date: { type: 'int', flag: 'due' }, description: 'string', multiple_owners: 'bool', owners: { type: 'ints', flag: 'owner' }, color: 'string' }, need: ['name'], d: 'Create a goal', out: d => `✅  Goal created: ${d.goal?.id}  "${d.goal?.name}"` },
  'update-goal':       { g: 'Goals', m: 'PUT', v: 2, p: '/goal/{goal_id}', body: { name: 'string', due_date: { type: 'int', flag: 'due' }, description: 'string', add_owners: { type: 'ints', flag: 'add-owner' }, rem_owners: { type: 'ints', flag: 'remove-owner' }, color: 'string' }, d: 'Update a goal', out: done('Goal updated.') },
  'delete-goal':       { g: 'Goals', m: 'DELETE', v: 2, p: '/goal/{goal_id}', d: 'Delete a goal' },
  'create-key-result': { g: 'Goals', m: 'POST', v: 2, p: '/goal/{goal_id}/key_result', body: { name: 'string', owners: { type: 'ints', flag: 'owner' }, type: 'string', steps_start: 'int', steps_end: 'int', unit: 'string', task_ids: { type: 'strings', flag: 'task' }, list_ids: { type: 'strings', flag: 'list' } }, need: ['name', 'type'], d: 'Add a key result to a goal (type is number, currency, boolean, percentage or automatic)', out: d => `✅  Key result created: ${d.key_result?.id}` },
  'update-key-result': { g: 'Goals', m: 'PUT', v: 2, p: '/key_result/{key_result_id}', body: { steps_current: 'int', note: 'string' }, d: 'Record progress on a key result', out: done('Key result updated.') },
  'delete-key-result': { g: 'Goals', m: 'DELETE', v: 2, p: '/key_result/{key_result_id}', d: 'Delete a key result' },

  // Views
  'views':              { g: 'Views', m: 'GET', v: 2, p: '/team/{team_id}/view', d: 'List Everything-level views', out: viewList },
  'space-views':        { g: 'Views', m: 'GET', v: 2, p: '/space/{space_id}/view', d: "List a space's views", out: viewList },
  'folder-views':       { g: 'Views', m: 'GET', v: 2, p: '/folder/{folder_id}/view', d: "List a folder's views", out: viewList },
  'list-views':         { g: 'Views', m: 'GET', v: 2, p: '/list/{list_id}/view', d: "List a list's views", out: viewList },
  'view':               { g: 'Views', m: 'GET', v: 2, p: '/view/{view_id}', d: 'Show a view and its settings' },
  'view-tasks':         { g: 'Views', m: 'GET', v: 2, p: '/view/{view_id}/task', query: { page: 'int' }, queryDefaults: { page: 0 }, d: 'List the tasks in a view', out: d => (d.tasks || []).map(fmtTask).join('\n\n') || 'No tasks.' },
  'create-view':        { g: 'Views', m: 'POST', v: 2, p: '/team/{team_id}/view', body: viewBody, need: ['name', 'type'], d: 'Create an Everything-level view (type is list, board, calendar, gantt and so on; pass settings with --body)', out: viewCreated },
  'create-space-view':  { g: 'Views', m: 'POST', v: 2, p: '/space/{space_id}/view', body: viewBody, need: ['name', 'type'], d: 'Create a view on a space', out: viewCreated },
  'create-folder-view': { g: 'Views', m: 'POST', v: 2, p: '/folder/{folder_id}/view', body: viewBody, need: ['name', 'type'], d: 'Create a view on a folder', out: viewCreated },
  'create-list-view':   { g: 'Views', m: 'POST', v: 2, p: '/list/{list_id}/view', body: viewBody, need: ['name', 'type'], d: 'Create a view on a list', out: viewCreated },
  'update-view':        { g: 'Views', m: 'PUT', v: 2, p: '/view/{view_id}', body: viewBody, d: 'Update a view (pass settings with --body)', out: done('View updated.') },
  'delete-view':        { g: 'Views', m: 'DELETE', v: 2, p: '/view/{view_id}', d: 'Delete a view' },

  // Webhooks
  'webhooks':       { g: 'Webhooks', m: 'GET', v: 2, p: '/team/{team_id}/webhook', d: 'List webhooks', out: listOf('webhooks', w => `🪝  ${w.endpoint}  (id: ${w.id}  status: ${w.health?.status || w.status || '—'})  events: ${(w.events || []).join(', ')}`, 'No webhooks.') },
  'create-webhook': { g: 'Webhooks', m: 'POST', v: 2, p: '/team/{team_id}/webhook', body: { endpoint: 'string', events: { type: 'strings', flag: 'event' }, space_id: { type: 'int', flag: 'space' }, folder_id: { type: 'int', flag: 'folder' }, list_id: { type: 'int', flag: 'list' }, task_id: { type: 'string', flag: 'task' } }, need: ['endpoint', 'event'], d: 'Create a webhook (--event is repeatable; * means every event)', out: d => `✅  Webhook created: ${d.id}${d.webhook?.secret ? `\n    Secret: ${d.webhook.secret}` : ''}` },
  'update-webhook': { g: 'Webhooks', m: 'PUT', v: 2, p: '/webhook/{webhook_id}', body: { endpoint: 'string', events: 'string', status: 'string' }, d: 'Update a webhook', out: done('Webhook updated.') },
  'delete-webhook': { g: 'Webhooks', m: 'DELETE', v: 2, p: '/webhook/{webhook_id}', d: 'Delete a webhook' },

  // User groups
  'groups':       { g: 'User groups', m: 'GET', v: 2, p: '/group', query: { team_id: 'workspace', group_ids: { type: 'strings', flag: 'group' } }, d: 'List user groups', out: listOf('groups', x => `👥  ${x.name}  (id: ${x.id})  ${x.members?.length ?? 0} members`, 'No user groups.') },
  'create-group': { g: 'User groups', m: 'POST', v: 2, p: '/team/{team_id}/group', body: { name: 'string', handle: 'string', members: { type: 'ints', flag: 'member' } }, need: ['name'], d: 'Create a user group', out: created('Group') },
  'update-group': { g: 'User groups', m: 'PUT', v: 2, p: '/group/{group_id}', body: { name: 'string', handle: 'string' }, build: () => {
    const add = flags('add-member').map(Number), rem = flags('remove-member').map(Number);
    return add.length || rem.length ? { members: { add, rem } } : {};
  }, d: 'Rename a user group, or change its members with --add-member and --remove-member', out: done('Group updated.') },
  'delete-group': { g: 'User groups', m: 'DELETE', v: 2, p: '/group/{group_id}', d: 'Delete a user group' },

  // Users (Enterprise)
  'invite-user': { g: 'Users', m: 'POST', v: 2, p: '/team/{team_id}/user', body: { email: 'string', admin: 'bool', custom_role_id: 'int' }, defaults: { admin: false }, need: ['email'], d: 'Invite someone to the workspace (Enterprise)' },
  'user':        { g: 'Users', m: 'GET', v: 2, p: '/team/{team_id}/user/{user_id}', query: { include_shared: 'bool' }, d: 'Show a workspace member (Enterprise)' },
  'update-user': { g: 'Users', m: 'PUT', v: 2, p: '/team/{team_id}/user/{user_id}', body: { username: 'string', admin: 'bool', custom_role_id: 'int' }, d: "Change a member's name, admin flag or role (Enterprise)", out: done('User updated.') },
  'remove-user': { g: 'Users', m: 'DELETE', v: 2, p: '/team/{team_id}/user/{user_id}', d: 'Remove someone from the workspace (Enterprise)' },

  // Guests (Enterprise)
  'invite-guest':             { g: 'Guests', m: 'POST', v: 2, p: '/team/{team_id}/guest', body: { email: 'string', ...guestPerms }, need: ['email'], d: 'Invite a guest to the workspace (Enterprise)' },
  'guest':                    { g: 'Guests', m: 'GET', v: 2, p: '/team/{team_id}/guest/{guest_id}', d: 'Show a guest (Enterprise)' },
  'update-guest':             { g: 'Guests', m: 'PUT', v: 2, p: '/team/{team_id}/guest/{guest_id}', body: guestPerms, d: "Change a guest's permissions (Enterprise)", out: done('Guest updated.') },
  'remove-guest':             { g: 'Guests', m: 'DELETE', v: 2, p: '/team/{team_id}/guest/{guest_id}', d: 'Remove a guest from the workspace (Enterprise)' },
  'add-guest-to-task':        { g: 'Guests', m: 'POST', v: 2, p: '/task/{task_id}/guest/{guest_id}', query: { include_shared: 'bool' }, body: { permission_level: { type: 'string', flag: 'permission' } }, need: ['permission'], d: 'Share a task with a guest (permission is read, comment, edit or create; Enterprise)', out: done('Guest added to task.') },
  'remove-guest-from-task':   { g: 'Guests', m: 'DELETE', v: 2, p: '/task/{task_id}/guest/{guest_id}', query: { include_shared: 'bool' }, d: 'Stop sharing a task with a guest (Enterprise)' },
  'add-guest-to-list':        { g: 'Guests', m: 'POST', v: 2, p: '/list/{list_id}/guest/{guest_id}', query: { include_shared: 'bool' }, body: { permission_level: { type: 'string', flag: 'permission' } }, need: ['permission'], d: 'Share a list with a guest (Enterprise)', out: done('Guest added to list.') },
  'remove-guest-from-list':   { g: 'Guests', m: 'DELETE', v: 2, p: '/list/{list_id}/guest/{guest_id}', query: { include_shared: 'bool' }, d: 'Stop sharing a list with a guest (Enterprise)' },
  'add-guest-to-folder':      { g: 'Guests', m: 'POST', v: 2, p: '/folder/{folder_id}/guest/{guest_id}', query: { include_shared: 'bool' }, body: { permission_level: { type: 'string', flag: 'permission' } }, need: ['permission'], d: 'Share a folder with a guest (Enterprise)', out: done('Guest added to folder.') },
  'remove-guest-from-folder': { g: 'Guests', m: 'DELETE', v: 2, p: '/folder/{folder_id}/guest/{guest_id}', query: { include_shared: 'bool' }, d: 'Stop sharing a folder with a guest (Enterprise)' },

  // Access and audit (v3)
  'update-acl': { g: 'Access and audit (v3)', m: 'PATCH', v: 3, p: '/workspaces/{workspace_id}/{object_type}/{object_id}/acls', body: { private: 'bool' }, d: 'Change who can see an object (pass entries with --body)', out: done('Access updated.') },
  'audit-logs': { g: 'Access and audit (v3)', m: 'POST', v: 3, p: '/workspaces/{workspace_id}/auditlogs', body: { applicability: 'string' }, d: 'Query workspace audit logs (Enterprise; pass filter and pagination with --body)' },

  // Chat (v3)
  'create-channel':          { g: 'Chat (v3)', m: 'POST', v: 3, p: '/workspaces/{workspace_id}/chat/channels', body: { name: 'string', description: 'string', topic: 'string', user_ids: { type: 'strings', flag: 'user' }, visibility: 'string' }, need: ['name'], d: 'Create a channel', out: created('Channel') },
  'create-location-channel': { g: 'Chat (v3)', m: 'POST', v: 3, p: '/workspaces/{workspace_id}/chat/channels/location', body: { description: 'string', topic: 'string', user_ids: { type: 'strings', flag: 'user' }, visibility: 'string' }, build: channelLocation, d: 'Create the channel for a space, folder or list (--space, --folder or --list)', out: created('Channel') },
  'create-dm':               { g: 'Chat (v3)', m: 'POST', v: 3, p: '/workspaces/{workspace_id}/chat/channels/direct_message', body: { user_ids: { type: 'strings', flag: 'user' } }, need: ['user'], d: 'Open a direct message with one or more people', out: created('Direct message') },
  'chat-channel':            { g: 'Chat (v3)', m: 'GET', v: 3, p: '/workspaces/{workspace_id}/chat/channels/{channel_id}', query: { description_format: 'string' }, d: 'Show a channel' },
  'update-channel':          { g: 'Chat (v3)', m: 'PATCH', v: 3, p: '/workspaces/{workspace_id}/chat/channels/{channel_id}', body: { name: 'string', description: 'string', topic: 'string', visibility: 'string', content_format: 'string' }, d: 'Update a channel', out: done('Channel updated.') },
  'delete-channel':          { g: 'Chat (v3)', m: 'DELETE', v: 3, p: '/workspaces/{workspace_id}/chat/channels/{channel_id}', d: 'Delete a channel' },
  'channel-followers':       { g: 'Chat (v3)', m: 'GET', v: 3, p: '/workspaces/{workspace_id}/chat/channels/{channel_id}/followers', query: page, d: "List a channel's followers", out: listOf('data', fmtPerson) },
  'channel-members':         { g: 'Chat (v3)', m: 'GET', v: 3, p: '/workspaces/{workspace_id}/chat/channels/{channel_id}/members', query: page, d: "List a channel's members", out: listOf('data', fmtPerson) },
  'chat-messages':           { g: 'Chat (v3)', m: 'GET', v: 3, p: '/workspaces/{workspace_id}/chat/channels/{channel_id}/messages', query: chatMessage, d: "Read a channel's messages", out: listOf('data', fmtChatMessage, 'No messages.') },
  'update-message':          { g: 'Chat (v3)', m: 'PATCH', v: 3, p: '/workspaces/{workspace_id}/chat/messages/{message_id}', body: { content: commentText, content_format: 'string', assignee: 'string', group_assignee: 'string', resolved: 'bool' }, d: 'Edit, assign or resolve a message', out: done('Message updated.') },
  'delete-message':          { g: 'Chat (v3)', m: 'DELETE', v: 3, p: '/workspaces/{workspace_id}/chat/messages/{message_id}', d: 'Delete a message' },
  'message-replies':         { g: 'Chat (v3)', m: 'GET', v: 3, p: '/workspaces/{workspace_id}/chat/messages/{message_id}/replies', query: chatMessage, d: 'Read the replies to a message', out: listOf('data', fmtChatMessage, 'No replies.') },
  'reply-message':           { g: 'Chat (v3)', m: 'POST', v: 3, p: '/workspaces/{workspace_id}/chat/messages/{message_id}/replies', body: { content: commentText, type: 'string', content_format: 'string', assignee: 'string', group_assignee: 'string', followers: { type: 'strings', flag: 'follower' } }, defaults: { type: 'message' }, need: ['text'], d: 'Reply to a message', out: d => `✅  Reply sent (id: ${d.data?.id || d.id}).` },
  'message-reactions':       { g: 'Chat (v3)', m: 'GET', v: 3, p: '/workspaces/{workspace_id}/chat/messages/{message_id}/reactions', query: page, d: 'List reactions to a message' },
  'react':                   { g: 'Chat (v3)', m: 'POST', v: 3, p: '/workspaces/{workspace_id}/chat/messages/{message_id}/reactions', body: { reaction: 'string' }, need: ['reaction'], d: 'React to a message (--reaction is the emoji name)', out: done('Reaction added.') },
  'unreact':                 { g: 'Chat (v3)', m: 'DELETE', v: 3, p: '/workspaces/{workspace_id}/chat/messages/{message_id}/reactions/{reaction}', d: 'Remove your reaction from a message' },
  'tagged-users':            { g: 'Chat (v3)', m: 'GET', v: 3, p: '/workspaces/{workspace_id}/chat/messages/{message_id}/tagged_users', query: page, d: 'List the people tagged in a message', out: listOf('data', fmtPerson) },
};

const PATH_PARAM       = /\{(\w+)\}/g;
const WORKSPACE_PARAMS = ['team_id', 'workspace_id'];

function fieldSpec(key, s) {
  const { type, flag: name = key.replace(/_/g, '-') } = typeof s === 'string' ? { type: s } : s;
  return { key, type, name };
}

function collect(spec = {}) {
  const out = {};
  for (const [key, s] of Object.entries(spec)) {
    const { type, name } = fieldSpec(key, s);
    if (type === 'workspace') { out[key] = W_ID; continue; }
    if (type === 'ints' || type === 'strings' || type === 'names') {
      const vs = flags(name).flatMap(v => type === 'names' ? [v] : v.split(',')).filter(Boolean);
      if (vs.length) out[key] = type === 'ints' ? vs.map(Number) : type === 'names' ? vs.map(n => ({ name: n })) : vs;
      continue;
    }
    const v = flag(name);
    if (v === null) continue;
    out[key] = type === 'int'      ? +v
             : type === 'bool'     ? v !== 'false'
             : type === 'json'     ? JSON.parse(v)
             : type === 'nullable' ? (v === 'null' ? null : String(v))
             : String(v);
  }
  return out;
}

function pathArgs(e) {
  return [...e.p.matchAll(PATH_PARAM)].map(m => m[1]).filter(n => !WORKSPACE_PARAMS.includes(n));
}

function usage(name, e) {
  const fields = [...Object.entries(e.query || {}), ...Object.entries(e.body || {})]
    .map(([k, s]) => fieldSpec(k, s))
    .filter(f => f.type !== 'workspace');
  const need = e.need || [];
  const fmt = f => `--${f.name}${f.type === 'bool' ? '' : `=<${f.type}>`}`;
  return [
    `cu.js ${name}`,
    ...pathArgs(e).map(n => `<${n}>`),
    ...(e.file ? ['<file>'] : []),
    ...fields.filter(f => need.includes(f.name)).map(fmt),
    ...fields.filter(f => !need.includes(f.name)).map(f => `[${fmt(f)}]`),
  ].join(' ');
}

function runEndpoint(name, e) {
  return async () => {
    const ids   = args.slice(1).filter(x => !x.startsWith('--'));
    const names = pathArgs(e);
    const a     = Object.fromEntries(names.map((n, i) => [n, ids[i]]));
    const file  = e.file ? ids[names.length] : null;
    if (names.some(n => !a[n]) || (e.file && !file) || (e.need || []).some(f => flag(f) === null)) {
      return console.error(`Usage: ${usage(name, e)}`) || process.exit(1);
    }
    const apiPath = e.p.replace(PATH_PARAM, (_, n) => WORKSPACE_PARAMS.includes(n) ? W_ID : encodeURIComponent(a[n]));
    const qs = { ...e.queryDefaults, ...collect(e.query), ...(e.v === 2 && a.task_id && !e.noCustomIds ? customQs(a.task_id) : {}) };

    let body = { ...e.defaults, ...collect(e.body) };
    if (e.wrap) body = { [e.wrap]: body };
    const built = e.build?.(a);
    if (Array.isArray(built)) body = built;
    else Object.assign(body, built, typeof e.fixed === 'function' ? e.fixed(a) : e.fixed);
    if (flag('body')) {
      const extra = JSON.parse(flag('body'));
      body = Array.isArray(extra) ? extra : { ...body, ...extra };
    }

    if (e.file) {
      const form = new Multipart().file(e.file, file);
      for (const [k, v] of Object.entries(body)) form.field(k, typeof v === 'object' ? JSON.stringify(v) : v);
      body = form;
    } else if (e.form) {
      body = new Form(body);
    } else if (e.m === 'GET' || (e.m === 'DELETE' && !Object.keys(body).length)) {
      body = null;
    }

    const d = ok(await request(e.m, `v${e.v}`, apiPath, body, qs));
    if (RAW || (!e.out && e.m !== 'DELETE')) return console.log(JSON.stringify(d, null, 2));
    console.log(e.out ? e.out(d, a) : '✅  Deleted.');
  };
}

for (const [name, e] of Object.entries(endpoints)) {
  if (commands[name]) throw new Error(`Endpoint command "${name}" clashes with a built-in command.`);
  commands[name] = runEndpoint(name, e);
}

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
// Required as a module (by the repo's coverage and docs tools), it only exports.
if (require.main !== module) {
  module.exports = { commands, endpoints, usage };
} else {
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

  if (!TOKEN && cmd !== 'oauth-token') {
    console.error('❌  No API token. Set CLICKUP_API_KEY in your environment, or pass --token=<key>.');
    process.exit(1);
  }

  const needsWorkspace = !['teams', 'me', 'oauth-token'].includes(cmd);
  (needsWorkspace ? resolveWorkspace() : Promise.resolve()).then(fn).catch(err => {
    console.error('❌  Error:', err.message);
    process.exit(1);
  });
}
