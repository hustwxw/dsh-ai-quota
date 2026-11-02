/**
 * Host half of the AI quota panel bundle.
 *
 * The browser never talks to the gateway directly: this half owns the credential
 * (through `ctx.credentials`), performs every outbound request, filters the
 * response through the allowlists verified against the gateway's contract, and
 * serves the cleaned result on one same-origin route the Client half fetches.
 * Credentials never cross to the page; only "configured" state does.
 */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

/** Plugin name used in route labels. */
export const name = 'ai-quota-panel'

/** The one Host service this half cannot work without. */
export const inject = ['webServer']

/**
 * Gateway origin used until the user saves another one. A placeholder on
 * purpose: every deployment points this at its own New API instance, either
 * here or in the Connection tab.
 */
const DEFAULT_BASE_URL = 'http://newapi.example.com'

/** Credential record key: `<scope>/<id>`, both lowercase hyphenated segments. */
const CREDENTIAL_KEY = 'ai-quota/default'

/** `env` field of the record holding the saved gateway origin. */
const BASE_URL_REF = 'AI_QUOTA_BASE_URL'

/** Credential reference the "import" action reads. */
const TOKEN_REF = 'AI_QUOTA_SKEY'

/** The single route prefix this bundle owns. */
const ROUTE = '/x-ai-quota'

/** Outbound request budget, mirroring the standalone app. */
const REQUEST_TIMEOUT_MS = 20000

/** Refuse responses larger than this before parsing. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

/** Accepted log page sizes. */
const PAGE_SIZES = [20, 50, 100]

/** Analysis reads fixed-size pages, so a short page means the walk is over. */
const ANALYSIS_PAGE_SIZE = 50

/** Delay between analysis pages, matching the standalone collector. */
const ANALYSIS_INTERVAL_MS = 300

/** Safety ceilings; the collected status reports when one of them hits. */
const ANALYSIS_MAX_RECORDS = 200000
const ANALYSIS_MAX_MS = 30 * 60 * 1000
const ANALYSIS_MAX_PAGES = 20000

/** Longest accepted analysis window. */
const MAX_RANGE_SECONDS = 93 * 86400

/** Gateway fields admitted to the page, per endpoint. */
const QUOTA_FIELDS = [
  'total_available', 'total_granted', 'total_used', 'unlimited_quota',
  'expires_at', 'name', 'model_limits_enabled', 'model_limits',
]
const MODEL_FIELDS = ['id', 'supported_endpoint_types']
const PRICE_FIELDS = [
  'model_name', 'model_ratio', 'completion_ratio', 'cache_ratio',
  'create_cache_ratio', 'quota_type', 'model_price', 'enable_groups',
]
const LOG_FIELDS = [
  'id', 'created_at', 'type', 'model_name', 'quota', 'prompt_tokens',
  'completion_tokens', 'use_time', 'is_stream', 'cache_tokens',
  'cache_write_tokens', 'request_id', 'cached_tokens',
]

/** Log type 2 is billed; 4 and 5 are failed requests that must not be priced. */
const LOG_TYPE_CONSUMPTION = 2
const LOG_TYPE_FAILURES = [4, 5]

/**
 * DeepSeek's peak windows, in UTC hours on a weekday: 01:00-04:00 and
 * 06:00-10:00 (`[start, end)`). Everything else — including weekends and the
 * holidays the user lists — is billed at the cheaper rate.
 */
const PEAK_HOURS = [[1, 4], [6, 10]]

/** Price-table guards: a typo must not turn into an absurd estimate. */
const MAX_PRICE_MODELS = 200
const MAX_PRICE_VALUE = 1_000_000
const MAX_HOLIDAYS = 400
const MIN_RATE = 0.1
const MAX_RATE = 100

/**
 * Where the official price table is read from. Every docs page is also served
 * as Markdown, so the source is a real table rather than a rendered DOM; the
 * Chinese page quotes RMB, which is what a domestic relay bills in.
 */
const PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md'

/** A fetched table is reused for this long; the page changes rarely. */
const PRICING_TTL_MS = 6 * 60 * 60 * 1000

/** Refuse a pricing response larger than this, and time it out. */
const PRICING_MAX_BYTES = 2 * 1024 * 1024
const PRICING_TIMEOUT_MS = 15000

/** The units a price table may be denominated in. */
const CURRENCIES = ['CNY', 'USD']

/* ------------------------------------------------------------------ helpers */

/** One failure message from any layer. */
function messageOf(error) {
  if (error instanceof Error) return error.message
  const text = String(error)
  return text.length > 0 ? text : '未知错误'
}

/** Only finite numbers are values; everything else is an absent field. */
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Join a gateway origin and an absolute API path. */
function urlOf(baseUrl, path) {
  return `${baseUrl}${path}`
}

/**
 * Accept only `http(s)://host[:port]`: no credentials, path, query or fragment.
 * @param raw - the user's server address.
 * @returns the canonical origin, without a trailing slash.
 */
function normalizeBaseUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length === 0) throw new Error('请填写服务器地址')
  let url
  try {
    url = new URL(text)
  } catch {
    throw new Error('服务器地址格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('服务器地址只能包含 http(s) 协议、主机和端口')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error('服务器地址只能包含 http(s) 协议、主机和端口')
  }
  if (url.search.length > 0 || url.hash.length > 0 || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('服务器地址只能包含 http(s) 协议、主机和端口')
  }
  if (url.hostname.length === 0) throw new Error('服务器地址格式不正确')
  return url.origin
}

/**
 * Accept one non-empty, control-free skey of at most 4096 characters.
 * @param raw - pasted token text.
 * @returns the trimmed token.
 */
function normalizeToken(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length === 0 || text.length > 4096) throw new Error('请填写有效的 skey（API Token）')
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error('请填写有效的 skey（API Token）')
  return text
}

/** Send one JSON envelope and end the response. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(Buffer.byteLength(text, 'utf8')))
  res.end(text)
}

/** Answer a normal result. */
function reply(res, data) {
  sendJson(res, 200, { ok: true, data })
}

/** Answer an explicit failure; the page shows the message verbatim. */
function fail(res, error) {
  sendJson(res, 200, { ok: false, error: messageOf(error) })
}

