import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CU   = join(ROOT, 'skills/clickup/scripts/cu.js');
const STUB = join(ROOT, 'test/stub-api.cjs');
const TMP  = mkdtempSync(join(tmpdir(), 'cu-test-'));
let runs = 0;

// Runs cu.js against the stub API and returns its output and the requests it made.
function cu(args, { responses = [{ status: 200, body: {} }], env = {} } = {}) {
  const log = join(TMP, `requests-${runs++}.jsonl`);
  const result = spawnSync(process.execPath, ['-r', STUB, CU, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLICKUP_API_KEY: 'pk_test', CLICKUP_TEAM_ID: '7', STUB_RESPONSES: JSON.stringify(responses), STUB_LOG: log, ...env },
  });
  const requests = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return { ...result, requests };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

test('finds the workspace when the token can see only one', () => {
  const r = cu(['spaces'], { env: { CLICKUP_TEAM_ID: '' }, responses: [{ status: 200, body: { teams: [{ id: 42, name: 'Only' }] } }, { status: 200, body: { spaces: [] } }] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.requests[0].path, '/api/v2/team');
  assert.equal(r.requests[1].path, '/api/v2/team/42/space?archived=false');
});

test('asks which workspace when the token can see several', () => {
  const r = cu(['spaces'], { env: { CLICKUP_TEAM_ID: '' }, responses: [{ status: 200, body: { teams: [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }] } }] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /more than one workspace/);
  assert.match(r.stderr, /One  \(id: 1\)/);
});

test('uses CLICKUP_TEAM_ID without looking the workspace up', () => {
  const r = cu(['spaces'], { responses: [{ status: 200, body: { spaces: [] } }] });
  assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].path, '/api/v2/team/7/space?archived=false');
});

test('waits out a rate limit and retries', () => {
  const r = cu(['spaces'], {
    responses: [
      { status: 429, headers: { 'x-ratelimit-limit': '100', 'x-ratelimit-reset': String(nowSeconds() - 5) }, body: { err: 'Rate limit reached' } },
      { status: 200, body: { spaces: [{ id: 1, name: 'IT' }] } },
    ],
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Rate limit reached \(100 requests a minute\)\. Waiting 1s, then retrying \(1 of 3\)/);
  assert.equal(r.requests.length, 2);
  assert.match(r.stdout, /IT  \(id: 1\)/);
});

test('says when the rate limit resets once the retries run out', () => {
  const r = cu(['spaces'], { responses: [{ status: 429, headers: { 'x-ratelimit-reset': String(nowSeconds() - 5) }, body: { err: 'Rate limit reached' } }] });
  assert.equal(r.status, 1);
  assert.equal(r.requests.length, 4);
  assert.match(r.stderr, /HTTP 429: Rate limit reached/);
  assert.match(r.stderr, /The rate limit resets at/);
});

test('a dry run prints the write and sends nothing', () => {
  const r = cu(['create-checklist', 'abc', '--name=Deploy', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.requests.length, 0);
  assert.match(r.stdout, /POST https:\/\/api\.clickup\.com\/api\/v2\/task\/abc\/checklist/);
  assert.match(r.stdout, /"name": "Deploy"/);
});

test('endpoint commands fill the path from arguments and the body from flags', () => {
  const r = cu(['check-item', 'CL1', 'IT1']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.requests[0].method, 'PUT');
  assert.equal(r.requests[0].path, '/api/v2/checklist/CL1/checklist_item/IT1');
  assert.deepEqual(JSON.parse(r.requests[0].body), { resolved: true });
});

test('endpoint commands print usage when an argument or required flag is missing', () => {
  const r = cu(['create-checklist', 'abc']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Usage: cu\.js create-checklist <task_id> --name=<string>/);
  assert.equal(r.requests.length, 0);
});

test('custom task IDs send the workspace with them', () => {
  const r = cu(['create-checklist', 'ABC-12', '--name=Deploy']);
  assert.equal(r.requests[0].path, '/api/v2/task/ABC-12/checklist?custom_task_ids=true&team_id=7');
});

test('the workspace fills {team_id} and query fields typed as workspace', () => {
  assert.equal(cu(['plan']).requests[0].path, '/api/v2/team/7/plan');
  assert.equal(cu(['groups']).requests[0].path, '/api/v2/group?team_id=7');
});

test('nested and array bodies', () => {
  const tag = cu(['create-tag', '9', '--name=urgent', '--bg=#ff0000']);
  assert.deepEqual(JSON.parse(tag.requests[0].body), { tag: { name: 'urgent', tag_fg: '#ffffff', tag_bg: '#ff0000' } });
  const est = cu(['update-time-estimates', 'abc', '--estimate=5:60000', '--estimate=unassigned:1000']);
  assert.equal(est.requests[0].path, '/api/v3/workspaces/7/tasks/abc/time_estimates_by_user');
  assert.deepEqual(JSON.parse(est.requests[0].body), [{ assignee: 5, time: 60000 }, { assignee: 'unassigned', time: 1000 }]);
});

test('--body merges raw JSON into the request', () => {
  const r = cu(['create-list-view', '55', '--name=Board', '--type=board', '--body={"settings":{"show_subtasks":1}}']);
  assert.deepEqual(JSON.parse(r.requests[0].body), { name: 'Board', type: 'board', settings: { show_subtasks: 1 } });
});

test('uploads a file as multipart form data', () => {
  const file = join(TMP, 'notes.txt');
  writeFileSync(file, 'hello from the test');
  const r = cu(['attach', 'abc', file], { responses: [{ status: 200, body: { id: 'att1', title: 'notes.txt' } }] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.requests[0].headers['Content-Type'], /^multipart\/form-data; boundary=/);
  assert.match(r.requests[0].body, /name="attachment"; filename="notes\.txt"/);
  assert.match(r.requests[0].body, /hello from the test/);
  assert.match(r.stdout, /Attached: notes\.txt/);
});

test('oauth-token sends a form and needs no API token', () => {
  const r = cu(['oauth-token', '--client-id=a', '--client-secret=b', '--code=c'], { env: { CLICKUP_API_KEY: '' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.requests[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(r.requests[0].body, 'client_id=a&client_secret=b&code=c');
  assert.equal(r.requests[0].headers.Authorization, undefined);
});

test('api calls any endpoint and fills in the workspace', () => {
  const r = cu(['api', 'GET', '/v2/team/{team_id}/plan', '--query=a=1&a=2']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.requests[0].path, '/api/v2/team/7/plan?a=1&a=2');
});

test('help works without a token and explains a command', () => {
  const r = cu(['help', 'check-item'], { env: { CLICKUP_API_KEY: '' } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: cu\.js check-item <checklist_id> <checklist_item_id>/);
  assert.match(r.stdout, /PUT \/api\/v2\/checklist\/\{checklist_id\}\/checklist_item\/\{checklist_item_id\}/);
});

test('every endpoint command is described and grouped', () => {
  const { endpoints } = createRequire(import.meta.url)(CU);
  for (const [name, e] of Object.entries(endpoints)) {
    assert.ok(e.d && e.g, `${name} needs a description and a group`);
    assert.match(e.m, /^(GET|POST|PUT|PATCH|DELETE)$/, name);
    assert.ok(e.v === 2 || e.v === 3, name);
    assert.match(e.p, /^\//, name);
  }
});
