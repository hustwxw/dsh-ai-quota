# dsh-ai-quota

**English** | [中文](README.md)

An AI quota panel — a Cordis plugin for **DeepSeek Harness (DSH)**.

---

## ⚡ One-paste install: hand the block below to your DSH

> **No clone, no hand-typed commands.** This prompt already carries the install command, the mirror
> fallback, the version trap and the verification step; the receiving DSH installs it and reports back.
> **Just sending the link and letting it guess usually ends in a wrong version or a 404.**

```text
You are DSH. Install a plugin for me and verify it actually works — do not just
hand me instructions.

Plugin: "AI Quota" panel (npm package dsh-ai-quota,
repository https://github.com/hustwxw/dsh-ai-quota)

Do this, in order:
1) Call plugin_manager with action = install_bundle and target = dsh-ai-quota;
   afterwards confirm it is enabled = true.
2) If you get ERR_PNPM_FETCH_404 / not-found / package does not exist:
   - first retry with registry = https://registry.npmjs.org (domestic mirrors lag
     a few minutes behind for a freshly published package);
   - if that still fails, git clone https://github.com/hustwxw/dsh-ai-quota and
     reinstall with target set to that directory's absolute path.
   - Never install 0.0.0-stage: it is npm's auto-created empty placeholder stub
     and nothing will show up in the sidebar. You want latest (currently 0.3.3).
3) Then ask me to refresh the Web UI, and confirm an "AI Quota" icon appears in
   the sidebar (right after Plugins / Scheduled tasks). You can verify with
   cordis_inspect_query (platform = client, provider = Slots, method =
   listSubTree, root = main): look for an entry with key = ai-quota-panel.
4) Report three things to me: the version actually installed, whether the sidebar
   icon appeared, and what I need to fill in next.

Hard rule: do not read, do not ask for, and do not type in my skey or gateway
address — I enter those myself under the panel's Connection tab. The skey belongs
only in my local credential store.
```

The only thing the other side has to do afterwards: **panel → Connection → enter the gateway address and skey** (the default address is a placeholder; without it the panel just says "not configured").

| Common failure | Fix |
| --- | --- |
| `ERR_PNPM_FETCH_404` / package not found | retry with `registry = https://registry.npmjs.org`, or fall back to clone + directory install |
| Installed but no sidebar icon | refresh the Web UI; if it is still missing, check the bundle is enabled |
| Ended up with `0.0.0-stage` | that is the empty stub — remove it and install `latest` |
| Icon present but no number | no skey, or the gateway is unreachable — expected behaviour, never a stale number |

---