/** Read a bounded JSON body; an absent body reads as `{}`. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let done = false
    const settle = (fn, value) => {
      if (done) return
      done = true
      fn(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        settle(reject, new Error('请求体超过 64 KiB 限制'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', (error) => settle(reject, error))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text.length === 0) {
        settle(resolve, {})
        return
      }
      try {
        const parsed = JSON.parse(text)
        settle(resolve, parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        settle(reject, new Error('请求体不是有效 JSON'))
      }
    })
  })
}

/* -------------------------------------------------------------- gateway I/O */

/**
 * One GET against the gateway: fresh agent (no proxy, no keep-alive), no
 * redirect following, 20 s budget, 8 MiB cap, JSON only.
 * @param baseUrl - canonical origin.
 * @param path - absolute API path.
 * @param token - bearer skey, or undefined for the public pricing route.
 * @returns the parsed JSON body.
 */
function gatewayGet(baseUrl, path, token) {
  const target = new URL(urlOf(baseUrl, path))
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest
  const headers = { accept: 'application/json' }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const outgoing = send(target, { method: 'GET', headers, agent: false }, (response) => {
      const status = response.statusCode ?? 0
      if (status < 200 || status > 299) {
        response.resume()
        settle(reject, new Error(`HTTP ${status}：请求未成功（不自动跟随重定向）`))
        return
      }
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) {
          outgoing.destroy()
          settle(reject, new Error('响应超过 8 MiB 限制'))
          return
        }
        chunks.push(chunk)
      })
      response.on('error', () => settle(reject, new Error('接口响应接收失败')))
      response.on('end', () => {
        if (settled) return
        const text = Buffer.concat(chunks).toString('utf8')
        try {
          settle(resolve, JSON.parse(text))
        } catch {
          settle(reject, new Error('接口未返回有效 JSON'))
        }
      })
    })
    outgoing.setTimeout(REQUEST_TIMEOUT_MS, () => {
      outgoing.destroy()
      settle(reject, new Error('无法连接接口或请求超时，请检查内网 / VPN 和服务器地址'))
    })
    outgoing.on('error', () => {
      settle(reject, new Error('无法连接接口或请求超时，请检查内网 / VPN 和服务器地址'))
    })
    outgoing.end()
  })
}

/**
 * Enforce the endpoint's business-success flag: HTTP 200 is not success.
 * @param raw - parsed response body.
 * @param kind - `quota`, `models` or `normal`.
 * @returns the same body when the flag admits it.
 */
function envelope(raw, kind) {
  if (raw === null || typeof raw !== 'object') throw new Error('接口未返回有效 JSON')
  const good = kind === 'quota'
    ? raw.code === true
    : kind === 'models'
      ? raw.success === true || (raw.success === undefined && raw.object === 'list')
      : raw.success === true
  if (!good) throw new Error('接口业务失败，请检查凭据权限或配置（HTTP 200 不代表成功）')
  if (raw.data === undefined || raw.data === null) throw new Error('接口数据缺少 data 字段')
  return raw
}

/** Keep only the admitted fields of one object. */
function pickFields(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('接口数据格式与已验证契约不一致')
  }
  const picked = {}
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) picked[field] = value[field]
  }
  return picked
}

/** Keep only the admitted fields of every array element. */
function pickArray(value, fields) {
  if (!Array.isArray(value)) throw new Error('接口数据格式与已验证契约不一致')
  return value.map((entry) => pickFields(entry, fields))
}

/* ------------------------------------------------------------------ analysis */

/** Sum one numeric field and count how many rows actually carried it. */
function metricOf(rows, field) {
  let sum = 0
  let valid = 0
  for (const row of rows) {
    const value = row[field]
    if (isNumber(value)) {
      sum += value
      valid += 1
    }
  }
  return { sum: valid > 0 ? sum : null, valid }
}

/** The four metrics one bucket reports. Missing fields stay missing. */
function metricsOf(rows) {
  return {
    count: rows.length,
    quota: metricOf(rows, 'quota'),
    input: metricOf(rows, 'prompt_tokens'),
    output: metricOf(rows, 'completion_tokens'),
  }
}

/** Bin size in seconds for one granularity. */
function binSizeOf(granularity) {
  return granularity === 'hour' ? 3600 : 86400
}

/** Bin start for one timestamp in the viewer's chosen offset. */
function binStart(seconds, granularity, offsetMinutes) {
  const size = binSizeOf(granularity)
  const shifted = seconds + offsetMinutes * 60
  return Math.floor(shifted / size) * size - offsetMinutes * 60
}

/** Local hour index (0-23) for one timestamp in the chosen offset. */
function hourIndexOf(seconds, offsetMinutes) {
  const shifted = seconds + offsetMinutes * 60
  return ((Math.floor(shifted / 3600) % 24) + 24) % 24
}

/** Validate one requested range. */
function normalizeRange(raw) {
  const start = Number(raw?.start)
  const end = Number(raw?.end)
  if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error('请选择有效时间范围')
  if (start < 0 || end <= start || end - start > MAX_RANGE_SECONDS) {
    throw new Error('请选择有效时间范围，开始不能晚于结束，最长 93 天')
  }
  return { start, end }
}

/**
 * Validate a priced walk's optional window: absent means "every page".
 * @returns `{ start, end }`, or null for a whole-history walk.
 */
function normalizeValueRange(raw) {
  const hasStart = raw?.start !== undefined && raw?.start !== null && raw?.start !== ''
  const hasEnd = raw?.end !== undefined && raw?.end !== null && raw?.end !== ''
  if (!hasStart && !hasEnd) return null
  if (!hasStart || !hasEnd) throw new Error('日期范围要同时填开始和结束')
  const start = Number(raw.start)
  const end = Number(raw.end)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    throw new Error('日期范围不正确，开始不能晚于结束')
  }
  if (end - start > MAX_VALUE_RANGE_SECONDS) throw new Error('日期范围最长 366 天')
  return { start, end }
}

/** Validate one analysis view query. */
function normalizeQuery(raw) {
  const granularity = raw?.granularity === 'hour' ? 'hour' : 'day'
  const offsetMinutes = Number(raw?.offsetMinutes)
  if (offsetMinutes !== 0 && offsetMinutes !== 480) throw new Error('分析筛选参数不正确')
  const rawModels = raw?.models
  let models
  if (Array.isArray(rawModels)) {
    if (rawModels.length > 5000) throw new Error('分析筛选参数不正确')
    models = rawModels.map((entry) => (typeof entry === 'string' ? entry : null))
  }
  return { granularity, offsetMinutes, models }
}

