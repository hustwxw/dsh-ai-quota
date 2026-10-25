/**
 * Client half of the AI quota panel bundle.
 *
 * Renders one sidebar icon plus the panel it addresses. Every number on screen
 * comes from the Host half's `/x-ai-quota` route; this module owns no network
 * target, no credential and no storage. All copy goes through the Client locale
 * service, and all colour through theme tokens, so the panel follows the
 * user's language and theme without importing any Harness Client package.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-ai-quota',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = 'ai-quota-panel';
    const ROUTE = '/x-ai-quota';
    const PANEL_ID = 'ai-quota-panel';
    const PAGE_SIZES = [20, 50, 100];
    const MAX_RANGE_SECONDS = 93 * 86400;
    /** How often the sidebar percentage re-reads the gateway. */
    const BADGE_INTERVAL_MS = 15 * 60 * 1000;

    /* ------------------------------------------------------------ dictionaries */

    const ZH = {
      'app.name': 'AI 额度',
      'sidebar.refresh': '刷新额度（点图标即可，不会打开面板）',
      'sidebar.refreshing': '正在刷新额度…',
      'sidebar.done': '额度已刷新',
      'sidebar.failed': '额度刷新失败',
      'app.subtitle': 'AI 网关',
      'app.refresh': '刷新',
      'app.refreshing': '读取中…',
      'app.badgeAuto': '点侧边栏那个额度图标＝立即刷新（不会打开面板），点文字才进面板；面板右上角「刷新」也一样。此外每 15 分钟自动更新一次，切回本页也会自动更新。查不到额度时不显示百分比。',
      'tab.overview': '概览',
      'tab.models': '模型与计费',
      'tab.logs': '调用记录',
      'tab.analysis': '调用分析',
      'tab.settings': '连接设置',
      'tab.versions': '版本历史',
      'common.none': '未返回',
      'common.unknown': '未返回模型',
      'common.emptyModel': '空模型名称',
      'common.loading': '读取中…',
      'common.prev': '上一页',
      'common.next': '下一页',
      'common.close': '关闭',
      'common.cancel': '取消',
      'common.confirm': '确定',
      'common.nothing': '暂无数据',
      'state.noToken': '尚未配置 skey，请先到「连接设置」保存。',
      'conn.title': '连接设置',
      'conn.intro': 'skey 只保存在本机凭据库，页面只显示是否已配置，不会回显。',
      'conn.display': '显示名称',
      'conn.name': '侧边栏与面板标题',
      'conn.nameHint': '留空则用默认名称「{name}」，最多 {max} 个字符',
      'conn.nameLive': '改完移出输入框（或按回车）立即生效；这个名称只存在本浏览器，不写凭据库。',
      'conn.server': '服务器地址',
      'conn.serverHint': '只填 http(s)://主机:端口，例如 {base}',
      'conn.skey': 'skey（API Token）',
      'conn.skeyHint': '留空表示沿用已保存的 skey',
      'conn.save': '保存并读取',
      'conn.saving': '保存中…',
      'conn.import': '导入本机环境变量',
      'conn.importHint': '从 AI_QUOTA_SKEY 读取一次',
      'conn.forget': '清除凭据',
      'conn.forgetAsk': '确定清除本机保存的 skey 和服务器地址？',
      'conn.configured': '已配置 skey',
      'conn.missing': '未配置 skey',
      'conn.noCredentials': '当前环境没有凭据服务，无法保存 skey。',
      'conn.savedNoRead': '已保存。',
      'overview.granted': '总额度',
      'overview.used': '已用额度',
      'overview.available': '剩余额度',
      'overview.ratio': '使用率',
      'overview.expires': '到期时间',
      'overview.noExpiry': '暂无限制',
      'overview.neverRead': '还没有读取过额度',
      'overview.name': '令牌名称',
      'overview.unlimited': '不限额度',
      'overview.limits': '模型限制',
      'overview.limitsOn': '已开启',
      'overview.limitsOff': '未开启',
      'overview.limited': '受限模型',
      'overview.updated': '读取于 {time}',
      'overview.modelsSummary': '可用模型 {count} 个',
      'models.sub': '倍率为计费比例，价格与分组来自公开计费接口。',
      'models.available': '可用模型',
      'models.count': '共 {count} 个',
      'models.endpoints': '支持的端点',
      'models.pricing': '模型计费',
      'models.pricingCount': '共 {count} 个',
      'models.name': '模型',
      'models.ratio': '模型倍率',
      'models.completion': '补全倍率',
      'models.cache': '缓存倍率',
      'models.cacheWrite': '缓存写入倍率',
      'models.quotaType': '计费类型',
      'models.price': '模型价格',
      'models.groups': '可用分组',
      'models.groupRatios': '分组倍率',
      'models.filter': '搜索模型',
      'logs.sub': '分页读取，搜索只作用于当前已加载的这一页。',
      'logs.search': '搜索模型名或请求 ID',
      'logs.pageSize': '每页',
      'logs.time': '时间',
      'logs.model': '模型',
      'logs.quota': '额度',
      'logs.prompt': '输入',
      'logs.completion': '输出',
      'logs.useTime': '耗时（秒）',
      'logs.cache': '缓存读 / 写',
      'logs.stream': '流式',
      'logs.requestId': '请求 ID',
      'logs.empty': '没有符合条件的记录',
      'logs.detail': '记录详情',
      'logs.fetchedAt': '读取于 {time}',
      'logs.total': '共 {total} 条',
      'logs.page': '第 {page} 页',
      'analysis.sub': '按时间范围逐页回读调用记录，只统计范围内的数据。',
      'analysis.range': '时间范围',
      'analysis.from': '开始日期',
      'analysis.to': '结束日期',
      'analysis.offset': '时区',
      'analysis.offset480': 'UTC+8（北京时间）',
      'analysis.offset0': 'UTC',
      'analysis.grain': '粒度',
      'analysis.day': '按天',
      'analysis.hour': '按小时',
      'analysis.start': '开始采集',
      'analysis.cancel': '取消采集',
      'analysis.polling': '采集中…',
      'analysis.phase.running': '采集中',
      'analysis.phase.complete': '已完成',
      'analysis.phase.cancelled': '已取消',
      'analysis.phase.failed': '失败',
      'analysis.progress': '已扫描 {scanned} 条，命中 {collected} 条，共 {pages} 页',
      'analysis.skipped': '跳过范围外 {outside} 条、重复 {duplicates} 条、时间冲突 {conflicts} 条',
      'analysis.serverTotal': '服务器报告共 {total} 条',
      'analysis.badRange': '请选择有效日期，开始不能晚于结束，范围最长 93 天。',
      'analysis.empty': '该范围内没有调用记录',
      'analysis.needCollect': '先选择范围并开始采集，采完后再看图表。',
      'analysis.totalsCount': '调用次数',
      'analysis.totalsQuota': '额度消耗',
      'analysis.totalsToken': '输入 / 输出 Token',
      'analysis.models': '覆盖模型',
      'analysis.chart.trend': '调用趋势',
      'analysis.chart.rank': '模型排行',
      'analysis.chart.tokens': 'Token 趋势',
      'analysis.chart.hours': '小时分布',
      'analysis.metric.count': '次数',
      'analysis.metric.quota': '额度',
      'analysis.filters': '模型筛选',
      'analysis.filtersAll': '全部模型',
      'analysis.filtersHint': '点击可只看某个模型',
      'analysis.drill': '{label} · 明细',
      'analysis.drillHint': '点击图表上的柱子或点查看明细',
      'analysis.drillEmpty': '该时间点没有记录',
      'analysis.detailCount': '共 {total} 条',
      'analysis.reset': '返回全部',
      'analysis.other': '其他 {count} 个模型',
      'versions.sub': '本插件与桌面版 ai-quota-tauri 功能对齐。',
      'versions.0.3.0.title': '显示名称可配置',
      'versions.0.3.0.date': '2026-10-26',
      'versions.0.3.0.items': '连接设置可以改侧边栏与面板标题的显示名称（默认「AI 额度」，只存本浏览器）、名称与百分比在同一行、改名立即生效',
      'versions.0.2.0.title': '侧边栏额度百分比',
      'versions.0.2.0.date': '2026-10-25',
      'versions.0.2.0.items': '侧边栏行显示剩余额度百分比、点该行图标即刷新额度（点文字才是打开面板）、每 15 分钟自动更新、切回窗口自动更新、查不到额度时不显示、到期时间为 0 时显示「暂无限制」',
      'versions.0.1.0.title': '首个 DSH 版本',
      'versions.0.1.0.date': '2026-10-24',
      'versions.0.1.0.items': '额度概览、模型限制、分页调用记录与详情、模型计费、按时间范围的调用分析与图表下钻、本机凭据保存 skey',
      'versions.desktop': '桌面版基线',
      'versions.desktop.value': 'ai-quota-tauri 0.3.0',
    }

    const EN = {
      'app.name': 'AI Quota',
      'sidebar.refresh': 'Refresh the quota (click the icon; it does not open the panel)',
      'sidebar.refreshing': 'Refreshing the quota…',
      'sidebar.done': 'Quota updated',
      'sidebar.failed': 'Quota refresh failed',
      'app.subtitle': 'AI gateway',
      'app.refresh': 'Refresh',
      'app.refreshing': 'Reading…',
      'app.badgeAuto': 'Clicking the quota icon in the sidebar refreshes it at once without opening the panel; clicking the text still opens the panel, and Refresh in the panel does the same. It also refreshes every 15 minutes and whenever this tab regains focus. It is hidden when the quota cannot be read.',
      'tab.overview': 'Overview',
      'tab.models': 'Models & pricing',
      'tab.logs': 'Call log',
      'tab.analysis': 'Analysis',
      'tab.settings': 'Connection',
      'tab.versions': 'Versions',
      'common.none': 'not returned',
      'common.unknown': 'unknown model',
      'common.emptyModel': 'empty model name',
      'common.loading': 'Loading…',
      'common.prev': 'Previous',
      'common.next': 'Next',
      'common.close': 'Close',
      'common.cancel': 'Cancel',
      'common.confirm': 'Confirm',
      'common.nothing': 'Nothing to show',
      'state.noToken': 'No skey configured yet — save one under Connection.',
      'conn.title': 'Connection',
      'conn.intro': 'The skey is stored in the local credential store; the page only shows whether one exists.',
      'conn.display': 'Display name',
      'conn.name': 'Sidebar row and panel title',
      'conn.nameHint': 'Leave it empty for the default name "{name}"; at most {max} characters',
      'conn.nameLive': 'Applies as soon as the field loses focus (or on Enter). Stored in this browser only, never in the credential store.',
      'conn.server': 'Server address',
      'conn.serverHint': 'Origin only, e.g. {base}',
      'conn.skey': 'skey (API token)',
      'conn.skeyHint': 'Leave empty to keep the stored skey',
      'conn.save': 'Save and read',
      'conn.saving': 'Saving…',
      'conn.import': 'Import from environment',
      'conn.importHint': 'Reads AI_QUOTA_SKEY once',
      'conn.forget': 'Forget credential',
      'conn.forgetAsk': 'Forget the stored skey and server address?',
      'conn.configured': 'skey configured',
      'conn.missing': 'no skey',
      'conn.noCredentials': 'This profile has no credential service, so the skey cannot be saved.',
      'conn.savedNoRead': 'Saved.',
      'overview.granted': 'Granted',
      'overview.used': 'Used',
      'overview.available': 'Available',
      'overview.ratio': 'Usage',
      'overview.expires': 'Expires',
      'overview.noExpiry': 'No expiry',
      'overview.neverRead': 'Quota not read yet',
      'overview.name': 'Token name',
      'overview.unlimited': 'Unlimited',
      'overview.limits': 'Model limits',
      'overview.limitsOn': 'enabled',
      'overview.limitsOff': 'disabled',
      'overview.limited': 'Limited models',
      'overview.updated': 'read at {time}',
      'overview.modelsSummary': '{count} models available',
      'models.sub': 'Ratios are billing multipliers; prices and groups come from the public pricing endpoint.',
      'models.available': 'Available models',
      'models.count': '{count} total',
      'models.endpoints': 'Supported endpoints',
      'models.pricing': 'Model pricing',
      'models.pricingCount': '{count} total',
      'models.name': 'Model',
      'models.ratio': 'Model ratio',
      'models.completion': 'Completion ratio',
      'models.cache': 'Cache ratio',
      'models.cacheWrite': 'Cache write ratio',
      'models.quotaType': 'Quota type',
      'models.price': 'Model price',
      'models.groups': 'Groups',
      'models.groupRatios': 'Group ratios',
      'models.filter': 'Filter models',
      'logs.sub': 'Read page by page; search only covers the page currently loaded.',
      'logs.search': 'Search model name or request ID',
      'logs.pageSize': 'Per page',
      'logs.time': 'Time',
      'logs.model': 'Model',
      'logs.quota': 'Quota',
      'logs.prompt': 'Input',
      'logs.completion': 'Output',
      'logs.useTime': 'Seconds',
      'logs.cache': 'Cache read / write',
      'logs.stream': 'Stream',
      'logs.requestId': 'Request ID',
      'logs.empty': 'No matching records',
      'logs.detail': 'Record detail',
      'logs.fetchedAt': 'read at {time}',
      'logs.total': '{total} records',
      'logs.page': 'page {page}',
      'analysis.sub': 'Walks the call log page by page and only counts records inside the range.',
      'analysis.range': 'Range',
      'analysis.from': 'From',
      'analysis.to': 'To',
      'analysis.offset': 'Timezone',
      'analysis.offset480': 'UTC+8 (Beijing)',
      'analysis.offset0': 'UTC',
      'analysis.grain': 'Grain',
      'analysis.day': 'Daily',
      'analysis.hour': 'Hourly',
      'analysis.start': 'Start reading',
      'analysis.cancel': 'Cancel',
      'analysis.polling': 'Reading…',
      'analysis.phase.running': 'reading',
      'analysis.phase.complete': 'complete',
      'analysis.phase.cancelled': 'cancelled',
      'analysis.phase.failed': 'failed',
      'analysis.progress': 'scanned {scanned}, kept {collected}, {pages} pages',
      'analysis.skipped': 'skipped {outside} outside range, {duplicates} duplicates, {conflicts} conflicts',
      'analysis.serverTotal': 'server reports {total} records',
      'analysis.badRange': 'Pick a valid range; the start must not follow the end, and the span must stay within 93 days.',
      'analysis.empty': 'No calls inside this range',
      'analysis.needCollect': 'Pick a range and start reading to see the charts.',
      'analysis.totalsCount': 'Calls',
      'analysis.totalsQuota': 'Quota used',
      'analysis.totalsToken': 'Input / output tokens',
      'analysis.models': 'Models covered',
      'analysis.chart.trend': 'Call trend',
      'analysis.chart.rank': 'Model ranking',
      'analysis.chart.tokens': 'Token trend',
      'analysis.chart.hours': 'Hour of day',
      'analysis.metric.count': 'Calls',
      'analysis.metric.quota': 'Quota',
      'analysis.filters': 'Model filter',
      'analysis.filtersAll': 'All models',
      'analysis.filtersHint': 'Pick one model to narrow the view',
      'analysis.drill': '{label} · detail',
      'analysis.drillHint': 'Click a bar or point to see the records behind it',
      'analysis.drillEmpty': 'No records at this point',
      'analysis.detailCount': '{total} records',
      'analysis.reset': 'Back to all',
      'analysis.other': '{count} other models',
      'versions.sub': 'This plugin matches the desktop ai-quota-tauri feature set.',
      'versions.0.3.0.title': 'Configurable display name',
      'versions.0.3.0.date': '2026-10-26',
      'versions.0.3.0.items': 'The Connection tab sets the display name used by the sidebar row and the panel title (default "AI Quota", stored in this browser only); the name and the percentage share one row; a rename applies at once',
      'versions.0.2.0.title': 'Sidebar percentage',
      'versions.0.2.0.date': '2026-10-25',
      'versions.0.2.0.items': 'Remaining-quota percentage in the sidebar row, clicking that row icon refreshes the quota (clicking the text opens the panel), refreshed every 15 minutes and whenever this tab regains focus, hidden when the quota cannot be read, and an expiry of 0 reads as no expiry',
      'versions.0.1.0.title': 'First DSH release',
      'versions.0.1.0.date': '2026-10-24',
      'versions.0.1.0.items': 'Quota overview, model limits, paginated call log with detail, model pricing, ranged call analysis with drill-down, local credential storage for the skey',
      'versions.desktop': 'Desktop baseline',
      'versions.desktop.value': 'ai-quota-tauri 0.3.0',
    }

    /* --------------------------------------------------------------- transport */

    /** One Host call; every failure arrives as a message worth showing verbatim. */
    async function api(path, options) {
      const init = { method: (options && options.method) || 'GET', headers: {}, credentials: 'same-origin' };
      if (options && options.body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      }
      let response;
      try {
        response = await fetch(ROUTE + path, init);
      } catch {
        throw new Error('无法连接本机服务，请刷新页面后重试');
      }
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (body === null) throw new Error('本机服务返回了非 JSON 响应（HTTP ' + response.status + '）');
      if (body.ok !== true) {
        throw new Error(typeof body.error === 'string' ? body.error : '请求失败（HTTP ' + response.status + '）');
      }
      return body.data;
    }

    /* ------------------------------------------------------------------ format */

    /** A number, or the placeholder that says the field was absent. */
    function numberText(t, value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return t('common.none');
      return value.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
    }

    /** A model name, naming the two degenerate cases the gateway can send. */
    function modelText(t, value) {
      if (typeof value !== 'string') return t('common.unknown');
      if (value.length === 0) return t('common.emptyModel');
      return value;
    }

    /** `seconds` (Unix) rendered in the chosen offset, `YYYY-MM-DD[ HH:mm]`. */
    function dateText(seconds, offsetMinutes, withHour) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
      const iso = new Date((seconds + offsetMinutes * 60) * 1000).toISOString();
      return iso.slice(0, withHour ? 16 : 10).replace('T', ' ');
    }

    /**
     * The quota's expiry as text. A non-positive `expires_at` is how the gateway
     * says "no expiry" (it renders as the Unix epoch, 1970-01-01), so it must
     * read as a limit that does not exist rather than a date from 1970.
     */
    function expiryText(t, quota) {
      if (quota === null || quota === undefined || typeof quota !== 'object') return t('common.none');
      const expires = quota.expires_at;
      if (typeof expires !== 'number' || !Number.isFinite(expires)) return t('common.none');
      if (expires <= 0) return t('overview.noExpiry');
      return dateText(expires, 480, true);
    }

    /** An ISO timestamp rendered in local time. */
    function stampText(iso) {
      if (typeof iso !== 'string') return '—';
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return '—';
      const pad = (value) => String(value).padStart(2, '0');
      return at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) +
        ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes());
    }

    /**
     * One `model_limits` value rendered as text. The gateway field is not
     * pinned down: it arrives as a number, a string, or a small object, and a
     * bare `String(value)` would print `[object Object]` for the last case.
     */
    function limitText(value) {
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
      if (typeof value === 'string') return value.length === 0 ? null : value;
      if (typeof value === 'boolean') return value ? '✓' : '—';
      if (Array.isArray(value)) {
        const items = value.map((entry) => (typeof entry === 'object' ? null : String(entry))).filter((entry) => entry !== null);
        return items.length === 0 ? null : items.join(' / ');
      }
      if (value !== null && typeof value === 'object') {
        const pairs = [];
        for (const key of Object.keys(value)) {
          const entry = value[key];
          if (typeof entry === 'object') continue;
          pairs.push(key + ':' + String(entry));
        }
        return pairs.length === 0 ? null : pairs.join(', ');
      }
      return null;
    }

    /** A share of a whole, as a percentage string. */
    function ratioText(part, whole) {
      if (typeof part !== 'number' || typeof whole !== 'number' || !Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
        return null;
      }
      return Math.max(0, Math.min(100, (part / whole) * 100));
    }

    /** Today's date and the start of a `days`-long window, in one offset. */
    function presetRange(days, offsetMinutes) {
      const now = Date.now() + offsetMinutes * 60000;
      return {
        from: new Date(now - (days - 1) * 86400000).toISOString().slice(0, 10),
        to: new Date(now).toISOString().slice(0, 10),
      };
    }

    /** Two `YYYY-MM-DD` dates as the `[start, end)` the analysis endpoints take. */
    function dateRange(from, to, offsetMinutes) {
      const start = Date.parse(from + 'T00:00:00Z') / 1000 - offsetMinutes * 60;
      const end = Date.parse(to + 'T00:00:00Z') / 1000 + 86400 - offsetMinutes * 60;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('bad-range');
      if (end - start > MAX_RANGE_SECONDS) throw new Error('bad-range');
      return { start, end };
    }

    /* ------------------------------------------------------------------- style */

    const CSS = [
      '.aq-root{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);',
      'font-size:13px;line-height:1.55;font-family:inherit}',
      '.aq-head{display:flex;align-items:center;gap:10px;padding:14px 20px 10px;flex:0 0 auto}',
      '.aq-title{font-size:16px;font-weight:600;letter-spacing:.2px}',
      '.aq-sub{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.aq-spacer{flex:1 1 auto}',
      '.aq-tabs{display:flex;gap:4px;padding:0 16px 10px;flex:0 0 auto;overflow-x:auto;scrollbar-width:thin}',
      '.aq-tab{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;',
      'padding:5px 12px;border-radius:14px;cursor:pointer;white-space:nowrap}',
      '.aq-tab:hover{background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1))}',
      '.aq-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));',
      'color:var(--dsw-alias-label-primary);font-weight:600}',
      '.aq-tab[data-disabled="true"]{opacity:.45;cursor:not-allowed}',
      '.aq-body{flex:1 1 auto;min-height:0;overflow:auto;padding:4px 20px 28px;scrollbar-width:thin}',
      '.aq-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 13px;',
      'border-radius:15px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}',
      '.aq-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}',
      '.aq-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.aq-btn[data-kind="primary"]{border-color:transparent;background:var(--dsw-alias-brand-primary);',
      'color:var(--dsw-alias-label-primary-foreground,#fff)}',
      '.aq-btn[data-kind="danger"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-border-l1)}',
      '.aq-btn[data-kind="ghost"]{background:transparent}',
      '.aq-input,.aq-select{height:32px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1);',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;',
      'padding:0 8px;min-width:0;box-sizing:border-box}',
      '.aq-input:focus,.aq-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.aq-input[type="password"]{letter-spacing:1px}',
      '.aq-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.aq-field{display:flex;flex-direction:column;gap:5px;min-width:0}',
      '.aq-label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.aq-hint{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.aq-note{font-size:12px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);',
      'border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}',
      '.aq-error{font-size:12px;padding:8px 10px;border-radius:8px;border:.5px solid var(--dsw-alias-state-error-primary);',
      'color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1);white-space:pre-wrap}',
      '.aq-ok{font-size:12px;color:var(--dsw-alias-state-success-primary)}',
      '.aq-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);',
      'padding:12px 14px;min-width:0}',
      '.aq-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}',
      '.aq-card-title{font-size:13px;font-weight:600}',
      '.aq-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}',
      '.aq-stat{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px;word-break:break-all}',
      '.aq-stat[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}',
      '.aq-stat[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.aq-meter{height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-border-l1));overflow:hidden;margin-top:8px}',
      '.aq-meter-fill{height:100%;background:var(--dsw-alias-brand-primary)}',
      '.aq-table-wrap{overflow:auto;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.aq-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}',
      '.aq-table th{position:sticky;top:0;z-index:1;text-align:left;font-weight:600;white-space:nowrap;',
      'padding:7px 10px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));',
      'border-bottom:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}',
      '.aq-table td{padding:6px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.aq-table tbody tr:last-child td{border-bottom:0}',
      '.aq-table tbody tr:hover td{background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1))}',
      '.aq-table td[data-num]{text-align:right}',
      '.aq-table td[data-wrap]{white-space:normal;word-break:break-all;min-width:180px}',
      '.aq-table tbody tr[data-clickable="true"]{cursor:pointer}',
      '.aq-pager{display:flex;align-items:center;gap:10px;padding:10px 0 0;font-size:12px;',
      'color:var(--dsw-alias-label-secondary);flex-wrap:wrap}',
      '.aq-chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.aq-chip{border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;padding:2px 9px;font-size:12px;',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit}',
      '.aq-chip[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.aq-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:2px}',
      '.aq-dot{display:inline-block;width:8px;height:8px;border-radius:4px;margin-right:5px;vertical-align:middle}',
      '.aq-chart{display:block;width:100%;height:auto;overflow:visible}',
      '.aq-chart text{font-size:10px;fill:var(--dsw-alias-label-secondary);font-family:inherit}',
      '.aq-hit{fill:transparent;cursor:pointer}',
      '.aq-hit:hover{fill:var(--dsw-alias-brand-primary);fill-opacity:.08}',
      '.aq-rank{display:flex;flex-direction:column;gap:6px}',
      '.aq-rank-row{display:grid;grid-template-columns:minmax(90px,1fr) 2fr auto;gap:8px;align-items:center;',
      'font-size:12px;cursor:pointer;border:0;background:transparent;color:inherit;font-family:inherit;padding:2px 0;text-align:left}',
      '.aq-rank-row:hover .aq-rank-name{color:var(--dsw-alias-brand-primary)}',
      '.aq-rank-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.aq-rank-bar{height:10px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-border-l1));overflow:hidden}',
      '.aq-rank-fill{height:100%;background:var(--dsw-alias-brand-primary);border-radius:5px}',
      '.aq-rank-value{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.aq-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;',
      'background:rgba(0,0,0,.32);padding:24px}',
      '.aq-modal{width:min(760px,100%);max-height:80vh;display:flex;flex-direction:column;border-radius:12px;',
      'background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));border:.5px solid var(--dsw-alias-border-l2);',
      'box-shadow:0 8px 32px rgba(0,0,0,.24)}',
      '.aq-modal-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.aq-modal-body{padding:14px 16px;overflow:auto;min-height:0}',
      '.aq-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:.5px solid var(--dsw-alias-border-l1)}',
      '.aq-kv{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;font-size:12px}',
      '.aq-kv dt{color:var(--dsw-alias-label-secondary)}',
      '.aq-kv dd{margin:0;word-break:break-all;font-variant-numeric:tabular-nums}',
      '.aq-section{margin-top:16px}',
      '.aq-section:first-child{margin-top:0}',
    ].join('');

    /* -------------------------------------------------------------------- atoms */

    function Button(props) {
      return h('button', {
        type: 'button',
        className: 'aq-btn',
        'data-kind': props.kind || 'default',
        disabled: props.disabled === true,
        title: props.title,
        onClick: props.onClick,
      }, props.children);
    }

    function Field(props) {
      return h('div', { className: 'aq-field', style: props.style },
        h('span', { className: 'aq-label' }, props.label),
        props.children,
        props.hint === undefined ? null : h('span', { className: 'aq-hint' }, props.hint));
    }

    function Card(props) {
      return h('section', { className: 'aq-card', style: props.style },
        props.title === undefined ? null : h('div', { className: 'aq-card-head' },
          h('span', { className: 'aq-card-title' }, props.title),
          props.aside === undefined ? null : h('span', { className: 'aq-hint' }, props.aside)),
        props.children);
    }

    function Note(props) {
      if (props.children === undefined || props.children === null) return null;
      return h('p', { className: 'aq-note', style: props.style }, props.children);
    }

    function ErrorLine(props) {
      if (!props.children) return null;
      return h('p', { className: 'aq-error', style: props.style }, props.children);
    }

    function Stat(props) {
      return h('div', { className: 'aq-card' },
        h('div', { className: 'aq-label' }, props.label),
        h('div', { className: 'aq-stat', 'data-tone': props.tone }, props.value),
        props.meter === undefined ? null : h('div', { className: 'aq-meter' },
          h('div', { className: 'aq-meter-fill', style: { width: props.meter + '%' } })),
        props.foot === undefined ? null : h('div', { className: 'aq-hint' }, props.foot));
    }

    function Table(props) {
      const columns = props.columns;
      const rows = props.rows;
      if (rows.length === 0) {
        return h('div', { className: 'aq-table-wrap' },
          h('div', { className: 'aq-hint', style: { padding: '14px' } }, props.empty || '—'));
      }
      const head = h('thead', null, h('tr', null, columns.map((column) => h('th', {
        key: column.key,
        style: column.width ? { width: column.width } : undefined,
      }, column.label))));
      const body = h('tbody', null, rows.map((row, index) => h('tr', {
        key: row.key === undefined ? index : row.key,
        'data-clickable': row.onClick === undefined ? 'false' : 'true',
        onClick: row.onClick,
      }, columns.map((column) => {
        const cell = column.render ? column.render(row.value, row) : row.value[column.key];
        return h('td', {
          key: column.key,
          'data-num': column.numeric ? '' : undefined,
          'data-wrap': column.wrap ? '' : undefined,
        }, cell);
      }))));
      return h('div', { className: 'aq-table-wrap', style: props.style },
        h('table', { className: 'aq-table' }, head, body));
    }

    function Pager(props) {
      return h('div', { className: 'aq-pager' },
        h(Button, { kind: 'ghost', disabled: props.page <= 1 || props.busy, onClick: () => props.onPage(props.page - 1) }, props.prevLabel),
        h('span', null, props.label),
        h(Button, {
          kind: 'ghost',
          disabled: props.hasNext === false || props.busy,
          onClick: () => props.onPage(props.page + 1),
        }, props.nextLabel),
        props.extra === undefined ? null : props.extra);
    }

    function Modal(props) {
      return h('div', { className: 'aq-overlay', role: 'presentation', onClick: props.onClose },
        h('div', {
          className: 'aq-modal',
          role: 'dialog',
          'aria-modal': 'true',
          onClick: (event) => event.stopPropagation(),
        },
          h('div', { className: 'aq-modal-head' },
            h('span', { className: 'aq-card-title' }, props.title),
            h('span', { className: 'aq-spacer' }),
            h(Button, { kind: 'ghost', onClick: props.onClose }, props.closeLabel)),
          h('div', { className: 'aq-modal-body' }, props.children),
          props.footer === undefined ? null : h('div', { className: 'aq-modal-foot' }, props.footer)));
    }

    /* ------------------------------------------------------------------- charts */

    /**
     * Rules for the sidebar row icon. It renders outside the panel, so it cannot
     * ride the panel's sheet; these are injected into `<head>` once per load.
     * Hover and the spin animation need a stylesheet, not inline styles.
     */
    const ICON_CSS = [
      '.aqi:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.aqi[data-state="busy"]{opacity:.65}',
      '.aqi[data-state="busy"] .aqi-glyph{animation:aqi-spin .9s linear infinite}',
      '.aqi[data-state="done"]{color:var(--dsw-alias-state-success-primary)}',
      '.aqi[data-state="failed"]{color:var(--dsw-alias-state-error-primary)}',
      '@keyframes aqi-spin{to{transform:rotate(360deg)}}',
    ].join('');

    const SERIES_COLORS = ['var(--dsw-alias-brand-primary)', 'var(--dsw-alias-state-success-primary)'];

    /**
     * One tiny SVG line/bar chart. No chart library is reachable from a bundle,
     * so this draws axes, one path or a bar per bucket, and an invisible
     * full-height hit column per index that reports the click.
     */
    function Chart(props) {
      const width = 640;
      const height = props.height || 170;
      const padTop = 12;
      const padBottom = 22;
      const padLeft = 46;
      const padRight = 10;
      const plotWidth = width - padLeft - padRight;
      const plotHeight = height - padTop - padBottom;
      const labels = props.labels;
      const series = props.series;
      const values = [];
      for (const entry of series) {
        for (const value of entry.values) {
          if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
        }
      }
      const peak = values.length > 0 ? Math.max.apply(null, values) : 0;
      const top = peak > 0 ? peak : 1;
      const count = labels.length;
      const step = count > 1 ? plotWidth / (count - 1) : 0;
      const barSlot = count > 0 ? plotWidth / count : plotWidth;
      const xAt = (index) => (count > 1 ? padLeft + step * index : padLeft + plotWidth / 2);
      const yAt = (value) => padTop + plotHeight - (Math.max(0, value) / top) * plotHeight;
      const tickCount = 3;
      const ticks = [];
      for (let index = 0; index < tickCount; index += 1) {
        const value = (top / (tickCount - 1)) * index;
        ticks.push({ value, y: yAt(value) });
      }
      const labelAt = (index) => {
        if (count === 0) return null;
        if (count === 1) return index === 0 ? labels[0] : null;
        const every = Math.max(1, Math.ceil(count / 6));
        return index === 0 || index === count - 1 || index % every === 0 ? labels[index] : null;
      };

      const children = [];
      for (const tick of ticks) {
        children.push(h('line', {
          key: 'g' + tick.value,
          x1: padLeft,
          x2: padLeft + plotWidth,
          y1: tick.y,
          y2: tick.y,
          stroke: 'var(--dsw-alias-border-l1)',
          strokeWidth: 1,
        }));
        children.push(h('text', {
          key: 't' + tick.value,
          x: padLeft - 6,
          y: tick.y + 3,
          textAnchor: 'end',
        }, props.format ? props.format(tick.value) : String(Math.round(tick.value))));
      }

      if (props.kind === 'bar') {
        const barWidth = Math.max(2, barSlot * 0.62);
        for (let index = 0; index < count; index += 1) {
          const value = series[0].values[index];
          const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0;
          const y = yAt(safe);
          children.push(h('rect', {
            key: 'b' + index,
            x: padLeft + barSlot * index + (barSlot - barWidth) / 2,
            y,
            width: barWidth,
            height: Math.max(safe > 0 ? 1 : 0, padTop + plotHeight - y),
            rx: Math.min(3, barWidth / 2),
            fill: props.color || SERIES_COLORS[0],
            opacity: 0.9,
          }));
        }
      } else {
        for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
          const entry = series[seriesIndex];
          const points = [];
          for (let index = 0; index < count; index += 1) {
            const value = entry.values[index];
            if (typeof value !== 'number' || !Number.isFinite(value)) continue;
            points.push(xAt(index) + ',' + yAt(value));
          }
          children.push(h('polyline', {
            key: 'p' + seriesIndex,
            points: points.join(' '),
            fill: 'none',
            stroke: entry.color || SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
            strokeWidth: 1.8,
            strokeLinejoin: 'round',
            strokeLinecap: 'round',
          }));
          for (let index = 0; index < count; index += 1) {
            const value = entry.values[index];
            if (typeof value !== 'number' || !Number.isFinite(value)) continue;
            children.push(h('circle', {
              key: 'c' + seriesIndex + '_' + index,
              cx: xAt(index),
              cy: yAt(value),
              r: count > 60 ? 1.5 : 2.4,
              fill: entry.color || SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
            }));
          }
        }
      }

      for (let index = 0; index < count; index += 1) {
        const text = labelAt(index);
        if (text === null) continue;
        children.push(h('text', {
          key: 'x' + index,
          x: props.kind === 'bar' ? padLeft + barSlot * index + barSlot / 2 : xAt(index),
          y: height - 6,
          textAnchor: props.kind === 'bar' ? 'middle' : (index === 0 ? 'start' : (index === count - 1 ? 'end' : 'middle')),
        }, text));
      }

      if (props.onSelect) {
        for (let index = 0; index < count; index += 1) {
          children.push(h('rect', {
            key: 'h' + index,
            className: 'aq-hit',
            x: props.kind === 'bar' ? padLeft + barSlot * index : xAt(index) - (count > 1 ? step / 2 : plotWidth / 2),
            y: padTop,
            width: props.kind === 'bar' ? barSlot : (count > 1 ? step : plotWidth),
            height: plotHeight,
            onClick: () => props.onSelect(index),
          }));
        }
      }

      return h('svg', {
        className: 'aq-chart',
        viewBox: '0 0 ' + width + ' ' + height,
        role: 'img',
        'aria-label': props.ariaLabel,
      }, children);
    }

    /** Horizontal ranking bars; a model row narrows the view to that model. */
    function RankList(props) {
      const rows = props.rows;
      if (rows.length === 0) return h(Note, null, props.emptyLabel);
      const peak = rows.reduce((max, row) => Math.max(max, row.value), 0);
      return h('div', { className: 'aq-rank' }, rows.map((row) =>
        h('button', {
          key: row.label,
          type: 'button',
          className: 'aq-rank-row',
          title: row.label,
          onClick: row.onClick,
        },
          h('span', { className: 'aq-rank-name' }, row.label),
          h('span', { className: 'aq-rank-bar' },
            h('span', { className: 'aq-rank-fill', style: { width: (peak > 0 ? (row.value / peak) * 100 : 0) + '%' } })),
          h('span', { className: 'aq-rank-value' }, row.text))));
    }

    /* -------------------------------------------------------------------- tabs */

    function OverviewTab(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const quota = snapshot && snapshot.quota ? snapshot.quota : null;
      const models = snapshot && Array.isArray(snapshot.models) ? snapshot.models : null;
      const sectionError = snapshot && snapshot.errors && snapshot.errors.quota ? snapshot.errors.quota : null;
      const readAt = snapshot && snapshot.times && snapshot.times.quota ? stampText(snapshot.times.quota) : null;
      const ratio = quota ? ratioText(quota.total_used, quota.total_granted) : null;

      return h('div', null,
        h('p', { className: 'aq-hint', style: { margin: '0 0 10px' } },
          readAt === null ? t('overview.neverRead') : t('overview.updated', { time: readAt })),
        h(ErrorLine, null, sectionError),
        h('div', { className: 'aq-cards', style: { marginTop: sectionError ? '10px' : 0 } },
          h(Stat, { label: t('overview.granted'), value: quota ? numberText(t, quota.total_granted) : t('common.none') }),
          h(Stat, { label: t('overview.used'), value: quota ? numberText(t, quota.total_used) : t('common.none') }),
          h(Stat, { label: t('overview.available'), value: quota ? numberText(t, quota.total_available) : t('common.none') }),
          h(Stat, {
            label: t('overview.ratio'),
            value: ratio === null ? t('common.none') : ratio.toFixed(1) + '%',
            meter: ratio === null ? undefined : ratio,
            tone: ratio !== null && ratio >= 90 ? 'error' : (ratio !== null && ratio >= 70 ? 'warn' : undefined),
          })),
        h('div', { className: 'aq-cards', style: { marginTop: '10px' } },
          h(Stat, {
            label: t('overview.expires'),
            value: expiryText(t, quota),
          }),
          h(Stat, {
            label: t('overview.name'),
            value: quota && typeof quota.name === 'string' && quota.name.length > 0 ? quota.name : t('common.none'),
          }),
          h(Stat, {
            label: t('overview.unlimited'),
            value: quota && quota.unlimited_quota === true ? '✓' : (quota && quota.unlimited_quota === false ? '—' : t('common.none')),
          }),
          h(Stat, {
            label: t('overview.limits'),
            value: quota && quota.model_limits_enabled === true
              ? t('overview.limitsOn')
              : (quota && quota.model_limits_enabled === false ? t('overview.limitsOff') : t('common.none')),
            foot: models === null ? undefined : t('overview.modelsSummary', { count: models.length }),
          })),
        quota && quota.model_limits_enabled === true && quota.model_limits && typeof quota.model_limits === 'object'
          ? h('div', { className: 'aq-section' },
            h(Card, { title: t('overview.limited') },
              h('div', { className: 'aq-chips' },
                Object.keys(quota.model_limits).map((model) => {
                  const detail = limitText(quota.model_limits[model]);
                  return h('span', { key: model, className: 'aq-chip' }, detail === null ? model : model + ' · ' + detail);
                }))))
          : null);
    }

    function ModelsTab(props) {
      const t = props.t;
      const snapshot = props.snapshot || {};
      const models = Array.isArray(snapshot.models) ? snapshot.models : null;
      const prices = Array.isArray(snapshot.prices) ? snapshot.prices : null;
      const ratios = snapshot.groupRatios && typeof snapshot.groupRatios === 'object' ? snapshot.groupRatios : null;
      const [filter, setFilter] = useState('');

      const modelRows = useMemo(() => {
        if (models === null) return [];
        const needle = filter.trim().toLowerCase();
        return models
          .filter((entry) => needle.length === 0 || String(entry.id || '').toLowerCase().includes(needle))
          .map((entry) => ({ key: String(entry.id), value: entry }));
      }, [models, filter]);

      const priceRows = useMemo(() => {
        if (prices === null) return [];
        const needle = filter.trim().toLowerCase();
        return prices
          .filter((entry) => needle.length === 0 || String(entry.model_name || '').toLowerCase().includes(needle))
          .map((entry) => ({ key: String(entry.model_name), value: entry }));
      }, [prices, filter]);

      const endpoints = (value) => {
        if (!Array.isArray(value) || value.length === 0) return '—';
        return value.join(' / ');
      };
      const groups = (value) => {
        if (!Array.isArray(value) || value.length === 0) return '—';
        return value.join(' / ');
      };

      return h('div', null,
        h(ErrorLine, null, snapshot.errors ? snapshot.errors.models : null),
        h(ErrorLine, null, snapshot.errors ? snapshot.errors.prices : null),
        h(Card, {
          title: t('models.available'),
          aside: models === null ? undefined : t('models.count', { count: models.length }),
          style: { marginTop: '10px' },
        },
          h('div', { className: 'aq-row', style: { marginBottom: '10px' } },
            h('input', {
              className: 'aq-input',
              style: { flex: '1 1 220px' },
              type: 'search',
              placeholder: t('models.filter'),
              value: filter,
              onChange: (event) => setFilter(event.target.value),
            })),
          h(Table, {
            empty: t('common.nothing'),
            style: { maxHeight: '320px' },
            columns: [
              { key: 'id', label: t('models.name') },
              { key: 'endpoints', label: t('models.endpoints'), wrap: true },
            ],
            rows: modelRows.map((row) => ({
              key: row.key,
              value: { id: row.value.id === undefined ? t('common.none') : String(row.value.id), endpoints: endpoints(row.value.supported_endpoint_types) },
            })),
          })),
        ratios === null ? null : h(Card, { title: t('models.groupRatios'), style: { marginTop: '10px' } },
          h('div', { className: 'aq-chips' }, Object.keys(ratios).map((group) => {
            const detail = limitText(ratios[group]);
            return h('span', { key: group, className: 'aq-chip' }, group + (detail === null ? '' : ' × ' + detail));
          }))),
        h(Card, {
          title: t('models.pricing'),
          aside: prices === null ? undefined : t('models.pricingCount', { count: prices.length }),
          style: { marginTop: '10px' },
        },
          h(Table, {
            empty: t('common.nothing'),
            style: { maxHeight: '520px' },
            columns: [
              { key: 'model', label: t('models.name'), wrap: true },
              { key: 'ratio', label: t('models.ratio'), numeric: true },
              { key: 'completion', label: t('models.completion'), numeric: true },
              { key: 'cache', label: t('models.cache'), numeric: true },
              { key: 'cacheWrite', label: t('models.cacheWrite'), numeric: true },
              { key: 'quotaType', label: t('models.quotaType'), numeric: true },
              { key: 'price', label: t('models.price'), numeric: true },
              { key: 'groups', label: t('models.groups'), wrap: true },
            ],
            rows: priceRows.map((row) => ({
              key: row.key,
              value: {
                model: modelText(t, row.value.model_name),
                ratio: numberText(t, row.value.model_ratio),
                completion: numberText(t, row.value.completion_ratio),
                cache: numberText(t, row.value.cache_ratio),
                cacheWrite: numberText(t, row.value.create_cache_ratio),
                quotaType: numberText(t, row.value.quota_type),
                price: numberText(t, row.value.model_price),
                groups: groups(row.value.enable_groups),
              },
            })),
          })),
        h(Note, { style: { marginTop: '10px' } }, t('models.sub')));
    }

    function LogsTab(props) {
      const t = props.t;
      const enabled = props.enabled;
      const [page, setPage] = useState(1);
      const [pageSize, setPageSize] = useState(50);
      const [search, setSearch] = useState('');
      const [data, setData] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [detail, setDetail] = useState(null);

      const load = useCallback(async (nextPage, nextSize) => {
        setBusy(true);
        setError('');
        try {
          const result = await api('/logs?page=' + nextPage + '&pageSize=' + nextSize);
          setData(result);
        } catch (failure) {
          setError(failure.message);
          setData(null);
        } finally {
          setBusy(false);
        }
      }, []);

      useEffect(() => {
        if (enabled) void load(1, pageSize);
      }, [enabled, pageSize, load]);

      const items = data && Array.isArray(data.items) ? data.items : [];
      const needle = search.trim().toLowerCase();
      const rows = useMemo(() => items
        .filter((row) => {
          if (needle.length === 0) return true;
          const model = typeof row.model_name === 'string' ? row.model_name.toLowerCase() : '';
          const requestId = typeof row.request_id === 'string' ? row.request_id.toLowerCase() : '';
          return model.includes(needle) || requestId.includes(needle);
        })
        .map((row) => ({ key: String(row.id), value: row })), [items, needle]);

      const total = data && typeof data.total === 'number' ? data.total : null;
      const hasNext = total === null ? items.length === pageSize : page * pageSize < total;

      return h('div', null,
        h('div', { className: 'aq-row', style: { marginBottom: '10px' } },
          h('input', {
            className: 'aq-input',
            style: { flex: '1 1 240px' },
            type: 'search',
            placeholder: t('logs.search'),
            value: search,
            onChange: (event) => setSearch(event.target.value),
          }),
          h('select', {
            className: 'aq-select',
            value: String(pageSize),
            'aria-label': t('logs.pageSize'),
            onChange: (event) => {
              const next = Number(event.target.value);
              setPage(1);
              setPageSize(next);
            },
          }, PAGE_SIZES.map((size) => h('option', { key: size, value: String(size) }, size + ' / ' + t('logs.pageSize')))),
          h(Button, { kind: 'primary', disabled: busy || !enabled, onClick: () => void load(page, pageSize) },
            busy ? t('common.loading') : t('app.refresh'))),
        h(ErrorLine, null, error),
        h(Table, {
          empty: t('logs.empty'),
          style: { maxHeight: 'calc(100vh - 320px)', minHeight: '160px' },
          columns: [
            { key: 'time', label: t('logs.time') },
            { key: 'model', label: t('logs.model') },
            { key: 'quota', label: t('logs.quota'), numeric: true },
            { key: 'prompt', label: t('logs.prompt'), numeric: true },
            { key: 'completion', label: t('logs.completion'), numeric: true },
            { key: 'cache', label: t('logs.cache'), numeric: true },
            { key: 'useTime', label: t('logs.useTime'), numeric: true },
            { key: 'stream', label: t('logs.stream') },
            { key: 'requestId', label: t('logs.requestId') },
          ],
          rows: rows.map((row) => ({
            key: row.key,
            onClick: () => setDetail(row.value),
            value: {
              time: dateText(row.value.created_at, 480, true),
              model: modelText(t, row.value.model_name),
              quota: numberText(t, row.value.quota),
              prompt: numberText(t, row.value.prompt_tokens),
              completion: numberText(t, row.value.completion_tokens),
              cache: numberText(t, row.value.cache_tokens) + ' / ' + numberText(t, row.value.cache_write_tokens),
              useTime: numberText(t, row.value.use_time),
              stream: row.value.is_stream === true ? '✓' : (row.value.is_stream === false ? '—' : t('common.none')),
              requestId: typeof row.value.request_id === 'string' ? row.value.request_id : '—',
            },
          })),
        }),
        h(Pager, {
          page: page,
          busy: busy,
          hasNext: hasNext,
          prevLabel: t('common.prev'),
          nextLabel: t('common.next'),
          label: t('logs.page', { page: page }) + (total === null ? '' : ' · ' + t('logs.total', { total: total })),
          onPage: (next) => {
            setPage(next);
            void load(next, pageSize);
          },
          extra: data && data.fetchedAt
            ? h('span', null, t('logs.fetchedAt', { time: stampText(data.fetchedAt) }))
            : null,
        }),
        h(Note, { style: { marginTop: '8px' } }, t('logs.sub')),
        detail === null ? null : h(Modal, {
          title: t('logs.detail'),
          closeLabel: t('common.close'),
          onClose: () => setDetail(null),
          footer: h(Button, { onClick: () => setDetail(null) }, t('common.close')),
        },
          h('dl', { className: 'aq-kv' }, [
            h('dt', { key: 'k-id' }, 'id'), h('dd', { key: 'v-id' }, detail.id === undefined ? t('common.none') : String(detail.id)),
            h('dt', { key: 'k-time' }, 'created_at'), h('dd', { key: 'v-time' }, dateText(detail.created_at, 480, true)),
            h('dt', { key: 'k-type' }, 'type'), h('dd', { key: 'v-type' }, detail.type === undefined ? t('common.none') : String(detail.type)),
            h('dt', { key: 'k-model' }, 'model_name'), h('dd', { key: 'v-model' }, modelText(t, detail.model_name)),
            h('dt', { key: 'k-quota' }, 'quota'), h('dd', { key: 'v-quota' }, numberText(t, detail.quota)),
            h('dt', { key: 'k-prompt' }, 'prompt_tokens'), h('dd', { key: 'v-prompt' }, numberText(t, detail.prompt_tokens)),
            h('dt', { key: 'k-completion' }, 'completion_tokens'), h('dd', { key: 'v-completion' }, numberText(t, detail.completion_tokens)),
            h('dt', { key: 'k-cache' }, 'cache_tokens'), h('dd', { key: 'v-cache' }, numberText(t, detail.cache_tokens)),
            h('dt', { key: 'k-cachew' }, 'cache_write_tokens'), h('dd', { key: 'v-cachew' }, numberText(t, detail.cache_write_tokens)),
            h('dt', { key: 'k-use' }, 'use_time'), h('dd', { key: 'v-use' }, numberText(t, detail.use_time)),
            h('dt', { key: 'k-stream' }, 'is_stream'), h('dd', { key: 'v-stream' }, detail.is_stream === true ? 'true' : (detail.is_stream === false ? 'false' : t('common.none'))),
            h('dt', { key: 'k-request' }, 'request_id'), h('dd', { key: 'v-request' }, typeof detail.request_id === 'string' ? detail.request_id : '—'),
          ])));
    }

    function AnalysisTab(props) {
      const t = props.t;
      const enabled = props.enabled;
      const initial = useMemo(() => presetRange(7, 480), []);
      const [from, setFrom] = useState(initial.from);
      const [to, setTo] = useState(initial.to);
      const [offset, setOffset] = useState(480);
      const [grain, setGrain] = useState('day');
      const [status, setStatus] = useState(null);
      // The id of the job whose results the charts show; null before the first run.
      const [jobId, setJobId] = useState(null);
      const [analysis, setAnalysis] = useState(null);
      const [models, setModels] = useState(null);
      const [metric, setMetric] = useState('count');
      const [drill, setDrill] = useState(null);
      const [detail, setDetail] = useState(null);
      const [detailPage, setDetailPage] = useState(1);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const timer = useRef(null);

      useEffect(() => () => {
        if (timer.current !== null) clearTimeout(timer.current);
      }, []);

      const loadResult = useCallback(async (id, nextModels) => {
        const result = await api('/analysis/result', {
          method: 'POST',
          body: { id, models: nextModels === null ? undefined : nextModels, granularity: grain, offsetMinutes: offset },
        });
        setAnalysis(result);
      }, [grain, offset]);

      const poll = useCallback((id) => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
          try {
            const next = await api('/analysis/status?id=' + id);
            setStatus(next);
            if (next.phase === 'running') {
              poll(id);
              return;
            }
            setBusy(false);
            setJobId(id);
          } catch (failure) {
            setError(failure.message);
            setBusy(false);
          }
        }, 350);
      }, []);

      const start = async () => {
        setError('');
        setDetail(null);
        setDrill(null);
        setAnalysis(null);
        setStatus(null);
        setJobId(null);
        setBusy(true);
        try {
          const range = dateRange(from, to, offset);
          const next = await api('/analysis/start', { method: 'POST', body: range });
          setStatus(next);
          poll(next.id);
        } catch (failure) {
          setError(failure.message === 'bad-range' ? t('analysis.badRange') : failure.message);
          setBusy(false);
        }
      };

      const cancel = async () => {
        if (status === null) return;
        try {
          setStatus(await api('/analysis/cancel', { method: 'POST', body: { id: status.id } }));
        } catch (failure) {
          setError(failure.message);
        }
      };

      // Reload the aggregate whenever the finished job or one of the view
      // filters changes; grain and offset belong to the query, not the job.
      useEffect(() => {
        if (jobId === null) return;
        void loadResult(jobId, models).catch((failure) => setError(failure.message));
      }, [jobId, models, grain, offset, loadResult]);

      const activeId = jobId !== null ? jobId : (status === null ? null : status.id);

      const loadDetail = async (target, page) => {
        if (activeId === null) return;
        try {
          setDetail(await api('/analysis/details', {
            method: 'POST',
            body: {
              id: activeId,
              models: models === null ? undefined : models,
              granularity: grain,
              offsetMinutes: offset,
              page,
              start: target.start,
              end: target.end,
              hour: target.hour,
            },
          }));
          setDetailPage(page);
        } catch (failure) {
          setError(failure.message);
        }
      };

      const showBin = (bin, label) => {
        const target = { start: bin.start, end: bin.end, label };
        setDrill(target);
        void loadDetail(target, 1);
      };

      const showHour = (index) => {
        const target = { hour: index, label: String(index) + ':00' };
        setDrill(target);
        void loadDetail(target, 1);
      };

      const bins = analysis && Array.isArray(analysis.bins) ? analysis.bins : [];
      const totals = analysis ? analysis.totals : null;
      const withHour = grain === 'hour';
      const labels = bins.map((bin) => dateText(bin.start, offset, withHour));
      const metricValues = bins.map((bin) => {
        if (metric === 'count') return bin.metrics.count;
        return bin.metrics.quota.sum === null ? 0 : bin.metrics.quota.sum;
      });
      const hourLabels = [];
      for (let index = 0; index < 24; index += 1) hourLabels.push(String(index).padStart(2, '0'));
      const jobStatus = analysis && analysis.status ? analysis.status : status;

      return h('div', null,
        h(Card, { title: t('analysis.range') },
          h('div', { className: 'aq-row' },
            h(Field, { label: t('analysis.from') },
              h('input', { className: 'aq-input', type: 'date', value: from, onChange: (event) => setFrom(event.target.value) })),
            h(Field, { label: t('analysis.to') },
              h('input', { className: 'aq-input', type: 'date', value: to, onChange: (event) => setTo(event.target.value) })),
            h(Field, { label: t('analysis.offset') },
              h('select', {
                className: 'aq-select',
                value: String(offset),
                onChange: (event) => setOffset(Number(event.target.value)),
              },
                h('option', { value: '480' }, t('analysis.offset480')),
                h('option', { value: '0' }, t('analysis.offset0')))),
            h(Field, { label: t('analysis.grain') },
              h('select', {
                className: 'aq-select',
                value: grain,
                onChange: (event) => setGrain(event.target.value),
              },
                h('option', { value: 'day' }, t('analysis.day')),
                h('option', { value: 'hour' }, t('analysis.hour')))),
            h('div', { className: 'aq-row', style: { gap: '8px', alignItems: 'flex-end' } },
              h(Button, { kind: 'primary', disabled: busy || !enabled, onClick: () => void start() },
                busy ? t('analysis.polling') : t('analysis.start')),
              status !== null && status.phase === 'running'
                ? h(Button, { kind: 'danger', onClick: () => void cancel() }, t('analysis.cancel'))
                : null))),
        h('div', { style: { marginTop: '10px' } }, h(ErrorLine, null, error)),
        jobStatus === null ? null : h(Note, { style: { marginTop: '10px' } },
          t('analysis.phase.' + jobStatus.phase) + ' · ' + t('analysis.progress', {
            scanned: jobStatus.scanned,
            collected: jobStatus.collected,
            pages: jobStatus.pages,
          }),
          jobStatus.message ? ' · ' + jobStatus.message : '',
          jobStatus.serverTotal === null || jobStatus.serverTotal === undefined
            ? ''
            : ' · ' + t('analysis.serverTotal', { total: jobStatus.serverTotal }),
          jobStatus.outside + jobStatus.duplicates + jobStatus.conflicts === 0
            ? ''
            : '\n' + t('analysis.skipped', {
              outside: jobStatus.outside,
              duplicates: jobStatus.duplicates,
              conflicts: jobStatus.conflicts,
            })),
        analysis === null ? h(Note, { style: { marginTop: '10px' } }, t('analysis.needCollect')) : [
          h('div', { key: 'totals', className: 'aq-cards', style: { marginTop: '10px' } },
            h(Stat, { label: t('analysis.totalsCount'), value: numberText(t, totals.count) }),
            h(Stat, { label: t('analysis.totalsQuota'), value: numberText(t, totals.quota.sum) }),
            h(Stat, {
              label: t('analysis.totalsToken'),
              value: numberText(t, totals.input.sum) + ' / ' + numberText(t, totals.output.sum),
            }),
            h(Stat, {
              label: t('analysis.models'),
              value: numberText(t, analysis.modelCount),
              foot: analysis.actualStart === null
                ? undefined
                : dateText(analysis.actualStart, offset, withHour) + ' → ' + dateText(analysis.actualEnd, offset, withHour),
            })),
          h(Card, {
            key: 'filters',
            title: t('analysis.filters'),
            aside: t('analysis.filtersHint'),
            style: { marginTop: '10px' },
          },
            h('div', { className: 'aq-chips' },
              h('button', {
                type: 'button',
                className: 'aq-chip',
                'data-active': models === null ? 'true' : 'false',
                onClick: () => setModels(null),
              }, t('analysis.filtersAll')),
              (analysis.availableModels || []).map((entry, index) =>
                h('button', {
                  key: 'model-' + index,
                  type: 'button',
                  className: 'aq-chip',
                  'data-active': models !== null && models.indexOf(entry) !== -1 ? 'true' : 'false',
                  onClick: () => setModels([entry]),
                }, entry === null ? t('common.unknown') : (entry.length === 0 ? t('common.emptyModel') : entry))))),
          bins.length === 0
            ? h(Note, { key: 'empty', style: { marginTop: '10px' } }, t('analysis.empty'))
            : h(Card, {
              key: 'trend',
              title: t('analysis.chart.trend'),
              aside: h('span', { className: 'aq-chips' },
                h('button', {
                  type: 'button',
                  className: 'aq-chip',
                  'data-active': metric === 'count' ? 'true' : 'false',
                  onClick: () => setMetric('count'),
                }, t('analysis.metric.count')),
                h('button', {
                  type: 'button',
                  className: 'aq-chip',
                  'data-active': metric === 'quota' ? 'true' : 'false',
                  onClick: () => setMetric('quota'),
                }, t('analysis.metric.quota'))),
              style: { marginTop: '10px' },
            },
              h(Chart, {
                kind: 'bar',
                labels,
                series: [{ values: metricValues, color: SERIES_COLORS[0] }],
                format: (value) => value.toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
                ariaLabel: t('analysis.chart.trend'),
                onSelect: (index) => showBin(bins[index], labels[index]),
              }),
              h('p', { className: 'aq-hint' }, t('analysis.drillHint'))),
          bins.length === 0 ? null : h(Card, {
            key: 'tokens',
            title: t('analysis.chart.tokens'),
            style: { marginTop: '10px' },
          },
            h('div', { className: 'aq-legend' },
              h('span', null, h('span', { className: 'aq-dot', style: { background: SERIES_COLORS[0] } }), t('logs.prompt')),
              h('span', null, h('span', { className: 'aq-dot', style: { background: SERIES_COLORS[1] } }), t('logs.completion'))),
            h(Chart, {
              kind: 'line',
              labels,
              series: [
                { values: bins.map((bin) => (bin.metrics.input.sum === null ? null : bin.metrics.input.sum)), color: SERIES_COLORS[0] },
                { values: bins.map((bin) => (bin.metrics.output.sum === null ? null : bin.metrics.output.sum)), color: SERIES_COLORS[1] },
              ],
              format: (value) => value.toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
              ariaLabel: t('analysis.chart.tokens'),
              onSelect: (index) => showBin(bins[index], labels[index]),
            })),
          bins.length === 0 ? null : h(Card, {
            key: 'rank',
            title: t('analysis.chart.rank'),
            style: { marginTop: '10px' },
          },
            h(RankList, {
              emptyLabel: t('analysis.empty'),
              rows: (analysis.models || []).slice(0, 5).map((entry) => ({
                label: entry.model === null
                  ? t('common.unknown')
                  : (entry.model.length === 0 ? t('common.emptyModel') : entry.model),
                value: metric === 'count' ? entry.metrics.count : (entry.metrics.quota.sum === null ? 0 : entry.metrics.quota.sum),
                text: metric === 'count'
                  ? numberText(t, entry.metrics.count)
                  : numberText(t, entry.metrics.quota.sum),
                onClick: () => setModels([entry.model]),
              })).concat((analysis.models || []).length > 5
                ? [(() => {
                  const rest = (analysis.models || []).slice(5);
                  const sum = rest.reduce((total, entry) => total + (metric === 'count'
                    ? entry.metrics.count
                    : (entry.metrics.quota.sum === null ? 0 : entry.metrics.quota.sum)), 0);
                  return {
                    label: t('analysis.other', { count: rest.length }),
                    value: sum,
                    text: numberText(t, sum),
                    onClick: () => setModels(null),
                  };
                })()]
                : []),
            })),
          h(Card, {
            key: 'hours',
            title: t('analysis.chart.hours'),
            style: { marginTop: '10px' },
          },
            h(Chart, {
              kind: 'bar',
              labels: hourLabels,
              series: [{ values: analysis.hours || [], color: SERIES_COLORS[1] }],
              format: (value) => value.toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
              ariaLabel: t('analysis.chart.hours'),
              height: 140,
              onSelect: showHour,
            })),
          drill === null ? null : h(Card, {
            key: 'drill',
            title: t('analysis.drill', { label: drill.label }),
            aside: detail === null ? undefined : t('analysis.detailCount', { total: detail.total }),
            style: { marginTop: '10px' },
          },
            h(Table, {
              empty: t('analysis.drillEmpty'),
              columns: [
                { key: 'time', label: t('logs.time') },
                { key: 'model', label: t('logs.model') },
                { key: 'quota', label: t('logs.quota'), numeric: true },
                { key: 'prompt', label: t('logs.prompt'), numeric: true },
                { key: 'completion', label: t('logs.completion'), numeric: true },
                { key: 'requestId', label: t('logs.requestId') },
              ],
              rows: (detail === null ? [] : detail.items).map((row) => ({
                key: String(row.id),
                value: {
                  time: dateText(row.created_at, offset, true),
                  model: modelText(t, row.model_name),
                  quota: numberText(t, row.quota),
                  prompt: numberText(t, row.prompt_tokens),
                  completion: numberText(t, row.completion_tokens),
                  requestId: typeof row.request_id === 'string' ? row.request_id : '—',
                },
              })),
            }),
            h(Pager, {
              page: detailPage,
              busy: false,
              hasNext: detail === null ? false : detailPage * 50 < detail.total,
              prevLabel: t('common.prev'),
              nextLabel: t('common.next'),
              label: t('logs.page', { page: detailPage }),
              onPage: (next) => {
                void loadDetail(drill, next);
              },
              extra: h(Button, { kind: 'ghost', onClick: () => { setDrill(null); setDetail(null); } }, t('analysis.reset')),
            })),
        ],
        h(Note, { style: { marginTop: '10px' } }, t('analysis.sub')));
    }

    function SettingsTab(props) {
      const t = props.t;
      const settings = props.settings;
      const [baseUrl, setBaseUrl] = useState(settings ? settings.baseUrl : '');
      const [token, setToken] = useState('');
      // The display name is a browser-local preference, committed on blur so a
      // rename does not re-register the sidebar row on every keystroke.
      const [name, setName] = useState(props.displayName || '');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [notice, setNotice] = useState('');
      const [confirming, setConfirming] = useState(false);

      useEffect(() => {
        if (settings) setBaseUrl(settings.baseUrl);
      }, [settings === null ? null : settings.baseUrl]);

      useEffect(() => {
        setName(props.displayName || '');
      }, [props.displayName]);

      const commitName = () => {
        const next = typeof name === 'string' ? name.trim() : '';
        if (next === (props.displayName || '')) return;
        setName(next);
        props.onRename(next);
      };

      const save = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
          const data = await api('/connect', { method: 'POST', body: { baseUrl, token } });
          setToken('');
          props.onChanged(data.settings);
          if (data.settings.hasToken) await props.onRefresh();
          setNotice(t('conn.savedNoRead'));
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      const importFromEnv = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
          const data = await api('/import', { method: 'POST' });
          props.onChanged(data.settings);
          setNotice(t('conn.savedNoRead'));
          await props.onRefresh();
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      const forget = async () => {
        setConfirming(false);
        setBusy(true);
        setError('');
        setNotice('');
        try {
          const data = await api('/forget', { method: 'POST' });
          props.onChanged(data.settings);
          setToken('');
          setNotice(t('conn.savedNoRead'));
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      const available = settings === null || settings.credentialsAvailable !== false;

      return h('div', null,
        h(Card, { title: t('conn.title') },
          available ? null : h(ErrorLine, null, t('conn.noCredentials')),
          h('div', { className: 'aq-row', style: { marginBottom: '10px' } },
            h(Field, {
              label: t('conn.server'),
              hint: t('conn.serverHint', { base: settings ? settings.defaultBaseUrl : '' }),
              style: { flex: '1 1 260px' },
            },
              h('input', {
                className: 'aq-input',
                value: baseUrl,
                spellCheck: false,
                onChange: (event) => setBaseUrl(event.target.value),
              }))),
          h('div', { className: 'aq-row', style: { marginBottom: '10px' } },
            h(Field, { label: t('conn.skey'), hint: t('conn.skeyHint'), style: { flex: '1 1 260px' } },
              h('input', {
                className: 'aq-input',
                type: 'password',
                value: token,
                autoComplete: 'off',
                spellCheck: false,
                placeholder: settings && settings.hasToken ? '••••••••' : '',
                onChange: (event) => setToken(event.target.value),
              }))),
          h('div', { className: 'aq-row' },
            h(Button, { kind: 'primary', disabled: busy || !available, onClick: () => void save() },
              busy ? t('conn.saving') : t('conn.save')),
            h(Button, { disabled: busy || !available, onClick: () => void importFromEnv() }, t('conn.import')),
            h(Button, { kind: 'danger', disabled: busy || !available, onClick: () => setConfirming(true) }, t('conn.forget'))),
          h('div', { className: 'aq-row', style: { marginTop: '10px' } },
            h('span', { className: settings && settings.hasToken ? 'aq-ok' : 'aq-hint' },
              settings && settings.hasToken ? '● ' + t('conn.configured') : '○ ' + t('conn.missing'))),
          h(ErrorLine, { style: { marginTop: '10px' } }, error),
          notice ? h('p', { className: 'aq-ok', style: { marginTop: '8px' } }, notice) : null,
          h(Note, { style: { marginTop: '10px' } }, t('conn.intro')),
          h('p', { className: 'aq-hint', style: { marginTop: '4px' } }, t('conn.importHint'))),
        confirming ? h(Modal, {
          title: t('conn.forget'),
          closeLabel: t('common.cancel'),
          onClose: () => setConfirming(false),
          footer: [
            h(Button, { key: 'cancel', onClick: () => setConfirming(false) }, t('common.cancel')),
            h(Button, { key: 'ok', kind: 'danger', onClick: () => void forget() }, t('common.confirm')),
          ],
        }, h('p', null, t('conn.forgetAsk'))) : null,
        h(Card, { title: t('conn.display'), style: { marginTop: '10px' } },
          h(Field, {
            label: t('conn.name'),
            hint: t('conn.nameHint', { name: t('app.name'), max: NAME_MAX }),
            style: { flex: '1 1 280px' },
          },
            h('input', {
              className: 'aq-input',
              value: name,
              maxLength: NAME_MAX,
              spellCheck: false,
              placeholder: t('app.name'),
              onChange: (event) => setName(event.target.value),
              onBlur: commitName,
              onKeyDown: (event) => {
                if (event.key === 'Enter') commitName();
              },
            })),
          h('p', { className: 'aq-hint', style: { marginTop: '6px' } }, t('conn.nameLive'))),
        h(Card, { title: h('span', null, t('app.subtitle')), style: { marginTop: '10px' } },
          h('dl', { className: 'aq-kv' },
            h('dt', null, t('conn.server')), h('dd', null, settings ? settings.baseUrl : '—'),
            h('dt', null, t('conn.skey')), h('dd', null, settings && settings.hasToken ? t('conn.configured') : t('conn.missing')))),
        h(Note, { style: { marginTop: '10px' } }, t('app.badgeAuto')));
    }

    function VersionsTab(props) {
      const t = props.t;
      const history = [{
        version: '0.3.0',
        date: t('versions.0.3.0.date'),
        title: t('versions.0.3.0.title'),
        items: t('versions.0.3.0.items'),
      }, {
        version: '0.2.0',
        date: t('versions.0.2.0.date'),
        title: t('versions.0.2.0.title'),
        items: t('versions.0.2.0.items'),
      }, {
        version: '0.1.0',
        date: t('versions.0.1.0.date'),
        title: t('versions.0.1.0.title'),
        items: t('versions.0.1.0.items'),
      }];
      return h('div', null,
        history.map((entry) => h(Card, { key: entry.version, title: entry.version + ' · ' + entry.title, aside: entry.date },
          h('ul', { style: { margin: 0, paddingLeft: '18px' } },
            entry.items.split('、').map((item, index) => h('li', { key: index }, item))))),
        h(Card, { title: t('versions.desktop'), style: { marginTop: '10px' } },
          h('p', { className: 'aq-hint', style: { margin: 0 } }, t('versions.desktop.value'))),
        h(Note, { style: { marginTop: '10px' } }, t('versions.sub')));
    }

    /* ------------------------------------------------------------------- panel */

    const TABS = ['overview', 'models', 'logs', 'analysis', 'settings', 'versions'];

    function mergeSnapshot(previous, next) {
      const merged = {
        errors: Object.assign({}, next.errors || {}),
        times: Object.assign({}, next.times || {}),
      };
      for (const key of ['quota', 'models', 'prices', 'groupRatios']) {
        if (Object.prototype.hasOwnProperty.call(next, key)) merged[key] = next[key];
        else if (previous && previous[key] !== undefined) merged[key] = previous[key];
      }
      if (previous && previous.times) {
        for (const key of Object.keys(previous.times)) {
          if (merged.times[key] === undefined) merged.times[key] = previous.times[key];
        }
      }
      return merged;
    }

    function Panel(props) {
      const t = props.t;
      const bus = props.bus;
      const [settings, setSettings] = useState(null);
      const [snapshot, setSnapshot] = useState(null);
      const [tab, setTab] = useState('overview');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [ready, setReady] = useState(false);
      // The configurable display name; empty means "use the dictionary default".
      const [displayName, setDisplayName] = useState(() => readStoredName() || '');

      const rename = (next) => {
        setDisplayName(next);
        writeStoredName(next);
        if (bus !== undefined) bus.setName(next);
      };

      const refresh = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
          const data = await api('/refresh', { method: 'POST' });
          setSnapshot((previous) => mergeSnapshot(previous, data));
          // Also refreshes the sidebar percentage: one fetch, one number.
          if (bus !== undefined) bus.publish(data);
          const failures = Object.keys(data.errors || {}).map((key) => data.errors[key]);
          if (failures.length > 0) setError(failures.join('\n'));
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      }, [bus]);

      // The 15-minute poll keeps an open panel current without its own timer.
      useEffect(() => {
        if (bus === undefined) return undefined;
        return bus.subscribe((data) => {
          setSnapshot((previous) => mergeSnapshot(previous, data));
        });
      }, [bus]);

      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const data = await api('/state');
            if (!alive) return;
            setSettings(data.settings);
            if (!data.settings.hasToken) setTab('settings');
            if (data.settings.hasToken) await refresh();
          } catch (failure) {
            if (alive) setError(failure.message);
          } finally {
            if (alive) setReady(true);
          }
        })();
        return () => {
          alive = false;
        };
      }, [refresh]);

      const hasToken = settings !== null && settings.hasToken === true;
      const tabLabel = (key) => t('tab.' + key);
      // The analysis panel is mounted once and then only hidden, so a finished
      // collection survives a trip to another tab.
      const [analysisMounted, setAnalysisMounted] = useState(false);
      useEffect(() => {
        if (hasToken) setAnalysisMounted(true);
      }, [hasToken]);

      const panels = [];
      if (analysisMounted) {
        panels.push(h('div', {
          key: 'analysis',
          style: { display: tab === 'analysis' ? 'block' : 'none' },
        }, h(AnalysisTab, { t, enabled: hasToken && tab === 'analysis' })));
      }
      if (tab === 'overview') panels.push(h(OverviewTab, { key: 'overview', t, snapshot }));
      if (tab === 'models') panels.push(h(ModelsTab, { key: 'models', t, snapshot }));
      if (tab === 'logs') panels.push(h(LogsTab, { key: 'logs', t, enabled: hasToken }));
      if (tab === 'settings') {
        panels.push(h(SettingsTab, {
          key: 'settings',
          t,
          settings,
          displayName,
          onRename: rename,
          onChanged: (next) => {
            setSettings(next);
            // Clearing or losing the skey drops the sidebar percentage too.
            if (bus !== undefined && next.hasToken !== true) bus.clear();
          },
          onRefresh: refresh,
        }));
      }
      if (tab === 'versions') panels.push(h(VersionsTab, { key: 'versions', t }));

      return h('div', { className: 'aq-root' },
        h('style', null, CSS),
        h('header', { className: 'aq-head' },
          h('span', { className: 'aq-title' }, displayName.length > 0 ? displayName : t('app.name')),
          h('span', { className: 'aq-sub' },
            settings === null ? t('app.subtitle') : settings.baseUrl),
          h('span', { className: 'aq-spacer' }),
          h(Button, {
            kind: 'primary',
            disabled: busy || !hasToken,
            onClick: () => void refresh(),
          }, busy ? t('app.refreshing') : t('app.refresh'))),
        h('nav', { className: 'aq-tabs' }, TABS.map((key) => h('button', {
          key,
          type: 'button',
          className: 'aq-tab',
          'data-active': tab === key ? 'true' : 'false',
          'data-disabled': hasToken || key === 'settings' || key === 'versions' ? 'false' : 'true',
          onClick: () => {
            if (!hasToken && key !== 'settings' && key !== 'versions') return;
            setTab(key);
          },
        }, tabLabel(key)))),
        h('div', { className: 'aq-body' },
          !ready ? h(Note, null, t('common.loading')) : null,
          ready && !hasToken && tab !== 'settings' ? h(Note, null, t('state.noToken')) : null,
          ready ? h(ErrorLine, null, error) : null,
          ready ? panels : null));
    }

    /* ------------------------------------------------------------ display name */

    /** Browser-local key: the display name is a per-browser preference, not data. */
    const NAME_STORAGE_KEY = 'dsh-ai-quota/display-name';
    /** Upper bound shared by the input, the setter and the README. */
    const NAME_MAX = 40;

    /** The stored display name, or '' when it is unset or storage is denied. */
    function readStoredName() {
      try {
        const store = typeof window !== 'undefined' ? window.localStorage : undefined;
        if (store === undefined || store === null) return '';
        const value = store.getItem(NAME_STORAGE_KEY);
        return typeof value === 'string' ? value.slice(0, NAME_MAX) : '';
      } catch {
        return '';
      }
    }

    /** Persist (or clear, for '') the display name; storage failures stay silent. */
    function writeStoredName(value) {
      try {
        const store = typeof window !== 'undefined' ? window.localStorage : undefined;
        if (store === undefined || store === null) return;
        if (typeof value === 'string' && value.length > 0) store.setItem(NAME_STORAGE_KEY, value);
        else store.removeItem(NAME_STORAGE_KEY);
      } catch {
        // Private mode or a full quota: the name still applies to this page.
      }
    }

    /**
     * The sidebar row's percentage suffix. `null` hides it, which is the answer
     * for every state where the number is not trustworthy: no skey, gateway
     * unreachable, business failure, or a payload without quota fields.
     */
    function badgeOf(snapshot) {
      const quota = snapshot !== null && typeof snapshot === 'object' ? snapshot.quota : null;
      if (quota === null || typeof quota !== 'object') return null;
      if (quota.unlimited_quota === true) return '∞';
      const whole = quota.total_granted;
      const left = quota.total_available;
      if (typeof whole !== 'number' || !Number.isFinite(whole) || whole <= 0) return null;
      if (typeof left !== 'number' || !Number.isFinite(left)) return null;
      const share = Math.max(0, Math.min(1, left / whole));
      return Math.round(share * 100) + '%';
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        let ns = NS;
        try {
          ctx.locale.register(ns, { zh: ZH, en: EN });
        } catch (error) {
          if (!String(error && error.message).includes('already has locale')) throw error;
          // A hot reload activates this bundle while the previous dictionaries
          // are still installed, and the locale service has no replace path, so
          // this load registers its own namespace instead of showing stale text.
          ns = NS + '-' + Date.now().toString(36);
          ctx.locale.register(ns, { zh: ZH, en: EN });
        }
        const t = ctx.locale.bind(ns);

        // The row icon renders in the sidebar, outside the panel's sheet.
        if (typeof document !== 'undefined' && document.head !== null) {
          const sheet = document.createElement('style');
          sheet.setAttribute('data-dsh-plugin', PANEL_ID);
          sheet.textContent = ICON_CSS;
          document.head.appendChild(sheet);
          ctx.effect(() => () => {
            if (sheet.parentNode !== null) sheet.parentNode.removeChild(sheet);
          }, `${ns}: row icon styles`);
        }

        // Sidebar percentage: null hides it, so a failed read never leaves a
        // stale number sitting in the row.
        let badge = null;
        // Configurable display name (browser-local); empty means the dictionary
        // default. A rename re-registers the row for the same reason the
        // percentage does: the sidebar snapshots labels on entry changes.
        let displayName = readStoredName();
        // The sidebar snapshots list labels when the slot's entries change, so a
        // new percentage has to re-register the row to be re-read; the label
        // itself stays a thunk so a language switch also repaints for free.
        let repaintRow = () => {};
        const labelText = () => {
          const base = displayName.length > 0 ? displayName : t('app.name');
          return badge === null ? base : base + ' · ' + badge;
        };

        // Panels mounted elsewhere receive the poll's payload, so an open
        // Overview and the sidebar percentage can never disagree.
        const listeners = new Set();
        const publish = (data) => {
          const next = badgeOf(data);
          if (next !== badge) {
            badge = next;
            repaintRow();
          }
          for (const listener of listeners) {
            try {
              listener(data);
            } catch {
              // One stale panel must not stop the others from updating.
            }
          }
        };
        const subscribe = (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        };
        // Used when the skey goes away: no credential means no percentage, so
        // the row must not keep showing the last known number.
        const clear = () => {
          if (badge !== null) {
            badge = null;
            repaintRow();
          }
        };
        const bus = { publish, subscribe, clear, setName };

        /** Adopt a new display name from the panel and repaint the row. */
        function setName(next) {
          const value = typeof next === 'string' ? next.trim().slice(0, NAME_MAX) : '';
          if (value === displayName) return;
          displayName = value;
          repaintRow();
        }

        let lastPolledAt = 0;
        const refreshBadge = async () => {
          lastPolledAt = Date.now();
          try {
            publish(await api('/refresh', { method: 'POST' }));
            return true;
          } catch {
            if (badge !== null) {
              badge = null;
              repaintRow();
            }
            return false;
          }
        };

        /**
         * The sidebar row icon. Clicking the glyph refreshes the percentage and
         * stops the event, so the row's own click (open the panel) does not fire;
         * clicking the row's text still opens the panel. The glyph turns into a
         * spinner while reading and flashes green/red afterwards.
         */
        function RowIcon(props) {
          const size = typeof props.size === 'number' ? props.size : 18;
          const [state, setState] = useState('idle');
          const timer = useRef(null);
          useEffect(() => () => {
            if (timer.current !== null) clearTimeout(timer.current);
          }, []);
          const run = async (event) => {
            // The row is a <button>; keep the click from selecting the panel.
            event.preventDefault();
            event.stopPropagation();
            if (state === 'busy') return;
            setState('busy');
            const ok = await refreshBadge();
            setState(ok ? 'done' : 'failed');
            timer.current = setTimeout(() => setState('idle'), 1500);
          };
          const title = state === 'busy'
            ? t('sidebar.refreshing')
            : (state === 'done'
              ? t('sidebar.done')
              : (state === 'failed' ? t('sidebar.failed') : t('sidebar.refresh')));
          return h('span', {
            className: 'aqi',
            'data-state': state,
            title,
            onClick: (event) => void run(event),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') void run(event);
            },
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 2,
              margin: -2,
              borderRadius: 6,
              cursor: state === 'busy' ? 'progress' : 'pointer',
            },
          },
            h('svg', {
              className: 'aqi-glyph',
              viewBox: '0 0 16 16',
              width: size,
              height: size,
              'aria-hidden': true,
              style: { display: 'block' },
            },
              h('path', {
                d: 'M2.4 13.4h11.2',
                stroke: 'currentColor',
                strokeWidth: 1.3,
                strokeLinecap: 'round',
                opacity: 0.7,
              }),
              h('rect', { x: 3.1, y: 8.4, width: 2.3, height: 4.4, rx: 1, fill: 'currentColor', opacity: props.active === false ? 0.75 : 1 }),
              h('rect', { x: 6.85, y: 5.6, width: 2.3, height: 7.2, rx: 1, fill: 'currentColor', opacity: props.active === false ? 0.75 : 1 }),
              h('rect', { x: 10.6, y: 2.8, width: 2.3, height: 10, rx: 1, fill: 'currentColor', opacity: props.active === false ? 0.75 : 1 })));
        }

        // Coming back to the tab counts as "update now": without this the number
        // could be up to 15 minutes old the moment it becomes visible. The 30s
        // floor keeps a tab-switch storm from hitting the gateway.
        const onVisible = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          if (Date.now() - lastPolledAt < 30000) return;
          void refreshBadge();
        };
        const host = typeof window !== 'undefined' ? window : undefined;
        if (host !== undefined) host.addEventListener('focus', onVisible);
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
        ctx.effect(() => () => {
          if (host !== undefined) host.removeEventListener('focus', onVisible);
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
        }, `${NS}: badge refresh on return`);

        // Repaint on a language switch: `t` resolves the active locale per call,
        // so a re-render is all that is needed.
        function PanelView() {
          const [, bump] = useState(0);
          useEffect(() => ctx.locale.subscribe(() => bump((value) => value + 1)), [ctx]);
          return h(Panel, { t, bus });
        }

        ctx.slots.inject('sidebar.panellist', () => {
          let dispose = null;
          const register = () => {
            if (typeof dispose === 'function') dispose();
            dispose = ctx.slots.register({
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              label: labelText,
            }, RowIcon);
          };
          register();
          repaintRow = register;
          return () => {
            if (typeof dispose === 'function') dispose();
            dispose = null;
            repaintRow = () => {};
          };
        });

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, PanelView));

        // One poller for the whole page: the panel's own Refresh feeds the same
        // badge through `bus.publish`, so both stay on one number.
        const badgeTimer = setInterval(() => {
          void refreshBadge();
        }, BADGE_INTERVAL_MS);
        ctx.effect(() => () => clearInterval(badgeTimer), `${NS}: sidebar badge poll`);
        void refreshBadge();
      },
    };
  },
});
