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
  'cache_write_tokens', 'request_id',
]

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

  /** Create one collection job and start it; the page polls its status. */
  const startAnalysis = (range, settings, token) => {
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
    if (createdAt < job.range.start || createdAt >= job.range.end) {
      job.outside += 1
      return
    }
    job.seen.set(id, job.rows.length)
    job.rows.push(row)
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
          finish(job, 'complete', '已达本机保护上限（20000 页 / 200000 条），结果可能不完整')
          return
        }
        if (Date.now() - Date.parse(job.startedAt) > ANALYSIS_MAX_MS) {
          finish(job, 'failed', '采集超过 30 分钟保护上限，已停止')
          return
        }
        const pageData = await fetchLogPage(job.baseUrl, job.token, page, ANALYSIS_PAGE_SIZE)
        if (job.cancelRequested) {
          finish(job, 'cancelled', null)
          return
        }
        job.pages += 1
        job.scanned += pageData.items.length
        if (Number.isInteger(pageData.total)) job.serverTotal = pageData.total
        for (const row of pageData.items) ingest(job, row)
        job.updatedAt = new Date().toISOString()
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
    if (job === undefined) throw new Error('分析任务不存在或已过期，请重新采集')
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