/** One bounded pause between analysis pages. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** How many times one page is re-requested before the walk gives up. */
const PAGE_ATTEMPTS = 3

/** Longest accepted date window for a priced walk. */
const MAX_VALUE_RANGE_SECONDS = 366 * 86400

/* --------------------------------------------------------------------- value */

/** `YYYY-MM-DD` of one epoch, in UTC. */
function utcDateOf(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/**
 * Whether one row was billed at DeepSeek's peak rate: a weekday inside one of
 * the two UTC windows, and not a holiday the user listed.
 * @param seconds - `created_at` of the row.
 * @param holidays - Set of `YYYY-MM-DD` strings billed at the off-peak rate.
 */
function isPeakAt(seconds, holidays) {
  const at = new Date(seconds * 1000)
  const weekday = at.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  if (holidays.has(utcDateOf(seconds))) return false
  const hour = at.getUTCHours()
  for (const [start, end] of PEAK_HOURS) {
    if (hour >= start && hour < end) return true
  }
  return false
}

/** Only `YYYY-MM-DD` entries, deduplicated; an absent list is empty. */
function normalizeHolidays(raw) {
  if (raw === undefined || raw === null) return new Set()
  if (!Array.isArray(raw)) throw new Error('节假日列表格式不正确')
  if (raw.length > MAX_HOLIDAYS) throw new Error(`节假日最多 ${MAX_HOLIDAYS} 天`)
  const days = new Set()
  for (const entry of raw) {
    if (typeof entry !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry)) {
      throw new Error('节假日只能填 YYYY-MM-DD')
    }
    days.add(entry)
  }
  return days
}

/** One per-million-token price triple, in USD. */
function normalizePriceTriple(raw, label) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`价格表里 ${label} 的格式不正确`)
  }
  const triple = {}
  for (const field of ['hit', 'miss', 'output']) {
    const value = raw[field]
    if (!isNumber(value) || value < 0 || value > MAX_PRICE_VALUE) {
      throw new Error(`价格表里 ${label} 的价格必须是 0 到 ${MAX_PRICE_VALUE} 之间的数字`)
    }
    triple[field] = value
  }
  return triple
}

/** The whole price table: model -> { peak, offpeak } in USD per 1M tokens. */
function normalizePrices(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('价格表格式不正确')
  }
  const names = Object.keys(raw)
  if (names.length > MAX_PRICE_MODELS) throw new Error(`价格表最多 ${MAX_PRICE_MODELS} 个模型`)
  const table = new Map()
  for (const model of names) {
    const entry = raw[model]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`价格表里 ${model} 的格式不正确`)
    }
    table.set(model, {
      peak: normalizePriceTriple(entry.peak, `${model} 的高峰价`),
      offpeak: normalizePriceTriple(entry.offpeak, `${model} 的优惠价`),
    })
  }
  return table
}

/** The USD/CNY rate the estimate converts with. */
function normalizeRate(raw) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < MIN_RATE || value > MAX_RATE) {
    throw new Error(`汇率必须是 ${MIN_RATE} 到 ${MAX_RATE} 之间的数字`)
  }
  return value
}

/** The unit the price table is denominated in; absent means USD (older pages). */
function normalizeCurrency(raw) {
  if (raw === undefined || raw === null) return 'USD'
  const text = String(raw).toUpperCase()
  if (!CURRENCIES.includes(text)) throw new Error('价目货币只能是 CNY 或 USD')
  return text
}

/* ----------------------------------------------------------- official prices */

/**
 * One HTTPS GET returning text: no redirect following, 15 s budget, 2 MiB cap.
 * The pricing page is the only request this bundle makes outside the gateway.
 */
function fetchPricingText(url) {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const outgoing = httpsRequest(target, {
      method: 'GET',
      headers: { accept: 'text/markdown, text/plain' },
      agent: false,
    }, (response) => {
      const status = response.statusCode ?? 0
      if (status < 200 || status > 299) {
        response.resume()
        settle(reject, new Error(`官方价格页返回 HTTP ${status}`))
        return
      }
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > PRICING_MAX_BYTES) {
          outgoing.destroy()
          settle(reject, new Error('官方价格页超过 2 MiB，已放弃'))
          return
        }
        chunks.push(chunk)
      })
      response.on('error', () => settle(reject, new Error('官方价格页读取失败')))
      response.on('end', () => {
        if (settled) return
        settle(resolve, Buffer.concat(chunks).toString('utf8'))
      })
    })
    outgoing.setTimeout(PRICING_TIMEOUT_MS, () => {
      outgoing.destroy()
      settle(reject, new Error('官方价格页请求超时，请检查本机能否访问外网'))
    })
    outgoing.on('error', () => settle(reject, new Error('无法访问官方价格页，请检查本机网络或代理')))
    outgoing.end()
  })
}

/** A model name cell, or null when the cell is not one. */
function modelCellOf(cell) {
  const text = cell.replace(/\(\d+\)/g, '').replace(/\s+/g, '')
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(text)) return null
  return text.toLowerCase().includes('deepseek') ? text : null
}

/** A price cell's number and its unit, or null when the cell is not a price. */
function priceCellOf(cell) {
  const text = cell.replace(/\s+/g, '')
  const match = /^([0-9]+(?:\.[0-9]+)?)(元|￥|\$|CNY|USD)?$/i.exec(text)
  if (match === null) return null
  const unit = match[2]
  const currency = unit === undefined
    ? null
    : ((unit === '元' || unit === '￥' || /^CNY$/i.test(unit)) ? 'CNY' : 'USD')
  return { value: Number(match[1]), currency }
}

/** Which usage type a price row describes. */
function priceKindOf(cells) {
  const joined = cells.join(' ')
  if (/缓存未命中|cache\s*miss/i.test(joined)) return 'miss'
  if (/缓存命中|cache\s*hit/i.test(joined)) return 'hit'
  if (/输出|output/i.test(joined)) return 'output'
  return null
}

/** Which billing period a price row describes. */
function pricePeriodOf(cells) {
  const joined = cells.join(' ')
  if (/空闲|off-?\s*peak/i.test(joined)) return 'offpeak'
  if (/高峰|peak/i.test(joined)) return 'peak'
  return null
}