It turns a company AI quota gateway (built on [New API](https://github.com/Calcium-Ion/new-api)) into a resident panel inside the Harness Web UI: the sidebar row shows the remaining-quota percentage and refreshes on a click, and the panel itself covers the quota overview, model limits, paginated call logs, model pricing, and ranged call analysis with drill-down.

- The UI runs in the browser (React + theme tokens, **importing no Harness Client package**), while the data is fetched from the gateway by the Harness Host process.
- The skey lives in the local credential store (Harness `credentials`). It is **never written to browser storage and never sent back to the page** — the page only learns whether one is configured.
- Read-only: the plugin only ever issues GETs and never writes to the gateway.
- The display name of the sidebar row and the panel title is **configurable** (default `AI Quota`), see [Display name](#display-name).
- Feature-equivalent to the desktop `ai-quota-tauri` build (Tauri 2 + Rust + React, v0.3.0), without opening a second app.

![Panel overview](docs/overview.png)

The sidebar row appends the remaining quota to the name — click the icon to refresh, click the text to open the panel (the name in the screenshot is a configured one and has been redacted):

![Sidebar row](docs/sidebar.png)

Call log: server-side paging (20 / 50 / 100 per page), in-page search over model name and request ID, click a row for every field:

![Call log](docs/call-log.png)

## Display name

The sidebar row and the panel title share one configurable name, `AI Quota` by default:

1. Open the panel → **Connection** → **Display name**.
2. Type a name (40 characters max, e.g. `AI Quota`, `Team quota`, `R&D quota`) and **leave the field or press Enter** — the sidebar row and the panel title both change at once.
3. Clear the field to fall back to the default.

It is a **browser-local preference**:

- stored in `localStorage` under `dsh-ai-quota/display-name` — not in the credential store, not uploaded, not shared with anyone else;
- another browser or a cleared cache falls back to the default;
- only the name changes: no route, no data, and the percentage still follows the name (`My quota · 79%`).

## Sidebar percentage

The row renders as `<display name> · 79%`:

| Behaviour | Detail |
| --- | --- |
| Meaning | `remaining ÷ granted`, rounded to an integer; an unlimited quota shows `∞` |
| Auto refresh | Every 15 minutes while the page is open; closing the tab stops it |
| Manual refresh | **Clicking the row's bar-chart icon** (does not open the panel; the icon spins, then turns green/red); clicking the text opens the panel. Refresh in the panel is the same action |
| Coming back to the tab | One refresh, throttled to one per 30 seconds so tab switching cannot hammer the gateway |
| Hidden when unknown | No skey, unreachable gateway, business failure, or a payload without quota fields — the name stays, a stale number never does |
| Cleared credential | Saving or clearing the skey drops the number immediately |

## Features

| Tab | Contents |
| --- | --- |
| Connection | Server address, save the skey, import it from `AI_QUOTA_SKEY`, clear the credential, set the display name |
| Overview | Granted, used, remaining, usage ratio, expiry (`expires_at <= 0` reads as "no expiry"), token name, model-limit switch and per-model limits |
| Models & pricing | Model list and endpoint types from `/v1/models`; the price table and group ratios from `/api/pricing` |
| Call log | Server-side paging (20 / 50 / 100), in-page search over model name and request_id, click a row for every field |
| Analysis | Date range + time zone (UTC / UTC+8) + day or hour granularity; the Host pages through the log and aggregates locally into quota trend, token trend, model ranking and a 24-hour histogram; clicking a bar drills into the rows (50 per page) |
| Versions | What each release changed |

Analysis is "collect, then aggregate locally": the Host walks pages from 1 until a page comes back short of 50 rows (the gateway's only end signal), de-duplicates by `id`, counts rows that fall outside the range / repeat / conflict, and aggregates by granularity and time zone. Guard rails are 20 000 pages, 200 000 rows and 30 minutes; hitting one says so in the status line rather than silently truncating.

## Install

Requires a local DeepSeek Harness with a working Web UI.

**One line, straight from npm** (no clone needed):

```
plugin_manager  install_bundle  target = dsh-ai-quota
```

Refresh the Web UI: an **AI Quota** icon appears in the sidebar panel list, after Plugins / Scheduled tasks.

> Behind a slow or stale mirror, point `install_bundle` at `registry = https://registry.npmjs.org`; npmmirror lags a few minutes behind for a freshly published package.

Installing from source (when you want to change the code):

```powershell
git clone https://github.com/hustwxw/dsh-ai-quota.git
```

Then install that directory instead:

```
plugin_manager  install_bundle  target = <absolute path of the clone>
```

During development a change to `client.js` takes effect on a page refresh; a change to `index.js` (the Host half) needs a Harness restart. The render test only really runs when React 18 is resolvable (see below), otherwise it reports SKIPPED.

Prefer not to type commands? Hand [the prompt at the top](#-one-paste-install-hand-the-block-below-to-your-dsh) to the receiving DSH — it installs and verifies by itself.

Only two prerequisites: DSH with a working Web UI on the target machine, and reachability of your own New API gateway (intranet / VPN).

If npm is not an option (intranet, mirror lag, a CDN-cached 404), fall back to source: `git clone https://github.com/hustwxw/dsh-ai-quota` and point `install_bundle`'s target at that directory's absolute path.

npm page: <https://www.npmjs.com/package/dsh-ai-quota>

## Configuration

1. Sidebar → AI Quota → Connection.
2. Server address: `http(s)://host[:port]` only; a path is rejected. Empty means the default.
3. Paste the skey and save, or export it as `AI_QUOTA_SKEY` first and use **Import from environment**.
4. The overview fetches once after saving. A failing section only affects that section; the reason shows under its card.

The default gateway address is the placeholder `http://newapi.example.com` (the `DEFAULT_BASE_URL` constant in `index.js`). Point it at your own New API instance either in the Connection tab or by editing that constant.

## Data & privacy

- The skey is stored under the credential key `ai-quota/default` (`kind: api-key`); the server address rides the same record as `env.AI_QUOTA_BASE_URL`.
- The display name only ever touches `localStorage` (`dsh-ai-quota/display-name`); never the credential store, never the network.
- The page talks to the Host over the same-origin `POST /x-ai-quota/...` route, which passes the Harness connection check; the credential itself never leaves the Host.
- Analysis rows live in Host memory only; at most 4 jobs are kept and a Host restart clears them.
- Gateway responses are trimmed by field allowlist before reaching the page (8 quota fields, 2 model fields, 7 pricing fields, 12 log fields), so unknown fields never show up in the UI.

## API contract

- Exactly four read-only endpoints: `GET /api/usage/token/`, `GET /v1/models`, `GET /api/pricing` (no auth), `GET /api/log/token`.
- 20 s timeout, no proxy, no redirect following, 8 MiB response cap; **HTTP 200 can still be a business failure**, so the `code` / `success` flag is validated per endpoint.
- Paging is 1-based and `page_size` is restricted to 20 / 50 / 100; the analysis window is `[start, end)` with `end` sent as "last second + 1".
- A missing field stays missing — the UI shows "not returned" instead of inventing a zero.

## Known limitations

- Analysis has to walk every log row in range, so a large window takes a while (300 ms between pages to keep the gateway responsive).
- The 24-hour histogram, model ranking and trends all come from one collection; changing the model filter re-aggregates but does not re-collect.
- The percentage reflects the token-level remaining quota; it is not split per model.

## Development & tests

```powershell
node tests/host-test.mjs      # Host half: fake gateway covers the 4 endpoints, allowlists, paging, collection, aggregation
node tests/locale-check.cjs   # 2 slot registrations, 148 zh/en keys aligned, no dead key
node tests/render-test.mjs    # 37 cases rendered with real React 18 (needs React 18, see below)
```

`tests/host-test.mjs` starts a fake gateway on a random port (4 endpoints, 120 log rows), mounts `index.js` into a stub context and runs the whole flow — **without touching a real gateway and without a skey**.

The render test needs React 18; provide it in any of these ways (otherwise it SKIPs):

```powershell
pnpm add -D react@18 react-dom@18          # into this repo
$env:REACT_ROOT = 'C:\some\node_modules'   # or a node_modules that already has React 18
$env:DSH_NODE_MODULES = '<harness>\node_modules'   # or a DSH checkout's pnpm store
```

## Layout

```
index.js           Host half: credential I/O, gateway forwarding, analysis collection and aggregation, HTTP route (node: builtins only)
client.js          Browser half: panel UI + sidebar icon/percentage/display name (React + theme tokens, no third-party dependency)
cordis.patch.yml   Bundle patch that inserts the plugin into Harness
locale/zh.json     Panel title and description (Chinese)
locale/en.json     Panel title and description (English)
icon.svg           Sidebar icon
docs/              Screenshots used by the READMEs
tests/             Three self-tests (fake-gateway integration, locale/registration check, React render test)
```

The package is published to npm as `dsh-ai-quota`, so `install_bundle` takes the package name; installing from source means pointing `target` at the clone instead.

## License

[MIT](LICENSE) © 2026 hustwxw
