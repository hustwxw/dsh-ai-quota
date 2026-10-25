/**
 * Development self-check for the ai-quota plugin.
 *
 * Loads the Client bundle with a stub module table and a stub Context, then
 * proves three things without a browser: the factory returns the expected
 * plugin shape, `apply` registers both slots and both dictionaries, and every
 * translation key the components ask for exists in both languages.
 */

const fs = require('node:fs');
const path = require('node:path');

const dir = process.argv[2] || '.';
const source = fs.readFileSync(path.join(dir, 'client.js'), 'utf8');

let definition = null;
global.window = {
  __ModuleLoader__: { load(value) { definition = value; } },
  // The plugin listens for focus to refresh the badge on return.
  addEventListener() {},
  removeEventListener() {},
};
const ReactStub = {
  createElement() { return null; },
  useState() { return [null, () => {}]; },
  useEffect() {},
  useMemo() { return null; },
  useCallback(fn) { return fn; },
  useRef() { return { current: null }; },
};
// eslint-disable-next-line no-new-func
new Function('window', source)(global.window);

const problems = [];
if (definition === null) problems.push('bundle did not call __ModuleLoader__.load');
if (definition && definition.id !== '@local/dsh-ai-quota') problems.push('unexpected bundle id: ' + definition.id);

const plugin = definition.factory((specifier) => {
  if (specifier === 'react') return ReactStub;
  throw new Error('unexpected require: ' + specifier);
});

if (!Array.isArray(plugin.inject)) problems.push('plugin.inject is not an array');

const registrations = [];
const dictionaries = new Map();
let disposed = 0;
// The plugin polls the badge once on load and every 15 minutes; both are
// stubbed so the check stays synchronous and exits.
globalThis.fetch = async () => ({
  status: 200,
  json: async () => ({ ok: true, data: { quota: { total_granted: 100, total_available: 90 }, errors: {}, times: {} } }),
});
globalThis.setInterval = () => ({ stub: true });
globalThis.clearInterval = () => {};
const ctx = {
  slots: {
    inject(name, run) {
      registrations.push({ phase: 'inject', name });
      run();
    },
    register(config, component) {
      registrations.push({ phase: 'register', config, component });
      return () => { disposed += 1; };
    },
  },
  locale: {
    register(ns, dicts) {
      dictionaries.set(ns, dicts);
      return () => {};
    },
    bind(ns) {
      return (key) => key;
    },
  },
  effect(run) {
    const dispose = run();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  on() {},
};

plugin.apply(ctx);

const slots = registrations.filter((entry) => entry.phase === 'register');
if (slots.length !== 2) problems.push('expected 2 slot registrations, got ' + slots.length);
const sidebar = slots.find((entry) => entry.config.name === 'sidebar.panellist');
const main = slots.find((entry) => entry.config.name === 'main');
if (!sidebar) problems.push('sidebar.panellist was not registered');
if (!main) problems.push('main was not registered');
if (sidebar && main && sidebar.config.id !== main.config.key) {
  problems.push('sidebar id and main key differ: ' + sidebar.config.id + ' vs ' + main.config.key);
}
// The label may be a string or a thunk re-evaluated per read (so it follows a
// language switch); either way it must resolve to a non-empty string now.
const sidebarLabel = sidebar && sidebar.config.label;
const labelText = typeof sidebarLabel === 'function' ? sidebarLabel() : sidebarLabel;
if (typeof labelText !== 'string' || labelText.length === 0) {
  problems.push('sidebar registration has no label');
}
if (typeof sidebar?.component !== 'function') problems.push('sidebar component is not a function');
if (typeof main?.component !== 'function') problems.push('main component is not a function');

const dicts = dictionaries.get('ai-quota-panel');
if (!dicts) {
  problems.push('locale dictionary namespace "ai-quota-panel" was not registered');
} else {
  const zhKeys = Object.keys(dicts.zh || {});
  const enKeys = Object.keys(dicts.en || {});
  if (zhKeys.length === 0) problems.push('zh dictionary is empty');
  if (enKeys.length === 0) problems.push('en dictionary is empty');
  for (const key of zhKeys) if (!enKeys.includes(key)) problems.push('missing en key: ' + key);
  for (const key of enKeys) if (!zhKeys.includes(key)) problems.push('missing zh key: ' + key);

  const used = new Set();
  // `\bt` keeps method names such as `inject(` and `split(` out of the scan.
  const literal = /\bt\('([^']+)'/g;
  let match;
  while ((match = literal.exec(source)) !== null) used.add(match[1]);
  // Dynamic families the components build by concatenation.
  for (const tab of ['overview', 'models', 'logs', 'analysis', 'settings', 'versions']) used.add('tab.' + tab);
  for (const phase of ['running', 'complete', 'cancelled', 'failed']) used.add('analysis.phase.' + phase);

  for (const key of used) {
    // A trailing dot is a dynamic family, expanded into concrete keys below.
    if (key.endsWith('.')) {
      used.delete(key);
      continue;
    }
    if (!zhKeys.includes(key)) problems.push('zh dictionary lacks used key: ' + key);
    if (!enKeys.includes(key)) problems.push('en dictionary lacks used key: ' + key);
  }
  const unused = zhKeys.filter((key) => !used.has(key));
  if (unused.length > 0) problems.push('unused dictionary keys: ' + unused.join(', '));
  console.log('dictionary: ' + zhKeys.length + ' keys, ' + used.size + ' referenced');
}

console.log('registrations: ' + slots.map((entry) => entry.config.name).join(', '));
if (problems.length === 0) {
  console.log('SELF-CHECK OK');
} else {
  console.log('SELF-CHECK FAILED (' + problems.length + ')');
  for (const problem of problems) console.log(' - ' + problem);
  process.exitCode = 1;
}