/**
 * Read the model/price table out of the official pricing page's Markdown.
 *
 * The page is a Markdown table whose header row lists one column per model and
 * whose price rows are labelled by usage type and billing period, so the parse
 * keys off those labels instead of fixed positions. Anything short of a
 * complete set of six numbers per model rejects the page, and the caller falls
 * back to the bundled snapshot.
 * @param text - the Markdown source of the pricing page.
 * @returns `{ currency, models }` in the page's own unit per 1M tokens.
 */
export function parsePricingMarkdown(text) {
  if (typeof text !== 'string' || text.length === 0) throw new Error('官方价格页是空的')
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    if (/^\|[\s:|-]+\|$/.test(trimmed)) continue
    rows.push(trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()))
  }
  if (rows.length === 0) throw new Error('官方价格页里没有表格')

  // The header row is the one whose label cell is just "模型" / "Model".
  const isHeader = (cells) => cells.some((cell) => /^(模型|model)(\(\d+\))?$/i.test(cell))
  let models = []
  for (const cells of rows) {
    if (!isHeader(cells)) continue
    const names = cells.map(modelCellOf).filter((name) => name !== null)
    if (names.length > models.length) models = names
  }
  if (models.length === 0) throw new Error('官方价格页里没有识别到模型')

  const table = new Map()
  for (const model of models) {
    table.set(model, { peak: {}, offpeak: {} })
  }
  let currency = null
  for (const cells of rows) {
    const kind = priceKindOf(cells)
    const period = pricePeriodOf(cells)
    if (kind === null || period === null) continue
    const prices = cells.map(priceCellOf).filter((cell) => cell !== null)
    // A price row carries exactly one number per model column.
    if (prices.length !== models.length) continue
    for (const price of prices) {
      if (price.currency === null) continue
      if (currency !== null && currency !== price.currency) throw new Error('官方价格页里的货币单位不一致')
      currency = price.currency
    }
    models.forEach((model, index) => { table.get(model)[period][kind] = prices[index].value })
  }

  const usable = {}
  for (const [model, buckets] of table) {
    const complete = ['peak', 'offpeak'].every((period) =>
      ['hit', 'miss', 'output'].every((kind) => isNumber(buckets[period][kind])))
    if (complete) usable[model] = buckets
  }
  if (Object.keys(usable).length === 0) throw new Error('官方价格页里没有完整的价目行，已放弃')
  return { currency: currency ?? 'CNY', models: usable }
}

/** One empty period bucket: three usage types plus the row totals. */
function emptyBucket() {
  return {
    hit: { tokens: 0, amount: 0, usd: 0, cny: 0 },
    miss: { tokens: 0, amount: 0, usd: 0, cny: 0 },
    output: { tokens: 0, amount: 0, usd: 0, cny: 0 },
    records: 0,
    quota: 0,
    tokens: 0,
    amount: 0,
    usd: 0,
    cny: 0,
  }
}

/**
 * Price a collected job the way the `deepseek-usage-value` skill does: only
 * consumption rows, cache hits split out of the input, every model at its own
 * rate, peak and off-peak apart, then extrapolated to the whole quota.
 *
 * Modules whose model has no price are listed instead of being priced with
 * another model's rate, and any extrapolation that rests on a guess is flagged.
 * @param job - a finished collection job.
 * @param input - `{ prices, rate, currency, holidays }` as sent by the page.
 */
