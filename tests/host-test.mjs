/**
 * Host-half integration test for the ai-quota plugin.
 *
 * Runs the real `index.js` against an in-process fake gateway and a fake
 * credential service, so the HTTP envelope checks, field allowlists, pagination
 * and the analysis collector/aggregator are exercised without a browser and
 * without touching the corporate gateway.
 */

import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const pluginDir = process.argv[2] || '.';
const TOKEN = 'sk-test-token';
const problems = [];

/* ------------------------------------------------------------------ fixtures */

const DAY = 86400;
const BASE = 1767225600; // 2026-01-01T00:00:00Z
const MODELS = ['hunyuan-turbo', 'deepseek-v3', 'qwen-max'];

/** 120 rows: 3 pages at page_size 50, spread over 5 days, some fields missing. */
const rows = Array.from({ length: 120 }, (_, index) => ({
  id: 1000 + index,
  created_at: BASE + Math.floor(index * 3600), // one per hour, 5 days
  type: 2,
  model_name: MODELS[index % MODELS.length],
  quota: index % 7 === 0 ? undefined : 10 + (index % 5), // some rows omit quota
  prompt_tokens: 100 + index,
  completion_tokens: 20 + (index % 3),
  use_time: 1 + (index % 4),
  is_stream: index % 2 === 0,
  cache_tokens: 0,
  cache_write_tokens: 0,
  request_id: 'req-' + index,
  secret_field: 'must-not-leak',
}));

