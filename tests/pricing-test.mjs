/**
 * Unit test for the official-pricing parser.
 *
 * The Markdown below is the shape of
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md as read on
 * 2026-11-02: a header row naming one column per model, then six price rows
 * labelled by usage type and billing period. The test proves the parse keys off
 * those labels (so a column reorder or an extra feature row does not break it),
 * that it reports the page's own currency, and that a page it cannot read is
 * rejected instead of producing a half-filled table.
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const pluginDir = process.argv[2] || '.';
const problems = [];
const { parsePricingMarkdown } = await import(pathToFileURL(path.resolve(pluginDir, 'index.js')).href);

const PAGE = `
# 模型 & 价格

下表所列模型价格以“百万 tokens”为单位。

## 模型细节

| 模型 | 模型 | 模型 | deepseek-flash(1) | deepseek-v4-pro |
| --- | --- | --- | --- | --- |
| BASE URL (OpenAI 格式) | BASE URL (OpenAI 格式) | BASE URL (OpenAI 格式) | <https://api.deepseek.com> | <https://api.deepseek.com> |
| 模型版本 | 模型版本 | 模型版本 | DeepSeek-V4.1-Flash-1017 | DeepSeek-V4-Pro-0813 |
| 思考模式 | 思考模式 | 思考模式 | 支持 | 支持 |
| 价格(2) | 百万tokens输入 / （缓存命中） | 空闲时段 | 0.02元 | 0.15元 |
| 价格(2) | 百万tokens输入 / （缓存命中） | 高峰时段 | 0.04元 | 0.30元 |
| 价格(2) | 百万tokens输入 / （缓存未命中） | 空闲时段 | 1元 | 4.5元 |
| 价格(2) | 百万tokens输入 / （缓存未命中） | 高峰时段 | 2元 | 9.0元 |
| 价格(2) | 百万tokens输出 | 空闲时段 | 4元 | 13.5元 |
| 价格(2) | 百万tokens输出 | 高峰时段 | 8元 | 27.0元 |
| 并发限制(3) | 并发限制(3) | 并发限制(3) | 2500 | 500 |
`;

const parsed = parsePricingMarkdown(PAGE);
if (parsed.currency !== 'CNY') problems.push('currency is ' + parsed.currency);
const models = Object.keys(parsed.models);
if (models.length !== 2) problems.push('parsed ' + models.length + ' models: ' + models.join(','));
if (!models.includes('deepseek-flash') || !models.includes('deepseek-v4-pro')) {
  problems.push('model names are ' + models.join(','));
}
const flash = parsed.models['deepseek-flash'];
if (flash === undefined) problems.push('deepseek-flash is missing');
else {
  const expect = [
    ['peak', 'hit', 0.04], ['peak', 'miss', 2], ['peak', 'output', 8],
    ['offpeak', 'hit', 0.02], ['offpeak', 'miss', 1], ['offpeak', 'output', 4],
  ];
  for (const [period, kind, value] of expect) {
    if (flash[period][kind] !== value) {
      problems.push('flash ' + period + '.' + kind + ' is ' + flash[period][kind] + ' not ' + value);
    }
  }
}
const pro = parsed.models['deepseek-v4-pro'];
if (pro !== undefined && pro.offpeak.output !== 13.5) problems.push('pro off-peak output is ' + pro.offpeak.output);
// The feature rows must not be mistaken for models.
for (const junk of ['模型版本', '思考模式', '并发限制']) {
  if (parsed.models[junk] !== undefined) problems.push('a feature row became a model: ' + junk);
}
for (const model of models) {
  if (/deepseek\.com/.test(model)) problems.push('a URL became a model: ' + model);
}

// A USD page is reported as such, not silently treated as RMB.
const usdPage = PAGE.replace(/元/g, '$');
const usd = parsePricingMarkdown(usdPage);
if (usd.currency !== 'USD') problems.push('a dollar page reported ' + usd.currency);
if (usd.models['deepseek-flash'].peak.output !== 8) problems.push('the dollar page lost its numbers');

// Rejections: nothing that cannot be fully read may come back as a table.
const rejects = [
  ['empty', ''],
  ['no table', '# 模型 & 价格\n\n没有表格'],
  ['no models', '| 模型 | 模型 |\n| --- | --- |\n| 说明 | 说明 |'],
  ['incomplete prices', '| 模型 | 模型 | deepseek-flash |\n| --- | --- | --- |\n| 百万tokens输出 | 高峰时段 | 8元 |'],
];
for (const [label, page] of rejects) {
  let threw = false;
  try {
    parsePricingMarkdown(page);
  } catch {
    threw = true;
  }
  if (!threw) problems.push('a page with ' + label + ' was accepted');
}

if (problems.length === 0) {
  console.log('PRICING TEST OK (2 models, CNY + USD, 4 rejections)');
} else {
  console.log('PRICING TEST FAILED (' + problems.length + ')');
  for (const problem of problems) console.log(' - ' + problem);
  process.exitCode = 1;
}