async function valueResult(job, input) {
  const prices = normalizePrices(input?.prices)
  const rate = normalizeRate(input?.rate)
  const currency = normalizeCurrency(input?.currency)
  const holidays = normalizeHolidays(input?.holidays)
  // The table is quoted in one unit; both columns are derived from it here so
  // the page never has to decide which direction a rate applies in.
  const toUsd = (amount) => (currency === 'CNY' ? amount / rate : amount)
  const toCny = (amount) => (currency === 'CNY' ? amount : amount * rate)
  const buckets = { peak: emptyBucket(), offpeak: emptyBucket() }
  const models = new Map()
  let consumption = 0
  let failures = 0
  let others = 0
  let pricedQuota = 0
  let allQuota = 0

  for (const row of job.rows) {
    const type = isNumber(row.type) ? row.type : null
    if (type !== LOG_TYPE_CONSUMPTION) {
      if (LOG_TYPE_FAILURES.includes(type)) failures += 1
      else others += 1
      continue
    }
    consumption += 1
    const model = typeof row.model_name === 'string' && row.model_name.length > 0 ? row.model_name : null
    const prompt = isNumber(row.prompt_tokens) ? row.prompt_tokens : 0
    const output = isNumber(row.completion_tokens) ? row.completion_tokens : 0
    // `cache_tokens` is the contract field; `cached_tokens` is the equivalent
    // name some gateways use. Neither present means "no cache hit reported".
    const hit = isNumber(row.cache_tokens)
      ? row.cache_tokens
      : (isNumber(row.cached_tokens) ? row.cached_tokens : 0)
    if (hit > prompt) {
      throw new Error(`${model === null ? '未知模型' : model} 的日志缓存命中数大于输入 token 数，已停止金额汇总`)
    }
    const miss = prompt - hit
    const quota = isNumber(row.quota) ? row.quota : 0
    allQuota += quota
    const key = isPeakAt(row.created_at, holidays) ? 'peak' : 'offpeak'
    const known = models.get(model)
    const entry = known ?? {
      model, records: 0, hit: 0, miss: 0, output: 0, quota: 0, amount: 0, priced: false,
    }
    entry.records += 1
    entry.hit += hit
    entry.miss += miss
    entry.output += output
    entry.quota += quota
    const price = model === null ? undefined : prices.get(model)
    if (price !== undefined) {
      const unit = price[key]
      const bucket = buckets[key]
      const hitAmount = (hit * unit.hit) / 1e6
      const missAmount = (miss * unit.miss) / 1e6
      const outputAmount = (output * unit.output) / 1e6
      const amount = hitAmount + missAmount + outputAmount
      entry.priced = true
      entry.amount += amount
      bucket.hit.tokens += hit
      bucket.hit.amount += hitAmount
      bucket.miss.tokens += miss
      bucket.miss.amount += missAmount
      bucket.output.tokens += output
      bucket.output.amount += outputAmount
      bucket.records += 1
      bucket.quota += quota
      bucket.tokens += hit + miss + output
      bucket.amount += amount
      pricedQuota += quota
    }
    models.set(model, entry)
  }

  // Derive both currencies once per bucket and per model, from the table unit.
  for (const bucket of [buckets.peak, buckets.offpeak]) {
    for (const kind of ['hit', 'miss', 'output']) {
      bucket[kind].usd = toUsd(bucket[kind].amount)
      bucket[kind].cny = toCny(bucket[kind].amount)
    }
    bucket.usd = toUsd(bucket.amount)
    bucket.cny = toCny(bucket.amount)
  }
  for (const entry of models.values()) {
    entry.usd = toUsd(entry.amount)
    entry.cny = toCny(entry.amount)
  }

  const modelRows = [...models.values()].sort((left, right) => (right.amount - left.amount) || (right.records - left.records))
  const unpriced = modelRows.filter((entry) => !entry.priced)
  const usedAmount = buckets.peak.amount + buckets.offpeak.amount
  const usedTokens = buckets.peak.tokens + buckets.offpeak.tokens

  // The quota endpoint is the only source of the whole-quota denominator, so it
  // is read here rather than trusted from the page. One price edit re-runs this
  // function, so the read is cached for a minute per job: a keyboard must not
  // turn into a request storm on the gateway.
  let quotaSection = null
  let quotaError = null
  const cached = job.quotaCache
  if (cached !== undefined && Date.now() - cached.at < 60_000) {
    quotaSection = cached.section
    quotaError = cached.error
  } else {
    try {
      const raw = envelope(await gatewayGet(job.baseUrl, '/api/usage/token/', job.token), 'quota')
      quotaSection = pickFields(raw.data, QUOTA_FIELDS)
    } catch (error) {
      quotaError = messageOf(error)
    }
    job.quotaCache = { at: Date.now(), section: quotaSection, error: quotaError }
  }

  const totalGranted = isNumber(quotaSection?.total_granted) ? quotaSection.total_granted : null
  const totalUsed = isNumber(quotaSection?.total_used) ? quotaSection.total_used : null
  const totalAvailable = isNumber(quotaSection?.total_available) ? quotaSection.total_available : null
  const delta = totalUsed === null || job.range !== null ? null : totalUsed - allQuota
  const tolerance = totalUsed === null ? 0 : Math.max(1, Math.abs(totalUsed) * 0.02)
  // A windowed walk covers a slice of the log, so its quota can never equal the
  // lifetime `total_used`: comparing them would be a false alarm, not a check.
  const ranged = job.range !== null
  const reconciled = ranged ? null : (delta !== null && Math.abs(delta) <= tolerance)

  const extrapolate = (target) => (pricedQuota > 0 && target !== null ? (usedAmount * target) / pricedQuota : null)
  const grantedAmount = extrapolate(totalGranted)
  const remainingAmount = extrapolate(totalAvailable)
  const money = (amount) => ({
    amount,
    usd: amount === null ? null : toUsd(amount),
    cny: amount === null ? null : toCny(amount),
  })

  // Capped means a local guard stopped the walk; an early stop at the windows edge does not.
  const status = job.phase === 'complete' && job.capped !== true
  return {
    status: {
      phase: job.phase,
      message: job.message,
      range: job.range,
      pages: job.pages,
      scanned: job.scanned,
      collected: job.rows.length,
      duplicates: job.duplicates,
      conflicts: job.conflicts,
      serverTotal: job.serverTotal,
      complete: status,
    },
    counts: { consumption, failures, others, peakRecords: buckets.peak.records, offpeakRecords: buckets.offpeak.records },
    buckets,
    totals: { amount: usedAmount, usd: toUsd(usedAmount), cny: toCny(usedAmount), tokens: usedTokens },
    models: modelRows,
    unpriced: {
      models: unpriced.map((entry) => entry.model),
      records: unpriced.reduce((sum, entry) => sum + entry.records, 0),
    },
    quota: {
      error: quotaError,
      totalGranted,
      totalUsed,
      totalAvailable,
      logQuota: allQuota,
      pricedQuota,
      delta,
      reconciled,
      ranged,
    },
    extrapolation: {
      granted: money(grantedAmount),
      remaining: money(remainingAmount),
      // Every guess that makes the extrapolation provisional, reported as plain
      // facts so the page can word them in the reader's language.
      provisional: {
        incomplete: !status,
        unpriced: unpriced.reduce((sum, entry) => sum + entry.records, 0),
        quota: quotaSection === null,
        mismatch: !ranged && quotaSection !== null && reconciled === false,
        ranged,
      },
    },
    rate,
    currency,
    holidays: holidays.size,
    computedAt: new Date().toISOString(),
  }
}

/* ------------------------------------------------------------------- service */

/**
 * Register the data route. All state lives in this closure, so unloading the
 * bundle leaves nothing behind.
 * @param ctx - the plugin Context.
 */