const server = createServer((req, res) => {
  const url = new URL(String(req.url), 'http://localhost');
  const auth = req.headers.authorization;
  const send = (body, status = 200) => {
    const text = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(text);
  };
  if (url.pathname !== '/api/pricing' && auth !== 'Bearer ' + TOKEN) {
    send({ code: false, message: 'unauthorized' }, 401);
    return;
  }
  if (url.pathname === '/api/usage/token/') {
    send({
      code: true,
      data: {
        total_available: 900,
        total_granted: 1000,
        total_used: 100,
        unlimited_quota: false,
        expires_at: BASE + 30 * DAY,
        name: '测试令牌',
        model_limits_enabled: true,
        model_limits: { 'deepseek-v3': { max_tokens: 100 } },
        extra_field: 'must-not-leak',
      },
    });
    return;
  }
  if (url.pathname === '/v1/models') {
    send({
      success: true,
      object: 'list',
      data: MODELS.map((id) => ({ id, supported_endpoint_types: ['openai'], junk: 1 })),
    });
    return;
  }
  if (url.pathname === '/api/pricing') {
    send({
      success: true,
      group_ratio: { default: 1, vip: 0.8 },
      data: [{ model_name: 'deepseek-v3', model_ratio: 2, completion_ratio: 1, quota_type: 0, junk: 1 }],
    });
    return;
  }
  if (url.pathname === '/api/log/token') {
    const page = Number(url.searchParams.get('p'));
    const size = Number(url.searchParams.get('page_size'));
    const slice = rows.slice((page - 1) * size, page * size);
    send({ success: true, data: slice, total: rows.length });
    return;
  }
  send({ code: false, message: 'not found' }, 404);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;

/* ------------------------------------------------------------- fake harness */

let stored;
const credentials = {
  async readRecord(key) {
    return stored !== undefined && key === stored.credentialKey ? { ...stored.record } : undefined;
  },
  async modifyRecord(key, mutate) {
    const current = await this.readRecord(key);
    const next = await mutate(current);
    if (next === undefined || next === null) return undefined;
    stored = { credentialKey: key, record: { kind: next.kind, key: next.key, env: { ...(next.env || {}) } } };
    return { ...stored.record };
  },
  async resolve() {
    return undefined;
  },
  async deleteRecord() {
    stored = undefined;
    return true;
  },
};

let route;
const disposers = [];
const ctx = {
  get(name) {
    if (name === 'credentials') return credentials;
    return undefined;
  },
  webServer: {
    register(spec) {
      route = spec;
      return () => { route = undefined; };
    },
  },
  effect(fn) {
    const dispose = fn();
    disposers.push(typeof dispose === 'function' ? dispose : () => {});
    return () => {};
  },
};

const plugin = await import(pathToFileURL(path.resolve(pluginDir, 'index.js')).href);
if (typeof plugin.apply !== 'function') problems.push('index.js has no apply export');
plugin.apply(ctx, {});

if (route === undefined) problems.push('the data route was not registered');
else if (route.kind !== 'prefix' || route.path !== '/x-ai-quota') {
  problems.push('unexpected route: ' + route.kind + ' ' + route.path);
}

/** Drive the registered handler like the Web server would. */
async function call(method, suffix, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(text.length === 0 ? [] : [Buffer.from(text, 'utf8')]);
  req.method = method;
  req.url = '/x-ai-quota' + suffix;
  req.headers = {};
  const headers = {};
  let status = 0;
  let payload = '';
  const res = {
    set statusCode(value) { status = value; },
    get statusCode() { return status; },
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(chunk) { if (chunk !== undefined) payload += String(chunk); },
  };
  await route.handler(req, res);
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    problems.push(method + ' ' + suffix + ' returned non-JSON: ' + payload.slice(0, 120));
    return { status, headers, body: undefined };
  }
  return { status, headers, body: parsed };
}

function expectOk(label, response) {
  if (response.body === undefined) return undefined;
  if (response.body.ok !== true) {
    problems.push(label + ' failed: ' + response.body.error);
    return undefined;
  }
  return response.body.data;
}

/* -------------------------------------------------------------------- tests */

const state0 = expectOk('GET /state (fresh)', await call('GET', '/state'));
if (state0 !== undefined) {
  if (state0.settings.hasToken !== false) problems.push('fresh state reports a token');
  if (state0.settings.credentialsAvailable !== true) problems.push('credentials not detected');
}

const rejected = await call('POST', '/connect', { baseUrl: 'http://10.0.0.1:8090/some/path', token: TOKEN });
if (rejected.body !== undefined && rejected.body.ok !== false) {
  problems.push('a base URL with a path was accepted');
}

const connected = expectOk('POST /connect', await call('POST', '/connect', { baseUrl: origin, token: TOKEN }));
if (connected !== undefined) {
  if (connected.settings.hasToken !== true) problems.push('connect did not store the token');
  if (connected.settings.baseUrl !== origin) problems.push('connect stored ' + connected.settings.baseUrl);
  if (JSON.stringify(connected).includes(TOKEN)) problems.push('the token leaked into the page payload');
}

const page1 = expectOk('GET /logs p1', await call('GET', '/logs?page=1&pageSize=50'));
if (page1 !== undefined) {
  if (page1.items.length !== 50) problems.push('page 1 has ' + page1.items.length + ' rows');
  if (page1.total !== 120) problems.push('total is ' + page1.total);
  if (page1.page !== 1) problems.push('page echo is ' + page1.page);
  const row = page1.items[0];
  for (const key of ['id', 'created_at', 'model_name', 'prompt_tokens', 'request_id']) {
    if (!(key in row)) problems.push('log row lacks ' + key);
  }
  if ('secret_field' in row) problems.push('log allowlist leaked secret_field');
  // Fixture row 0 omits quota: an absent field must stay absent rather than become 0.
  if ('quota' in row) problems.push('a missing quota was filled in: ' + row.quota);
  if (!page1.items.some((entry) => typeof entry.quota === 'number')) {
    problems.push('no log row carried quota at all');
  }
}

const page3 = expectOk('GET /logs p3', await call('GET', '/logs?page=3&pageSize=50'));
if (page3 !== undefined && page3.items.length !== 20) problems.push('page 3 has ' + page3.items.length + ' rows');

const badPage = await call('GET', '/logs?page=0&pageSize=50');
if (badPage.body !== undefined && badPage.body.ok !== false) problems.push('page 0 was accepted');
const badSize = await call('GET', '/logs?page=1&pageSize=33');
if (badSize.body !== undefined && badSize.body.ok !== false) problems.push('pageSize 33 was accepted');

const snapshot = expectOk('POST /refresh', await call('POST', '/refresh'));
if (snapshot !== undefined) {
  if (snapshot.quota === undefined) problems.push('refresh lacks quota: ' + JSON.stringify(snapshot.errors));
  else {
    if (snapshot.quota.total_available !== 900) problems.push('quota total_available is ' + snapshot.quota.total_available);
    if ('extra_field' in snapshot.quota) problems.push('quota allowlist leaked extra_field');
  }
  if (!Array.isArray(snapshot.models) || snapshot.models.length !== 3) problems.push('models section is not 3 rows');
  else if ('junk' in snapshot.models[0]) problems.push('model allowlist leaked junk');
  if (!Array.isArray(snapshot.prices) || snapshot.prices.length !== 1) problems.push('prices section is not 1 row');
  else if ('junk' in snapshot.prices[0]) problems.push('pricing allowlist leaked junk');
  if (snapshot.groupRatios === undefined || snapshot.groupRatios.vip !== 0.8) problems.push('group_ratio was dropped');
  if (Object.keys(snapshot.errors).length !== 0) problems.push('unexpected section errors: ' + JSON.stringify(snapshot.errors));
  for (const key of ['quota', 'models', 'prices']) {
    if (typeof snapshot.times[key] !== 'string') problems.push('missing timestamp for ' + key);
  }
}

const start = expectOk('POST /analysis/start', await call('POST', '/analysis/start', {
  start: BASE,
  end: BASE + 5 * DAY,
}));
if (start !== undefined) {
  if (start.phase !== 'running' && start.phase !== 'complete') problems.push('start phase is ' + start.phase);
  const deadline = Date.now() + 15000;
  let status = start;
  while (status.phase === 'running' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const next = await call('GET', '/analysis/status?id=' + start.id);
    if (next.body === undefined || next.body.ok !== true) {
      problems.push('status read failed: ' + JSON.stringify(next.body));
      break;
    }
    status = next.body.data;
  }
  if (status.phase !== 'complete') problems.push('collection ended as ' + status.phase + ': ' + status.message);
  if (status.collected !== 120) problems.push('collected ' + status.collected + ' rows');
  if (status.pages !== 3) problems.push('walked ' + status.pages + ' pages');
  if (status.duplicates !== 0 || status.conflicts !== 0 || status.outside !== 0) {
    problems.push('unexpected counters: ' + JSON.stringify({
      duplicates: status.duplicates, conflicts: status.conflicts, outside: status.outside,
    }));
  }

  const analysis = expectOk('POST /analysis/result', await call('POST', '/analysis/result', {
    id: start.id,
    granularity: 'day',
    offsetMinutes: 480,
  }));
  if (analysis !== undefined) {
    if (analysis.totals.count !== 120) problems.push('analysis total is ' + analysis.totals.count);
    const binSum = analysis.bins.reduce((sum, bin) => sum + bin.metrics.count, 0);
    if (binSum !== 120) problems.push('bins sum to ' + binSum);
    const hourSum = analysis.hours.reduce((sum, value) => sum + value, 0);
    if (hourSum !== 120) problems.push('hours sum to ' + hourSum);
    if (analysis.modelCount !== 3) problems.push('modelCount is ' + analysis.modelCount);
    const modelSum = analysis.models.reduce((sum, entry) => sum + entry.metrics.count, 0);
    if (modelSum !== 120) problems.push('models sum to ' + modelSum);
    // Rows 0, 7, 14, ... omit quota, so the quota sum must be null-free and partial.
    const quotaValid = analysis.totals.quota.valid;
    if (quotaValid !== 120 - Math.ceil(120 / 7)) problems.push('quota.valid is ' + quotaValid);
    for (const bin of analysis.bins) {
      if (bin.end - bin.start !== DAY) problems.push('day bin width is ' + (bin.end - bin.start));
    }
  }

  const hourly = expectOk('POST /analysis/result (hour)', await call('POST', '/analysis/result', {
    id: start.id,
    granularity: 'hour',
    offsetMinutes: 0,
  }));
  if (hourly !== undefined && hourly.bins.some((bin) => bin.end - bin.start !== 3600)) {
    problems.push('hour bin width is wrong');
  }

  const filtered = expectOk('POST /analysis/result (model filter)', await call('POST', '/analysis/result', {
    id: start.id,
    models: ['deepseek-v3'],
    granularity: 'day',
    offsetMinutes: 480,
  }));
  if (filtered !== undefined && filtered.totals.count !== 40) problems.push('model filter count is ' + filtered.totals.count);

  const bin = analysis !== undefined ? analysis.bins[0] : undefined;
  const details = expectOk('POST /analysis/details', await call('POST', '/analysis/details', {
    id: start.id,
    granularity: 'day',
    offsetMinutes: 480,
    page: 1,
    start: bin === undefined ? undefined : bin.start,
    end: bin === undefined ? undefined : bin.end,
  }));
  if (details !== undefined) {
    if (details.pageSize !== 50) problems.push('detail pageSize is ' + details.pageSize);
    if (details.total < 1) problems.push('detail total is ' + details.total);
    if (details.items.length !== Math.min(50, details.total)) problems.push('detail page size mismatch');
  }

  const hourDetails = expectOk('POST /analysis/details (hour)', await call('POST', '/analysis/details', {
    id: start.id,
    granularity: 'day',
    offsetMinutes: 480,
    page: 1,
    hour: 3,
  }));
  if (hourDetails !== undefined && hourDetails.total !== 5) problems.push('hour 3 drill total is ' + hourDetails.total);

  const cancelled = expectOk('POST /analysis/cancel', await call('POST', '/analysis/cancel', { id: start.id }));
  if (cancelled !== undefined && cancelled.phase !== 'complete') problems.push('cancel after completion changed phase to ' + cancelled.phase);
}

const missingJob = await call('GET', '/analysis/status?id=99999');
if (missingJob.body !== undefined && missingJob.body.ok !== false) problems.push('unknown job id was accepted');

const unknown = await call('GET', '/nope');
if (unknown.status !== 404) problems.push('unknown path answered ' + unknown.status);

const forgot = expectOk('POST /forget', await call('POST', '/forget'));
if (forgot !== undefined && forgot.settings.hasToken !== false) problems.push('forget kept the token');

const noToken = await call('POST', '/refresh');
if (noToken.body !== undefined && noToken.body.ok !== false) problems.push('refresh without a token succeeded');

/* ------------------------------------------------------------------ teardown */

for (const dispose of disposers) {
  try {
    dispose();
  } catch (error) {
    problems.push('disposer threw: ' + error.message);
  }
}
server.close();

if (problems.length === 0) {
  console.log('HOST TEST OK (' + rows.length + ' fixture rows, ' + origin + ')');
} else {
  console.log('HOST TEST FAILED (' + problems.length + ')');
  for (const problem of problems) console.log(' - ' + problem);
  process.exitCode = 1;
}
