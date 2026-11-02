/**
 * DOM test for the usage-value tab.
 *
 * Mounts the real Client bundle inside jsdom with a stubbed Host, then drives
 * the whole path the page takes: first visit starts the whole-history walk, the
 * finished walk is priced, and the numbers reach the screen. It also proves that
 * editing the rate re-prices and that the edit is remembered in localStorage.
 *
 * React 18 and jsdom are only needed here. They are resolved from the plugin's
 * own node_modules, then `$REACT_ROOT` / `$DSH_NODE_MODULES`; with none found the
 * test reports SKIPPED and exits 0.
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = process.argv[2] || '.';
const problems = [];

/** Find one directory holding react, react-dom and jsdom package trees. */
function locateRuntime() {
  const roots = [
    process.env.REACT_ROOT,
    path.join(repoRoot, 'node_modules'),
    process.env.DSH_NODE_MODULES,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  const candidates = [];
  for (const root of roots) {
    const plain = { react: path.join(root, 'react'), dom: path.join(root, 'react-dom') };
    let entries = [];
    try {
      entries = readdirSync(path.join(root, '.pnpm'));
    } catch {
      entries = [];
    }
    const reactEntry = entries.find((entry) => /^react@18\./.test(entry));
    const domEntry = entries.find((entry) => /^react-dom@18\./.test(entry));
    const jsdomEntry = entries.find((entry) => /^jsdom@/.test(entry));
    candidates.push(plain);
    if (reactEntry !== undefined && domEntry !== undefined && jsdomEntry !== undefined) {
      candidates.push({
        react: path.join(root, '.pnpm', reactEntry, 'node_modules', 'react'),
        dom: path.join(root, '.pnpm', domEntry, 'node_modules', 'react-dom'),
        jsdom: path.join(root, '.pnpm', jsdomEntry, 'node_modules', 'jsdom'),
      });
    }
  }
  for (const candidate of candidates) {
    try {
      const React = createRequire(path.join(candidate.react, 'index.js'))(candidate.react);
      const domRequire = createRequire(path.join(candidate.dom, 'client.js'));
      const client = domRequire(path.join(candidate.dom, 'client.js'));
      const testUtils = domRequire(path.join(candidate.dom, 'test-utils.js'));
      const jsdomPath = candidate.jsdom || 'jsdom';
      const { JSDOM } = createRequire(path.join(candidate.react, 'index.js'))(jsdomPath);
      if (typeof client.createRoot === 'function' && typeof testUtils.Simulate === 'object' && typeof JSDOM === 'function') {
        return { React, createRoot: client.createRoot, Simulate: testUtils.Simulate, JSDOM };
      }
    } catch {
      // Not this one.
    }
  }
  return null;
}

const located = locateRuntime();
if (located === null) {
  console.log('VALUE DOM TEST SKIPPED (React 18 + jsdom not found)');
  process.exit(0);
}
const { React, createRoot, Simulate, JSDOM } = located;

/* ------------------------------------------------------------------- harness */

const source = readFileSync(path.join(pluginDir, 'client.js'), 'utf8');
const HOOK = "    return {\n      inject: ['slots', 'locale'],";
if (!source.includes(HOOK)) {
  console.error('cannot find the plugin return site in client.js');
  process.exit(1);
}
const EXPOSE = [
  '    const __internals = { ValueTab, ZH, EN };',
  '',
].join('\n');
const patched = source.replace(HOOK, EXPOSE + "    return {\n      __internals,\n      inject: ['slots', 'locale'],");

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:53742/',
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;

let factory = null;
window.__ModuleLoader__ = { load(spec) { factory = spec.factory; } };
// eslint-disable-next-line no-new-func
new Function('window', patched)(window);
if (typeof factory !== 'function') {
  console.error('client.js did not call __ModuleLoader__.load');
  process.exit(1);
}
const plugin = factory((name) => {
  if (name === 'react') return React;
  throw new Error('client.js required a module outside the seed table: ' + name);
});
const internals = plugin.__internals;
if (internals === undefined) {
  console.error('the render hook was not attached');
  process.exit(1);
}

/** A `t` bound to the Chinese dictionary, with `{placeholder}` interpolation. */
const ZH = internals.ZH;
const t = (key, params) => {
  let text = ZH[key] !== undefined ? ZH[key] : key;
  if (params !== undefined) {
    text = text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  }
  return text;
};

/* --------------------------------------------------------------- fake Host */

const STATUS = {
  id: 7,
  range: null,
  phase: 'complete',
  message: null,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  scanned: 120,
  collected: 120,
  pages: 3,
  duplicates: 0,
  conflicts: 0,
  outside: 0,
  serverTotal: 120,
  actualStart: 1767225600,
  actualEnd: 1767229200,
};

const RESULT = {
  status: { ...STATUS, complete: true },
  currency: 'CNY',
  counts: { consumption: 118, failures: 2, others: 0, peakRecords: 40, offpeakRecords: 78 },
  buckets: {
    peak: {
      hit: { tokens: 1000, amount: 0.0002, usd: 0.00003, cny: 0.0002 },
      miss: { tokens: 2000, amount: 0.0037, usd: 0.000555, cny: 0.0037 },
      output: { tokens: 500, amount: 0.0014, usd: 0.00021, cny: 0.0014 },
      records: 40,
      quota: 400,
      tokens: 3500,
      amount: 0.0053,
      usd: 0.000795,
      cny: 0.0053,
    },
    offpeak: {
      hit: { tokens: 400, amount: 0.00001, usd: 0.0000015, cny: 0.00001 },
      miss: { tokens: 900, amount: 0.00013, usd: 0.0000195, cny: 0.00013 },
      output: { tokens: 200, amount: 0.0009, usd: 0.000135, cny: 0.0009 },
      records: 78,
      quota: 500,
      tokens: 1500,
      amount: 0.00104,
      usd: 0.000156,
      cny: 0.00104,
    },
  },
  totals: { amount: 0.00634, usd: 0.000951, cny: 0.00634, tokens: 5000 },
  models: [
    { model: 'deepseek-flash', records: 78, hit: 1400, miss: 2900, output: 700, quota: 800, amount: 0.00634, usd: 0.000951, cny: 0.00634, priced: true },
    { model: 'qwen-max', records: 40, hit: 0, miss: 300, output: 100, quota: 100, amount: 0, usd: 0, cny: 0, priced: false },
  ],
  unpriced: { models: ['qwen-max'], records: 40 },
  quota: {
    error: null,
    totalGranted: 1000,
    totalUsed: 99,
    totalAvailable: 901,
    logQuota: 900,
    pricedQuota: 800,
    delta: -801,
    reconciled: false,
  },
  extrapolation: {
    granted: { amount: 0.0079, usd: 0.00119, cny: 0.0079 },
    remaining: { amount: 0.0071, usd: 0.00107, cny: 0.0071 },
    provisional: { incomplete: false, unpriced: 40, quota: false, mismatch: true },
  },
  rate: 6.66,
  holidays: 0,
  computedAt: new Date().toISOString(),
};

const calls = [];
globalThis.fetch = async (url, init) => {
  const text = String(url);
  const body = init !== undefined && init.body !== undefined ? JSON.parse(init.body) : null;
  calls.push({ url: text, method: (init && init.method) || 'GET', body });
  const reply = (payload) => ({ status: 200, async json() { return payload; } });
  if (text.endsWith('/value/start')) return reply({ ok: true, data: STATUS });
  if (text.endsWith('/value/status')) return reply({ ok: true, data: STATUS });
  if (text.endsWith('/value/result')) return reply({ ok: true, data: { ...RESULT, rate: body.rate } });
  if (text.endsWith('/value/prices')) {
    return reply({
      ok: true,
      data: {
        source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md',
        fetchedAt: new Date().toISOString(),
        currency: 'CNY',
        models: {
          'deepseek-flash': { peak: { hit: 0.05, miss: 2.5, output: 10 }, offpeak: { hit: 0.025, miss: 1.25, output: 5 } },
        },
      },
    });
  }
  return reply({ ok: false, error: 'unexpected route ' + text });
};

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------- render */

const mountPoint = document.getElementById('root');
const root = createRoot(mountPoint);
root.render(React.createElement(internals.ValueTab, { t, enabled: true }));
await settle(1400);

const text = () => document.body.textContent;

const must = (needle, why) => {
  if (!text().includes(needle)) problems.push('the value tab is missing ' + why + ' (' + needle + ')');
};

const started = calls.filter((call) => call.url.endsWith('/value/start'));
if (started.length !== 1) problems.push('the first visit started ' + started.length + ' walks, not 1');
const priced = calls.filter((call) => call.url.endsWith('/value/result'));
if (priced.length < 1) problems.push('the finished walk was never priced');
else {
  const body = priced[priced.length - 1].body;
  if (body === null || body.id !== 7) problems.push('the pricing call did not carry the walk id');
  // The tab's own default rate, which is what a first paint must send.
  if (body.rate !== 6.66) problems.push('the pricing call sent rate ' + body.rate);
  if (body.prices === undefined || body.prices['deepseek-flash'] === undefined) {
    problems.push('the pricing call sent no price table');
  }
}

must('已用合计', 'the used total row');
must('高峰小计', 'the peak subtotal');
must('非高峰小计', 'the off-peak subtotal');
must('全部配额估算', 'the whole-quota row');
must('剩余配额估算', 'the remaining-quota row');
must('¥0.01', 'the used CNY amount');
must('缺价', 'the unpriced model tag');
must('暂定值', 'the provisional marker');
must('差 -801', 'the reconciliation delta');
must('40 条消费记录', 'the unpriced-rows reason');
must('重新采集', 'the re-collect button after a finished walk');
must('内置快照 official-2026-11-02', 'the bundled snapshot label');
// The bundled table is the official RMB one, so flash is priced, not "缺价".
const flashInput = document.querySelector('input[aria-label="deepseek-flash 高峰价 hit"]');
if (flashInput === null) problems.push('the deepseek-flash price cell was not rendered');
else if (flashInput.value !== '0.04') problems.push('the bundled flash hit price reads ' + flashInput.value);
const currencySelect = [...document.querySelectorAll('select')]
  .find((select) => select.value === 'CNY' || select.value === 'USD');
if (currencySelect === undefined) problems.push('the price-unit selector was not rendered');
else if (currencySelect.value !== 'CNY') problems.push('the default price unit is ' + currencySelect.value);
if (/undefined|NaN|\[object Object\]/.test(text())) {
  const hit = text().match(/.{0,40}(?:undefined|NaN|\[object Object\]).{0,40}/);
  problems.push('the value tab leaked runtime text: ' + hit[0]);
}
for (const key of Object.keys(ZH)) {
  if (text().includes(key)) problems.push('the value tab shows the raw key ' + key);
}

/* ---------------------------------------------------------------- re-pricing */

// Editing the rate must re-price with the new number and be remembered.
// jsdom does not drive React's controlled-input path from a native `input`
// event, so the handler is invoked through `Simulate`, which is the same
// onChange path a real keystroke reaches.
const numberInputs = [...document.querySelectorAll('input[type="number"]')];
if (numberInputs.length === 0) problems.push('the value tab rendered no numeric input');
else {
  Simulate.change(numberInputs[0], { target: { value: '8' } });
  await settle(900);
  const again = calls.filter((call) => call.url.endsWith('/value/result'));
  if (again.length <= priced.length) problems.push('editing the rate did not re-price');
  else if (again[again.length - 1].body.rate !== 8) {
    problems.push('the re-pricing call sent rate ' + again[again.length - 1].body.rate);
  }
  let stored = null;
  try {
    stored = JSON.parse(window.localStorage.getItem('dsh-ai-quota/value-v1'));
  } catch {
    stored = null;
  }
  if (stored === null || stored.rate !== 8) problems.push('the edited rate was not stored');
  if (stored !== null && (stored.prices === undefined || stored.prices['deepseek-flash'] === undefined)) {
    problems.push('the stored preferences lost the price table');
  }
}

/* ------------------------------------------------------------- live pricing */

// "Update from the official page" must adopt the Host's table and say so.
const fetchButton = [...document.querySelectorAll('button')]
  .find((button) => button.textContent.includes('从官网更新价目'));
if (fetchButton === undefined) problems.push('the official-page button was not rendered');
else {
  const before = calls.length;
  Simulate.click(fetchButton);
  await settle(1200);
  const priceCalls = calls.slice(before).filter((call) => call.url.endsWith('/value/prices'));
  if (priceCalls.length !== 1) problems.push('the official page was requested ' + priceCalls.length + ' times');
  const updated = document.querySelector('input[aria-label="deepseek-flash 高峰价 hit"]');
  if (updated === null) problems.push('the flash price cell vanished after the update');
  else if (updated.value !== '0.05') problems.push('the fetched price did not land: ' + updated.value);
  if (!text().includes('官网价目，抓取于')) problems.push('the source line still points at the snapshot');
  const after = calls.filter((call) => call.url.endsWith('/value/result'));
  if (after[after.length - 1].body.prices['deepseek-flash'].peak.hit !== 0.05) {
    problems.push('the re-pricing kept the old flash price');
  }
}

/* -------------------------------------------------------------- model prices */

must('deepseek-flash', 'the priced model row');
must('qwen-max', 'the unpriced model row');
const unpricedRow = [...document.querySelectorAll('tbody tr')]
  .find((row) => row.textContent.includes('qwen-max'));
if (unpricedRow === undefined) problems.push('the unpriced model row was not rendered');
else if (!unpricedRow.textContent.includes('缺价')) problems.push('the unpriced row lost its tag');

/* ------------------------------------------------------------- date window */

// The default walk is a window: today plus the thirteen days before it.
const firstStart = calls.find((call) => call.url.endsWith('/value/start'));
if (firstStart === undefined) problems.push('the first walk never started');
else {
  const body = firstStart.body;
  if (!Number.isInteger(body.start) || !Number.isInteger(body.end)) {
    problems.push('the default walk sent no epoch window: ' + JSON.stringify(body));
  } else {
    const days = Math.round((body.end - body.start) / 86400);
    if (days !== 14) problems.push('the default window is ' + days + ' days, not 14');
    const endGap = Math.abs(body.end - Math.floor(Date.now() / 1000));
    if (endGap > 90000) problems.push('the default window does not end today (off by ' + endGap + 's)');
  }
}

// Ticking "All time" must send an empty body, i.e. no filter at all.
const checkbox = document.querySelector('input[type="checkbox"]');
if (checkbox === null) problems.push('the All time checkbox was not rendered');
else {
  if (checkbox.checked !== false) problems.push('All time is ticked by default');
  const startsBefore = calls.filter((call) => call.url.endsWith('/value/start')).length;
  Simulate.change(checkbox, { target: { checked: true } });
  await settle(250);
  const recollect = [...document.querySelectorAll('button')]
    .find((button) => button.textContent.includes('重新采集'));
  if (recollect === undefined) problems.push('the recollect button vanished after ticking All time');
  else {
    Simulate.click(recollect);
    await settle(1000);
    const starts = calls.filter((call) => call.url.endsWith('/value/start'));
    if (starts.length <= startsBefore) problems.push('ticking All time did not start a walk');
    else {
      const body = starts[starts.length - 1].body;
      if (body.start !== undefined || body.end !== undefined) {
        problems.push('the whole-history walk still sent a window: ' + JSON.stringify(body));
      }
    }
  }
}

/* ---------------------------------------------------------- snapshot upgrade */

// A table stored by an older bundled snapshot must be replaced, not kept: that
// is how deepseek-flash ended up "缺价" while an older table sat in storage.
root.unmount();
window.localStorage.setItem('dsh-ai-quota/value-v1', JSON.stringify({
  rate: 7.1,
  holidays: '',
  currency: 'USD',
  prices: { 'deepseek-chat': { peak: { hit: 0.028, miss: 0.28, output: 0.42 }, offpeak: { hit: 0.014, miss: 0.14, output: 0.21 } } },
  source: { kind: 'snapshot', version: 'official-2026-10-01' },
}));
const second = document.createElement('div');
document.body.appendChild(second);
const secondRoot = createRoot(second);
secondRoot.render(React.createElement(internals.ValueTab, { t, enabled: false }));
await settle(400);
const upgraded = second.querySelector('input[aria-label="deepseek-flash 高峰价 hit"]');
if (upgraded === null) problems.push('an older stored table was not replaced by the snapshot');
else if (upgraded.value !== '0.04') problems.push('the upgraded flash price reads ' + upgraded.value);
if (second.textContent.includes('deepseek-chat')) problems.push('the replaced table kept the old model rows');
secondRoot.unmount();
window.localStorage.removeItem('dsh-ai-quota/value-v1');

/* ----------------------------------------------------------------- teardown */

root.unmount();
if (problems.length === 0) {
  console.log('VALUE DOM TEST OK (' + calls.length + ' Host calls, ' + priced.length + ' pricing passes)');
} else {
  console.log('VALUE DOM TEST FAILED (' + problems.length + ')');
  for (const problem of problems) console.log(' - ' + problem);
  process.exitCode = 1;
}