export function apply(ctx) {
  /** In-memory session jobs, keyed by id; nothing here is persisted. */
  const jobs = new Map()
  let nextJobId = 0

  /** The last successfully parsed official price table, and when it was read. */
  let pricingCache = null

  /**
   * The official price table, from cache when it is fresh.
   *
   * The page is public and changes rarely, so one read serves every panel for
   * six hours; a failure is never cached, so the next click retries.
   * @param force - re-read even when the cached copy is still fresh.
   */
  const officialPricing = async (force) => {
    if (!force && pricingCache !== null && Date.now() - pricingCache.at < PRICING_TTL_MS) {
      return pricingCache.value
    }
    const parsed = parsePricingMarkdown(await fetchPricingText(PRICING_URL))
    const value = {
      source: PRICING_URL,
      fetchedAt: new Date().toISOString(),
      currency: parsed.currency,
      models: parsed.models,
    }
    pricingCache = { at: Date.now(), value }
    return value
  }

  /** The credential service is optional: without it the page says so. */
  const credentialsOf = () => {
    const service = ctx.get('credentials')
    if (service === undefined) throw new Error('当前环境没有凭据服务，无法保存 skey')
    return service
  }

  /** Read the saved record, or undefined when nothing is stored. */
  const readRecord = async () => credentialsOf().readRecord(CREDENTIAL_KEY)

  /** The saved origin, or the default when none was stored. */
  const baseUrlOf = (record) => {
    const saved = record?.env?.[BASE_URL_REF]
    if (typeof saved !== 'string' || saved.length === 0) return DEFAULT_BASE_URL
    try {
      return normalizeBaseUrl(saved)
    } catch {
      return DEFAULT_BASE_URL
    }
  }

  /** The page-visible connection state; the token itself never leaves the Host. */
  const settingsOf = async () => {
    const service = ctx.get('credentials')
    if (service === undefined) {
      return {
        baseUrl: DEFAULT_BASE_URL,
        hasToken: false,
        defaultBaseUrl: DEFAULT_BASE_URL,
        credentialsAvailable: false,
      }
    }
    const record = await service.readRecord(CREDENTIAL_KEY)
    const hasToken = record?.kind === 'api-key' && typeof record.key === 'string' && record.key.length > 0
    return {
      baseUrl: baseUrlOf(record),
      hasToken,
      defaultBaseUrl: DEFAULT_BASE_URL,
      credentialsAvailable: true,
    }
  }

  /** The token, or a message that names the missing step. */
  const tokenOf = async () => {
    const record = await readRecord()
    if (record?.kind !== 'api-key' || typeof record.key !== 'string' || record.key.length === 0) {
      throw new Error('尚未配置 skey，请先到「连接设置」保存')
    }
    return record.key
  }

  /** Persist a connection change, keeping the untouched half of the record. */
  const saveConnection = async (input) => {
    const service = credentialsOf()
    const current = await service.readRecord(CREDENTIAL_KEY)
    const env = { ...(current?.kind === 'api-key' ? current.env ?? {} : {}) }
    if (input.baseUrl !== undefined) env[BASE_URL_REF] = normalizeBaseUrl(input.baseUrl)
    const token = input.token === undefined || input.token === ''
      ? undefined
      : normalizeToken(input.token)
    const key = token ?? (current?.kind === 'api-key' ? current.key : undefined)
    if (typeof key !== 'string' || key.length === 0) throw new Error('请填写有效的 skey（API Token）')
    if (!Object.prototype.hasOwnProperty.call(env, BASE_URL_REF)) env[BASE_URL_REF] = DEFAULT_BASE_URL
    const record = { kind: 'api-key', key, env }
    const saved = await service.modifyRecord(CREDENTIAL_KEY, async () => record)
    if (saved === undefined) throw new Error('凭据写入失败，请重试')
    return settingsOf()
  }

  /** Fetch one log page from the gateway, already allowlist-filtered. */
  const fetchLogPage = async (baseUrl, token, page, pageSize) => {
    const raw = envelope(
      await gatewayGet(baseUrl, `/api/log/token?p=${page}&page_size=${pageSize}`, token),
      'normal',
    )
    const pageData = {
      items: pickArray(raw.data, LOG_FIELDS),
      page,
      pageSize,
      fetchedAt: new Date().toISOString(),
    }
    if (Number.isInteger(raw.total)) pageData.total = raw.total
    return pageData
  }

  /** The three overview sections, each with its own failure and timestamp. */
  const snapshot = async () => {
    const settings = await settingsOf()
    const token = await tokenOf()
    const result = { errors: {}, times: {} }
    const [quotaRaw, modelsRaw, pricesRaw] = await Promise.all([
      gatewayGet(settings.baseUrl, '/api/usage/token/', token)
        .then((value) => ({ value }), (error) => ({ error })),
      gatewayGet(settings.baseUrl, '/v1/models', token)
        .then((value) => ({ value }), (error) => ({ error })),
      gatewayGet(settings.baseUrl, '/api/pricing', undefined)
        .then((value) => ({ value }), (error) => ({ error })),
    ])
    const sections = [
      ['quota', 'quota', quotaRaw, (raw) => pickFields(envelope(raw, 'quota').data, QUOTA_FIELDS)],
      ['models', 'models', modelsRaw, (raw) => pickArray(envelope(raw, 'models').data, MODEL_FIELDS)],
      ['prices', 'normal', pricesRaw, (raw) => {
        const clean = pickArray(envelope(raw, 'normal').data, PRICE_FIELDS)
        const ratios = raw.group_ratio
        if (ratios !== null && typeof ratios === 'object' && !Array.isArray(ratios)) {
          result.groupRatios = ratios
        }
        return clean
      }],
    ]
    for (const [key, kind, outcome, shape] of sections) {
      if (outcome.error !== undefined) {
        result.errors[key] = messageOf(outcome.error)
        continue
      }
      try {
        result[key] = shape(outcome.value)
        result.times[key] = new Date().toISOString()
      } catch (error) {
        // A failed section reports its reason; the page keeps the earlier value.
        result.errors[key] = messageOf(error)
      }
    }
    return result
  }

  /** Create one collection job; `range === null` means "walk the whole history". */
  const newJob = (range, settings, token) => {
    const id = (nextJobId += 1)
    const now = new Date().toISOString()
    const job = {
      id,
      range,
      phase: 'running',
      message: null,
      startedAt: now,
      updatedAt: now,
      scanned: 0,
      pages: 0,
      duplicates: 0,
      conflicts: 0,
      outside: 0,
      serverTotal: null,
      rows: [],
      seen: new Map(),
      cancelRequested: false,
      baseUrl: settings.baseUrl,
      token,
    }
    jobs.set(id, job)
    // Keep the map small; the oldest finished job is the least useful one.
    if (jobs.size > 4) {
      const oldest = [...jobs.keys()].sort((a, b) => a - b)[0]
      if (oldest !== undefined && oldest !== id) jobs.delete(oldest)
    }
    return job
  }

  /** Create one collection job and start it; the page polls its status. */
  const startAnalysis = (range, settings, token) => {
    const job = newJob(range, settings, token)
    void collect(job)
    return job
  }

  /** Create one priced walk; `range === null` means "every page of history". */
  const startWalk = (settings, token, range) => {
    const job = newJob(range, settings, token)
    void collect(job)
    return job
  }

  /** The page-visible status of one job. */
  const statusOf = (job) => {
    let actualStart = null
    let actualEnd = null
    for (const row of job.rows) {
      if (actualStart === null || row.created_at < actualStart) actualStart = row.created_at
      if (actualEnd === null || row.created_at > actualEnd) actualEnd = row.created_at
    }
    return {
      id: job.id,
      range: job.range,
      phase: job.phase,
      message: job.message,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      scanned: job.scanned,
      collected: job.rows.length,
      pages: job.pages,
      duplicates: job.duplicates,
      conflicts: job.conflicts,
      outside: job.outside,
      serverTotal: job.serverTotal,
      capped: job.capped === true,
      actualStart,
      actualEnd,
    }
  }

  /** Move one job to a terminal phase. */
  const finish = (job, phase, message) => {
    job.phase = phase
    job.message = message
    job.updatedAt = new Date().toISOString()
  }

  /** Add one gateway row to the job, counting what the range and dedupe dropped. */
  const ingest = (job, row) => {
    const id = row.id
    const createdAt = row.created_at
    if (!Number.isInteger(id) || !Number.isInteger(createdAt) || createdAt < 0) {
      throw new Error('日志分页或时间字段不符合契约，已停止采集')
    }
    const known = job.seen.get(id)
    if (known !== undefined) {
      if (job.rows[known].created_at !== createdAt) job.conflicts += 1
      job.duplicates += 1
      return
    }
    // `range` is null for a whole-history walk, which keeps every window.
    if (job.range !== null && (createdAt < job.range.start || createdAt >= job.range.end)) {
      job.outside += 1
      return
    }
    job.seen.set(id, job.rows.length)
    job.rows.push(row)
  }

  /**
   * One page, re-requested on failure.
   *
   * A long walk is tens of requests deep, so a single hiccup would otherwise
   * throw away everything collected so far; two retries with a growing pause
   * ride out a blip, and the third failure is reported as the walk's reason.
   */
  const fetchPageWithRetry = async (job, page) => {
    let lastError
    for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt += 1) {
      try {
        return await fetchLogPage(job.baseUrl, job.token, page, ANALYSIS_PAGE_SIZE)
      } catch (error) {
        lastError = error
        if (job.cancelRequested) break
        job.updatedAt = new Date().toISOString()
        await sleep(700 * attempt)
      }
    }
    const reason = messageOf(lastError)
    throw new Error(`第 ${page} 页连续 ${PAGE_ATTEMPTS} 次请求失败：${reason}`)
  }

  /** Walk every page until the range is exhausted, cancelled, or capped. */
  async function collect(job) {
    try {
      await sleep(120)
      let page = 1
      for (;;) {
        if (job.cancelRequested) {
          finish(job, 'cancelled', null)
          return
        }
        if (job.pages >= ANALYSIS_MAX_PAGES || job.rows.length >= ANALYSIS_MAX_RECORDS) {
          job.capped = true
          finish(job, 'complete', '已达本机保护上限（20000 页 / 200000 条），结果可能不完整')
          return
        }
        if (Date.now() - Date.parse(job.startedAt) > ANALYSIS_MAX_MS) {
          finish(job, 'failed', '采集超过 30 分钟保护上限，已停止')
          return
        }
        const pageData = await fetchPageWithRetry(job, page)
        if (job.cancelRequested) {
          finish(job, 'cancelled', null)
          return
        }
        job.pages += 1
        job.scanned += pageData.items.length
        if (Number.isInteger(pageData.total)) job.serverTotal = pageData.total
        // The gateway serves the newest page first. Detecting that order lets a
        // ranged walk stop as soon as a page is entirely older than the window,
        // instead of paging through the whole history to find nothing.
        if (job.pages === 1 && pageData.items.length > 1) {
          const first = pageData.items[0].created_at
          const last = pageData.items[pageData.items.length - 1].created_at
          job.descending = first >= last
        }
        for (const row of pageData.items) ingest(job, row)
        job.updatedAt = new Date().toISOString()
        if (job.range !== null && job.descending === true && pageData.items.length > 0
          && pageData.items.every((row) => row.created_at < job.range.start)) {
          // Everything inside the window has been read: this is a complete walk,
          // not a truncated one, even though it stopped before the last page.
          job.capped = false
          finish(job, 'complete', '已翻到范围之前的数据，提前结束')
          return
        }
        // A short page is the only reliable end-of-data signal the gateway gives.
        if (pageData.items.length < ANALYSIS_PAGE_SIZE) {
          finish(job, 'complete', null)
          return
        }
        page += 1
        await sleep(ANALYSIS_INTERVAL_MS)
      }
    } catch (error) {
      finish(job, 'failed', messageOf(error))
    }
  }

  /** The job for an id, or a message naming the likely cause. */
  const jobOf = (raw) => {
    const id = Number(raw?.id)
    const job = jobs.get(id)
    if (job === undefined) throw new Error('采集任务不存在或已过期，请重新采集')
    return job
  }

  /** Filtered rows for a view query. */
  const rowsFor = (job, query) => {
    if (query.models === undefined) return job.rows
    const allowed = new Set(query.models.map((model) => model ?? null))
    return job.rows.filter((row) => allowed.has(typeof row.model_name === 'string' ? row.model_name : null))
  }

  /** Aggregate one job for the requested view. */
  const analysisResult = (job, query) => {
    const rows = rowsFor(job, query)
    const size = binSizeOf(query.granularity)
    const buckets = new Map()
    const perModel = new Map()
    const hours = Array.from({ length: 24 }, () => [])
    for (const row of rows) {
      const start = binStart(row.created_at, query.granularity, query.offsetMinutes)
      const bucket = buckets.get(start)
      if (bucket === undefined) buckets.set(start, [row])
      else bucket.push(row)
      const model = typeof row.model_name === 'string' ? row.model_name : null
      const group = perModel.get(model)
      if (group === undefined) perModel.set(model, [row])
      else group.push(row)
      hours[hourIndexOf(row.created_at, query.offsetMinutes)].push(row)
    }
    const availableModels = [...new Set(job.rows.map(
      (row) => (typeof row.model_name === 'string' ? row.model_name : null),
    ))].sort((a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'zh-CN'))
    const bins = [...buckets.keys()].sort((a, b) => a - b).map((start) => ({
      start,
      end: start + size,
      metrics: metricsOf(buckets.get(start) ?? []),
    }))
    const models = [...perModel.keys()]
      .map((model) => ({ model, metrics: metricsOf(perModel.get(model) ?? []) }))
      .sort((a, b) => b.metrics.count - a.metrics.count)
    let actualStart = null
    let actualEnd = null
    for (const row of rows) {
      if (actualStart === null || row.created_at < actualStart) actualStart = row.created_at
      if (actualEnd === null || row.created_at > actualEnd) actualEnd = row.created_at
    }
    return {
      status: statusOf(job),
      totals: metricsOf(rows),
      modelCount: models.length,
      availableModels,
      models,
      bins,
      hours: hours.map((bucket) => bucket.length),
      actualStart,
      actualEnd,
    }
  }

  /** One page of the rows behind a selected chart point. */
  const analysisDetails = (job, query, detail) => {
    const page = Number(detail?.page)
    if (!Number.isInteger(page) || page < 1) throw new Error('分析明细分页参数不正确')
    const start = detail?.start === undefined ? undefined : Number(detail.start)
    const end = detail?.end === undefined ? undefined : Number(detail.end)
    const hour = detail?.hour === undefined ? undefined : Number(detail.hour)
    if (hour !== undefined && (!Number.isInteger(hour) || hour < 0 || hour > 23)) {
      throw new Error('分析明细分页参数不正确')
    }
    const selected = rowsFor(job, query).filter((row) => {
      if (Number.isInteger(start) && row.created_at < start) return false
      if (Number.isInteger(end) && row.created_at >= end) return false
      if (hour !== undefined && hourIndexOf(row.created_at, query.offsetMinutes) !== hour) return false
      return true
    })
    selected.sort((a, b) => ((b.created_at - a.created_at) || (b.id - a.id)))
    const size = 50
    const offset = (page - 1) * size
    return {
      items: selected.slice(offset, offset + size),
      total: selected.length,
      page,
      pageSize: size,
    }
  }

  /* ----------------------------------------------------------------- routing */

  /** Answer an untrusted request; true when it was rejected. */
  const rejected = (req, res) => {
    const connection = ctx.get('connection')
    if (connection === undefined) return false
    const rejection = connection.requestRejection(req)
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }

  /** One route, dispatched by pathname and method. */
  const handler = async (req, res) => {
    if (rejected(req, res)) return
    const method = req.method ?? 'GET'
    let path = '/'
    let query = new URLSearchParams()
    try {
      const url = new URL(String(req.url), 'http://localhost')
      path = url.pathname.startsWith(ROUTE) ? url.pathname.slice(ROUTE.length) || '/' : url.pathname
      query = url.searchParams
    } catch {
      fail(res, new Error('请求地址格式不正确'))
      return
    }
    try {
      if (method === 'GET' && path === '/state') {
        reply(res, { settings: await settingsOf() })
        return
      }
      if (method === 'GET' && path === '/logs') {
        const page = Number(query.get('page'))
        const pageSize = Number(query.get('pageSize'))
        if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error('分页参数不正确')
        if (!PAGE_SIZES.includes(pageSize)) throw new Error('分页参数不正确')
        const settings = await settingsOf()
        const token = await tokenOf()
        reply(res, await fetchLogPage(settings.baseUrl, token, page, pageSize))
        return
      }
      if (method === 'POST' && path === '/connect') {
        const body = await readJson(req)
        reply(res, {
          settings: await saveConnection({
            baseUrl: body.baseUrl === undefined ? undefined : String(body.baseUrl),
            token: body.token === undefined ? undefined : String(body.token),
          }),
        })
        return
      }
      if (method === 'POST' && path === '/import') {
        const resolved = await credentialsOf().resolve(TOKEN_REF)
        const value = resolved?.value
        if (typeof value !== 'string' || value.trim().length === 0) {
          throw new Error(`没有找到可导入的 skey（环境变量 ${TOKEN_REF}）`)
        }
        reply(res, { settings: await saveConnection({ token: value }) })
        return
      }
      if (method === 'POST' && path === '/forget') {
        await credentialsOf().deleteRecord(CREDENTIAL_KEY)
        reply(res, { settings: await settingsOf() })
        return
      }
      if (method === 'POST' && path === '/refresh') {
        reply(res, await snapshot())
        return
      }
      if (method === 'POST' && path === '/analysis/start') {
        const range = normalizeRange(await readJson(req))
        const settings = await settingsOf()
        const token = await tokenOf()
        reply(res, statusOf(startAnalysis(range, settings, token)))
        return
      }
      if (method === 'GET' && path === '/analysis/status') {
        reply(res, statusOf(jobOf({ id: query.get('id') })))
        return
      }
      if (method === 'POST' && path === '/analysis/cancel') {
        const job = jobOf(await readJson(req))
        job.cancelRequested = true
        if (job.pages === 0 && job.phase === 'running') finish(job, 'cancelled', null)
        reply(res, statusOf(job))
        return
      }
      if (method === 'POST' && path === '/analysis/result') {
        const body = await readJson(req)
        reply(res, analysisResult(jobOf(body), normalizeQuery(body)))
        return
      }
      if (method === 'POST' && path === '/analysis/details') {
        const body = await readJson(req)
        reply(res, analysisDetails(jobOf(body), normalizeQuery(body), body))
        return
      }
      if (method === 'POST' && path === '/value/start') {
        const range = normalizeValueRange(await readJson(req))
        const settings = await settingsOf()
        const token = await tokenOf()
        reply(res, statusOf(startWalk(settings, token, range)))
        return
      }
      if (method === 'GET' && path === '/value/status') {
        reply(res, statusOf(jobOf({ id: query.get('id') })))
        return
      }
      if (method === 'POST' && path === '/value/cancel') {
        const job = jobOf(await readJson(req))
        job.cancelRequested = true
        if (job.pages === 0 && job.phase === 'running') finish(job, 'cancelled', null)
        reply(res, statusOf(job))
        return
      }
      if (method === 'POST' && path === '/value/result') {
        const body = await readJson(req)
        reply(res, await valueResult(jobOf(body), body))
        return
      }
      if (method === 'POST' && path === '/value/prices') {
        reply(res, await officialPricing(true))
        return
      }
      if (method === 'GET' && path === '/value/prices') {
        reply(res, await officialPricing(false))
        return
      }
      sendJson(res, 404, { ok: false, error: '未知接口' })
    } catch (error) {
      fail(res, error)
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler,
  }), `${name}: data route ${ROUTE}`)

  ctx.effect(() => () => {
    for (const job of jobs.values()) job.cancelRequested = true
    jobs.clear()
  }, `${name}: release analysis jobs`)
}
