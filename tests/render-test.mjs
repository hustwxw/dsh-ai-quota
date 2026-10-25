/**
 * Render test for the ai-quota client bundle.
 *
 * Loads `client.js` the way the Harness loader does (factory + `require('react')`),
 * renders every panel tab and chart atom to static markup with React 18, and
 * checks the output for leaked dictionary keys, `undefined`/`NaN` text and
 * missing strings. No browser and no network: the tabs render their initial
 * state, which is what a failure-free first paint looks like.
 *
 * React 18 is only needed by this test, never at runtime. It is resolved from
 * the repo's own node_modules, then `$REACT_ROOT`, then `$DSH_NODE_MODULES`
 * (a DSH checkout whose pnpm store holds React 18); with none available the
 * test reports SKIPPED and exits 0.
 */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Find one directory holding both `react` and `react-dom` package trees. */
function locateReact() {
  const roots = [
    process.env.REACT_ROOT,
    path.join(repoRoot, 'node_modules'),
    process.env.DSH_NODE_MODULES,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  const candidates = [];
  for (const root of roots) {
    // A plain install: `<root>/react` and `<root>/react-dom`.
    candidates.push({ react: path.join(root, 'react'), dom: path.join(root, 'react-dom') });
    // A pnpm store: `<root>/.pnpm/react@18…/node_modules/react`.
    let entries = [];
    try {
      entries = readdirSync(path.join(root, '.pnpm'));
    } catch {
      entries = [];
    }
    const reactEntry = entries.find((entry) => /^react@18\./.test(entry));
    const domEntry = entries.find((entry) => /^react-dom@18\./.test(entry));
    if (reactEntry !== undefined && domEntry !== undefined) {
      candidates.push({
        react: path.join(root, '.pnpm', reactEntry, 'node_modules', 'react'),
        dom: path.join(root, '.pnpm', domEntry, 'node_modules', 'react-dom'),
      });
    }
  }
  for (const candidate of candidates) {
    try {
      const reactModule = createRequire(path.join(candidate.react, 'index.js'))(candidate.react);
      const domServer = createRequire(path.join(candidate.dom, 'server.js'))(path.join(candidate.dom, 'server.js'));
      if (typeof domServer.renderToStaticMarkup === 'function') {
        return { React: reactModule, renderToStaticMarkup: domServer.renderToStaticMarkup };
      }
    } catch {
      // Not this one.
    }
  }
  return null;
}

const located = locateReact();
if (located === null) {
  console.log('RENDER TEST SKIPPED (React 18 not found)');
  console.log('run `pnpm add -D react@18 react-dom@18`, or point REACT_ROOT at a node_modules holding both.');
  process.exit(0);
}
const { React, renderToStaticMarkup } = located;

const pluginDir = process.argv[2] || '.';
const problems = [];

/* ------------------------------------------------------------------- loading */

const source = readFileSync(path.join(pluginDir, 'client.js'), 'utf8');
// Expose the module-private components for the render assertions. The plugin
// itself never sees this branch.
const HOOK = "    return {\n      inject: ['slots', 'locale'],";
if (!source.includes(HOOK)) {
  console.error('cannot find the plugin return site in client.js');
  process.exit(1);
}
const EXPOSE = [
  '    const __internals = {',
  '      Panel, OverviewTab, ModelsTab, LogsTab, AnalysisTab, SettingsTab, VersionsTab,',
  '      Chart, RankList, Modal, Table, Pager, Stat, Note,',
  '      ZH, EN,',
  '    };',
  '',
].join('\n');
const patched = source.replace(
  HOOK,
  EXPOSE + "    return {\n      __internals,\n      inject: ['slots', 'locale'],",
);

let factory;
// The bundle is evaluated with `window` bound to this object, so it must carry
// the pieces the plugin touches (`__ModuleLoader__`, focus listeners,
// localStorage for the display name).
const windowListeners = new Map();
const storedNames = new Map();
const fakeWindow = {
  __ModuleLoader__: {
    load(spec) {
      factory = spec.factory;
    },
  },
  addEventListener(type, fn) {
    windowListeners.set(type, fn);
  },
  removeEventListener(type, fn) {
    if (windowListeners.get(type) === fn) windowListeners.delete(type);
  },
  localStorage: {
    getItem(key) {
      return storedNames.has(key) ? storedNames.get(key) : null;
    },
    setItem(key, value) {
      storedNames.set(key, String(value));
    },
    removeItem(key) {
      storedNames.delete(key);
    },
  },
};
new Function('window', patched)(fakeWindow);
if (typeof factory !== 'function') {
  console.error('client.js did not call __ModuleLoader__.load');
  process.exit(1);
}

const reactForBundle = (name) => {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
  throw new Error('client.js required a module outside the seed table: ' + name);
};
const plugin = factory(reactForBundle);
if (!plugin || typeof plugin.apply !== 'function') {
  console.error('the client factory did not return an apply function');
  process.exit(1);
}
const internals = plugin.__internals;
if (internals === undefined) {
  console.error('the render hook was not attached');
  process.exit(1);
}

/* -------------------------------------------------------------------- locale */

const dicts = {};
let active = 'zh';
const subscribers = new Set();
const locale = {
  register(ns, next) {
    // Mirrors the real service: a second registration for the same locale
    // throws, which is the hot-reload path the plugin has to survive.
    const table = dicts[ns] || (dicts[ns] = {});
    for (const language of Object.keys(next)) {
      if (table[language] !== undefined) {
        throw new Error('locale namespace "' + ns + '" already has locale "' + language + '"');
      }
    }
    Object.assign(table, next);
    return () => {};
  },
  bind(ns) {
    return (key, params) => {
      const table = dicts[ns] && dicts[ns][active];
      let text = table && table[key] !== undefined ? table[key] : key;
      if (params !== undefined) {
        text = text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
      }
      return text;
    };
  },
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
  getLocale() {
    return active;
  },
};

/**
 * Mount the plugin half the way the module loader would, with a stubbed fetch
 * and scheduler so the sidebar badge can be driven and inspected.
 */
function mount(fetchImpl) {
  const state = { entries: new Map(), components: new Map(), disposers: [], intervals: [], cleared: [] };
  const savedFetch = globalThis.fetch;
  const savedSetInterval = globalThis.setInterval;
  const savedClearInterval = globalThis.clearInterval;
  globalThis.fetch = fetchImpl;
  globalThis.setInterval = (fn, ms) => {
    const handle = { fn, ms };
    state.intervals.push(handle);
    return handle;
  };
  globalThis.clearInterval = (handle) => {
    state.cleared.push(handle);
  };
  const slots = {
    inject(name, setup) {
      const disposer = setup();
      state.disposers.push(typeof disposer === 'function' ? disposer : () => {});
      return () => {};
    },
    register(options, component) {
      state.entries.set(options.name, options);
      state.components.set(options.name, component);
      return () => {
        // Re-registration disposes the previous row before adding the new one.
        if (state.entries.get(options.name) === options) state.entries.delete(options.name);
      };
    },
  };
  const ctx = {
    locale,
    slots,
    effect(fn) {
      const disposer = fn();
      state.disposers.push(typeof disposer === 'function' ? disposer : () => {});
      return () => {};
    },
  };
  plugin.apply(ctx);
  state.restore = () => {
    globalThis.fetch = savedFetch;
    globalThis.setInterval = savedSetInterval;
    globalThis.clearInterval = savedClearInterval;
    for (const disposer of state.disposers) {
      try {
        disposer();
      } catch (error) {
        problems.push('disposer threw: ' + error.message);
      }
    }
  };
  state.label = () => {
    const row = state.entries.get('sidebar.panellist');
    if (row === undefined) return null;
    return typeof row.label === 'function' ? row.label() : row.label;
  };
  return state;
}

/** A fetch stand-in returning one `/refresh` payload (or failing). */
const respondWith = (quota) => async () => ({
  status: 200,
  json: async () => ({ ok: true, data: { quota, errors: {}, times: {} } }),
});
const failingFetch = async () => {
  throw new Error('offline');
};

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The dictionary default for `app.name`; a stored name overrides it. */
const DEFAULT_NAME = 'AI 额度';

let mock = mount(respondWith({ total_granted: 1000, total_available: 900.5 }));
await settle(30);
if (mock.entries.size !== 2) problems.push('apply registered ' + mock.entries.size + ' slots');
if (!mock.entries.has('main')) problems.push('the main panel was not registered');
if (mock.entries.get('main').key !== 'ai-quota-panel') problems.push('the main panel key is wrong');
if (mock.intervals.length !== 1) problems.push('expected one badge timer, saw ' + mock.intervals.length);
if (mock.intervals[0] !== undefined && mock.intervals[0].ms !== 900000) {
  problems.push('the badge timer runs every ' + mock.intervals[0].ms + 'ms, not 15 minutes');
}
const badgeLabel = mock.label();
if (badgeLabel !== DEFAULT_NAME + ' · 90%') problems.push('sidebar label is ' + JSON.stringify(badgeLabel));
// Coming back to the tab is the third refresh path; it must be wired and removed.
if (typeof windowListeners.get('focus') !== 'function') problems.push('no focus listener was installed');
// The row icon is the refresh control, so it must be a component of its own.
const rowIcon = mock.components.get('sidebar.panellist');
if (typeof rowIcon !== 'function') problems.push('the sidebar row has no icon component');
if (typeof mock.components.get('main') !== 'function') {
  problems.push('the main panel has no component');
}
mock.restore();
if (windowListeners.size !== 0) problems.push('the focus listener survived teardown');

// A stored display name replaces the dictionary default in the same row.
storedNames.set('dsh-ai-quota/display-name', '测试网关额度');
const renamed = mount(respondWith({ total_granted: 1000, total_available: 500 }));
await settle(20);
if (renamed.label() !== '测试网关额度 · 50%') problems.push('a stored name reads ' + JSON.stringify(renamed.label()));
// Over-long names are clamped to the documented 40 characters.
storedNames.set('dsh-ai-quota/display-name', 'x'.repeat(60));
const clamped = mount(respondWith({ total_granted: 10, total_available: 10 }));
await settle(20);
if (clamped.label() !== 'x'.repeat(40) + ' · 100%') problems.push('an over-long name was not clamped: ' + JSON.stringify(clamped.label()));
storedNames.clear();
clamped.restore();
renamed.restore();

// A poll tick with a fresh payload must repaint the row without a reload.
const polled = mount(respondWith({ total_granted: 1000, total_available: 1000 }));
await settle(20);
if (polled.label() !== DEFAULT_NAME + ' · 100%') problems.push('a full quota reads ' + JSON.stringify(polled.label()));
if (Object.keys(dicts).length < 2) problems.push('the duplicate-namespace fallback never ran');
await polled.intervals[0].fn();
await settle(20);
if (polled.label() !== DEFAULT_NAME + ' · 100%') problems.push('the timer tick changed the label unexpectedly');
polled.restore();

// Rounding and the two states where the suffix must disappear.
const rounded = mount(respondWith({ total_granted: 3, total_available: 2 }));
await settle(20);
if (rounded.label() !== DEFAULT_NAME + ' · 67%') problems.push('rounding reads ' + JSON.stringify(rounded.label()));
rounded.restore();

const zero = mount(respondWith({ total_granted: 0, total_available: 0 }));
await settle(20);
if (zero.label() !== DEFAULT_NAME) problems.push('a zero-total quota shows ' + JSON.stringify(zero.label()));
zero.restore();

// Unlimited and unreadable quotas.
const unlimited = mount(respondWith({ unlimited_quota: true, total_granted: 0, total_available: 0 }));
await settle(20);
if (unlimited.label() !== DEFAULT_NAME + ' · ∞') problems.push('unlimited reads ' + JSON.stringify(unlimited.label()));
unlimited.restore();

const broken = mount(failingFetch);
await settle(20);
if (broken.label() !== DEFAULT_NAME) problems.push('a failed read shows ' + JSON.stringify(broken.label()));
broken.restore();

// A quota section that failed on the Host side (present but without numbers).
const partial = mount(async () => ({
  status: 200,
  json: async () => ({ ok: true, data: { quota: undefined, errors: { quota: 'boom' }, times: {} } }),
}));
await settle(20);
if (partial.label() !== DEFAULT_NAME) problems.push('a partial snapshot shows ' + JSON.stringify(partial.label()));
partial.restore();

const ZH = dicts['ai-quota-panel']['zh'];
const EN = dicts['ai-quota-panel']['en'];
const t = locale.bind('ai-quota-panel');
const tEn = (key, params) => {
  const previous = active;
  active = 'en';
  const text = locale.bind('ai-quota-panel')(key, params);
  active = previous;
  return text;
};

/* ------------------------------------------------------------------ fixtures */

const DAY = 86400;
const BASE = 1767225600;
const metrics = (count) => ({
  count,
  quota: { sum: count * 3, valid: count },
  input: { sum: count * 100, valid: count },
  output: { sum: count * 20, valid: count },
});
const days = Array.from({ length: 6 }, (_, index) => ({
  start: BASE + index * DAY,
  end: BASE + (index + 1) * DAY,
  metrics: metrics(4 + index),
}));
const analysis = {
  status: {
    id: 1, range: { start: BASE, end: BASE + 6 * DAY }, phase: 'complete', message: null,
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    scanned: 27, collected: 27, pages: 1, duplicates: 0, conflicts: 0, outside: 0,
    serverTotal: 27, actualStart: BASE + 10, actualEnd: BASE + 5 * DAY,
  },
  totals: metrics(27),
  modelCount: 2,
  availableModels: ['deepseek-v3', 'qwen-max'],
  models: [
    { model: 'deepseek-v3', metrics: metrics(20) },
    { model: 'qwen-max', metrics: metrics(7) },
  ],
  bins: days,
  hours: Array.from({ length: 24 }, (_, index) => index % 5),
  actualStart: BASE + 10,
  actualEnd: BASE + 5 * DAY,
};

const snapshot = {
  quota: {
    total_available: 900.5,
    total_granted: 1000,
    total_used: 99.5,
    unlimited_quota: false,
    expires_at: BASE + 30 * DAY,
    name: '测试令牌',
    model_limits_enabled: true,
    model_limits: { 'deepseek-v3': { max_tokens: 100 } },
  },
  models: [
    { id: 'deepseek-v3', supported_endpoint_types: ['openai', 'anthropic'] },
    { id: 'qwen-max', supported_endpoint_types: ['openai'] },
  ],
  prices: [
    { model_name: 'deepseek-v3', model_ratio: 2, completion_ratio: 1, quota_type: 0 },
  ],
  groupRatios: { default: 1, vip: 0.8 },
  errors: {},
  times: { quota: new Date().toISOString(), models: new Date().toISOString(), prices: new Date().toISOString() },
};

/* -------------------------------------------------------------------- render */

const cases = [];

const renderCase = (label, element, expectations) => {
  let markup;
  try {
    markup = renderToStaticMarkup(element);
  } catch (error) {
    problems.push(label + ' threw: ' + error.message);
    return;
  }
  cases.push(label);
  if (markup.length < 20) problems.push(label + ' rendered almost nothing');
  if (/undefined|NaN|\[object Object\]/.test(markup)) {
    const found = markup.match(/.{0,40}(?:undefined|NaN|\[object Object\]).{0,40}/);
    problems.push(label + ' leaked runtime text: ' + found[0]);
  }
  for (const key of Object.keys(ZH)) {
    if (markup.includes(key)) problems.push(label + ' shows the raw key ' + key);
  }
  for (const [needle, why] of expectations) {
    if (!markup.includes(needle)) problems.push(label + ' is missing ' + why + ' (' + needle + ')');
  }
};

// The panel shell (initial state: loading).
renderCase('Panel loading', React.createElement(internals.Panel, { t }), [
  [ZH['app.name'], 'the title'],
  [ZH['tab.overview'], 'the overview tab'],
  [ZH['common.loading'], 'the loading note'],
]);

// Overview: complete data, then partial failure, then nothing at all.
renderCase('Overview full', React.createElement(internals.OverviewTab, { t, snapshot }), [
  ['1,000', 'the granted total'],
  ['900.5', 'the available total'],
  ['测试令牌', 'the token name'],
  ['10.0%', 'the used ratio'],
  ['deepseek-v3 · max_tokens:100', 'the formatted model limit'],
  // The manual refresh has to be visible where the numbers are.
  [ZH['overview.updated'].split('{')[0], 'the last-read line'],
]);
renderCase('Overview no token', React.createElement(internals.OverviewTab, {
  t, snapshot: undefined,
}), [
  [ZH['overview.neverRead'], 'the never-read line'],
]);
renderCase('Overview partial', React.createElement(internals.OverviewTab, {
  t,
  snapshot: { ...snapshot, quota: undefined, errors: { quota: '无法连接接口或请求超时，请检查内网 / VPN 和服务器地址' } },
}), [
  ['无法连接接口或请求超时', 'the section error'],
]);
renderCase('Overview empty', React.createElement(internals.OverviewTab, { t, snapshot: undefined }), [
  [ZH['common.none'], 'the empty marker'],
]);
renderCase('Overview unlimited', React.createElement(internals.OverviewTab, {
  t,
  snapshot: { ...snapshot, quota: { ...snapshot.quota, unlimited_quota: true, expires_at: undefined } },
}), [
  [ZH['common.none'], 'the empty expiry'],
]);
// `expires_at: 0` is the gateway's "never expires"; it renders as the Unix
// epoch if taken literally, so it must read as a missing limit instead.
renderCase('Overview epoch expiry', React.createElement(internals.OverviewTab, {
  t,
  snapshot: { ...snapshot, quota: { ...snapshot.quota, expires_at: 0 } },
}), [
  [ZH['overview.noExpiry'], 'the no-limit marker'],
]);
if (renderToStaticMarkup(React.createElement(internals.OverviewTab, {
  t,
  snapshot: { ...snapshot, quota: { ...snapshot.quota, expires_at: 0 } },
})).includes('1970')) {
  problems.push('an epoch expiry still renders a 1970 date');
}
renderCase('Overview negative expiry', React.createElement(internals.OverviewTab, {
  t,
  snapshot: { ...snapshot, quota: { ...snapshot.quota, expires_at: -1 } },
}), [
  [ZH['overview.noExpiry'], 'the no-limit marker'],
]);

// Models and pricing.
renderCase('Models full', React.createElement(internals.ModelsTab, { t, snapshot }), [
  ['deepseek-v3', 'the model id'],
  ['qwen-max', 'the second model'],
]);
renderCase('Models empty', React.createElement(internals.ModelsTab, { t, snapshot: { errors: {} } }), [
  [ZH['common.nothing'], 'the empty table marker'],
]);

// Logs and analysis: initial state only (their data arrives from the Host).
renderCase('Logs gated', React.createElement(internals.LogsTab, { t, enabled: false }), [
  [ZH['logs.search'], 'the search placeholder'],
]);
renderCase('Logs ready', React.createElement(internals.LogsTab, { t, enabled: true }), [
  [ZH['logs.search'], 'the search placeholder'],
]);
renderCase('Analysis gated', React.createElement(internals.AnalysisTab, { t, enabled: false }), [
  [ZH['analysis.start'], 'the start button'],
  [ZH['analysis.needCollect'], 'the empty-result note'],
]);
renderCase('Analysis ready', React.createElement(internals.AnalysisTab, { t, enabled: true }), [
  [ZH['analysis.start'], 'the start button'],
]);

// Settings: no token yet, then configured.
renderCase('Settings empty', React.createElement(internals.SettingsTab, {
  t, settings: { baseUrl: 'http://newapi.example.com:3000', hasToken: false, defaultBaseUrl: 'http://newapi.example.com:3000', credentialsAvailable: true },
  onChanged: () => {}, onRefresh: () => {},
}), [
  ['newapi.example.com:3000', 'the default base URL'],
]);
renderCase('Settings configured', React.createElement(internals.SettingsTab, {
  t, settings: { baseUrl: 'http://127.0.0.1:9000', hasToken: true, defaultBaseUrl: 'http://newapi.example.com:3000', credentialsAvailable: true },
  onChanged: () => {}, onRefresh: () => {},
}), [
  ['127.0.0.1:9000', 'the saved base URL'],
]);
renderCase('Settings no credential service', React.createElement(internals.SettingsTab, {
  t, settings: { baseUrl: 'http://newapi.example.com:3000', hasToken: false, defaultBaseUrl: 'http://newapi.example.com:3000', credentialsAvailable: false },
  onChanged: () => {}, onRefresh: () => {},
}), []);

renderCase('Settings custom name', React.createElement(internals.SettingsTab, {
  t,
  settings: { baseUrl: 'http://newapi.example.com:3000', hasToken: true, defaultBaseUrl: 'http://newapi.example.com:3000', credentialsAvailable: true },
  displayName: '测试网关额度',
  onRename: () => {},
  onChanged: () => {},
  onRefresh: () => {},
}), [
  ['value="测试网关额度"', 'the display-name input value'],
  [ZH['conn.display'], 'the display-name card'],
  [ZH['conn.nameLive'], 'the live-apply hint'],
]);

// The tab that needs no data.
renderCase('Versions', React.createElement(internals.VersionsTab, { t }), [
  ['0.3.0', 'the current version heading'],
  ['0.2.0', 'the previous version heading'],
  ['0.1.0', 'the first version heading'],
  [ZH['versions.desktop'], 'the desktop comparison card'],
]);

// The sidebar row icon is the refresh control; both widths must render it.
renderCase('Row icon wide', React.createElement(rowIcon, { size: 16, active: true }), [
  ['aqi', 'the clickable wrapper'],
  ['<svg', 'the glyph'],
  [ZH['sidebar.refresh'], 'the tooltip'],
]);
renderCase('Row icon idle width', React.createElement(rowIcon, { size: 18, active: false }), [
  ['<svg', 'the glyph'],
  [ZH['sidebar.refresh'], 'the tooltip'],
]);

// Charts: the edge cases that used to produce NaN geometry.
const chart = (props) => React.createElement(internals.Chart, { ariaLabel: 'chart', ...props });
renderCase('Chart line', chart({
  labels: ['01-01', '01-02', '01-03'],
  series: [{ values: [3, 9, 4] }],
}), [['polyline', 'a line path']]);
renderCase('Chart bar', chart({
  kind: 'bar',
  labels: ['a', 'b'],
  series: [{ values: [3, 0] }],
  onSelect: () => {},
}), [['rect', 'a bar']]);
renderCase('Chart empty', chart({ labels: [], series: [{ values: [] }] }), [['svg', 'the frame']]);
renderCase('Chart single', chart({ labels: ['only'], series: [{ values: [5] }] }), [['circle', 'the single point']]);
renderCase('Chart zeros', chart({ labels: ['a', 'b', 'c'], series: [{ values: [0, 0, 0] }] }), [['svg', 'the frame']]);
renderCase('Chart large', chart({
  labels: Array.from({ length: 200 }, (_, index) => 'd' + index),
  series: [{ values: Array.from({ length: 200 }, (_, index) => (index * 7) % 31) }],
}), [['polyline', 'a line path']]);
renderCase('Chart multi', chart({
  labels: ['a', 'b'],
  series: [{ values: [1, 2] }, { values: [2, 1] }],
}), [['polyline', 'a line path']]);

renderCase('Rank empty', React.createElement(internals.RankList, { rows: [], emptyLabel: '没有数据' }), [
  ['没有数据', 'the empty label'],
]);
renderCase('Rank rows', React.createElement(internals.RankList, {
  rows: [{ label: 'deepseek-v3', value: 20, text: '20 次' }, { label: 'qwen-max', value: 7, text: '7 次' }],
  emptyLabel: '没有数据',
}), [['deepseek-v3', 'the model label'], ['100%', 'the peak bar']]);

// The dashboard tab with data is only reachable after a collection, so exercise
// its chart inputs directly (already done above) and the analysis result view
// through the exported bits it renders.

// English rendering of the data-driven tabs: a missing key would print as a key.
active = 'en';
renderCase('Overview (en)', React.createElement(internals.OverviewTab, { t: tEn, snapshot }), [
  ['1,000', 'the granted total'],
]);
renderCase('Panel (en)', React.createElement(internals.Panel, { t: tEn }), [
  [EN['app.name'], 'the English title'],
]);
renderCase('Settings (en)', React.createElement(internals.SettingsTab, {
  t: tEn, settings: { baseUrl: 'http://newapi.example.com:3000', hasToken: true, defaultBaseUrl: 'http://newapi.example.com:3000', credentialsAvailable: true },
  onChanged: () => {}, onRefresh: () => {},
}), []);
renderCase('Versions (en)', React.createElement(internals.VersionsTab, { t: tEn }), []);
renderCase('Logs (en)', React.createElement(internals.LogsTab, { t: tEn, enabled: false }), []);
renderCase('Analysis (en)', React.createElement(internals.AnalysisTab, { t: tEn, enabled: false }), []);
renderCase('Models (en)', React.createElement(internals.ModelsTab, { t: tEn, snapshot }), []);
active = 'zh';

/* ---------------------------------------------------------------- dictionary */

const zhKeys = Object.keys(ZH);
const enKeys = Object.keys(EN);
if (zhKeys.length !== enKeys.length) problems.push('zh has ' + zhKeys.length + ' keys, en has ' + enKeys.length);
for (const key of zhKeys) {
  if (EN[key] === undefined) problems.push('en is missing ' + key);
  if (typeof ZH[key] !== 'string' || ZH[key].length === 0) problems.push('zh ' + key + ' is empty');
  if (typeof EN[key] !== 'string' || EN[key].length === 0) problems.push('en ' + key + ' is empty');
}
for (const key of enKeys) if (ZH[key] === undefined) problems.push('zh is missing ' + key);

// Every {placeholder} must exist in both languages, or interpolation differs.
for (const key of zhKeys) {
  const placeholders = (text) => (String(text).match(/\{(\w+)\}/g) || []).sort().join(',');
  if (EN[key] !== undefined && placeholders(ZH[key]) !== placeholders(EN[key])) {
    problems.push(key + ' has mismatched placeholders: ' + placeholders(ZH[key]) + ' vs ' + placeholders(EN[key]));
  }
}

if (problems.length === 0) {
  console.log('RENDER TEST OK (' + cases.length + ' cases, ' + zhKeys.length + ' dictionary keys)');
  console.log('rendered: ' + cases.join(' | '));
} else {
  console.log('RENDER TEST FAILED (' + problems.length + ')');
  for (const problem of problems) console.log(' - ' + problem);
  process.exitCode = 1;
}
