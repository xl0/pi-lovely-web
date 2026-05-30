# Code

## Purpose
Minimal Pi extension package providing multi-provider web access (Firecrawl, Exa, Tavily, Brave) for Pi.

## Package
- Published package name: `@xl0/pi-lovely-web`; package description: "Pi extension package for web_search, web_fetch, and web_image via Firecrawl, Exa, Tavily, and Brave."
- Pi entry: `extensions/` via `package.json#pi.extensions`.
- Published files include `extensions/`, `README.md`, and `LICENSE`; package gallery image metadata points at GitHub-hosted screenshots under `assets/`.
- Zero runtime dependencies. Pi APIs are peer dependencies with minimum version `>=0.75.4`.

## Test infrastructure
`test/cases.json` — 3 query-pattern cases (`search`, `search-fetch`, `fetch`), each tested against applicable providers. `search` runs on firecrawl+exa+tavily+brave; `search-fetch`/`fetch` run on firecrawl+exa+tavily (brave is search-only). Queries are stable topics to avoid content drift.
`test/references/ref-*.txt` — shared reference snapshots, generated from Tavily (provider-agnostic). All providers compare against the same refs; LLM judges formatting/structure, not content.
`test/.env` — API keys for providers (gitignored), loaded by test scripts without overriding existing environment variables.
`test/env.ts` — tiny `.env` loader shared by test scripts.
`test/run.ts` — runs each case/provider pair sequentially via `spawn("pi", ...)` in Pi JSON mode. Each run gets a timestamped ignored `test/sessions/<run-id>/` directory; each case/provider invocation saves to a named session file printed on the result line as a relative path. Per-provider config is written to `.pi/xl0-pi-lovely-web.json` and removed in a `finally` block. LLM compares field-labeled output structure to reference with per-case expectations; final assistant text must end with exact `OK` or `FAIL: ...`. Summary at end, exits non-zero on failures.
`test/update-references.ts` — calls Tavily provider directly with keys from `test/.env`/environment, saves formatted tool text as reference, exits non-zero on failures.
`test/image.ts` — direct external-network smoke test for `imageImpl`: small PNG from httpbin remains unresized; large Picsum JPEG is resized to Pi inline limits.

## Extension
`extensions/lovely-web/index.ts` is the Pi entrypoint. It applies active-tool config on `session_start`, registers tools via `tools.ts`, and registers `/lovely-web` via `command.ts`.

- `tools.ts`: registers `web_search`, `web_fetch`, and `web_image`; owns common tool schemas, prompt snippets/guidelines, call/result rendering hooks, and execute wrappers. Provider-specific `web_search`/`web_fetch` parameters live on provider objects. Tools are registered at extension load, then `web_search`/`web_fetch` are re-registered on session start and after `/lovely-web` config saves so public parameters match the active providers. Tool execute functions resolve configured providers/API keys and call providers directly. `web_search` fetches the first result only when `fetchResult:true` and a fetch provider is configured.
- `constants.ts`: shared extension constants, currently the default request timeout.
- `types.ts`: shared `ToolResult` shape for tool content/details/error returns.
- `image.ts`: exports standalone `imageImpl`; downloads direct image URLs without provider config/API keys. Supports PNG/JPEG/WebP/GIF, default 5 MB download cap, maximum 20 MB, optional timeout/maxBytes. Downloaded images are passed through Pi's `resizeImage()` before returning to the LLM; if decoding/resizing cannot fit inline limits, the image is omitted with a note. Metadata lives in `details`; Pi's generic image-content renderer displays the image block.
- `command.ts`: `/lovely-web` SettingsList-based interactive command to configure providers, API keys, search/fetch disabled state (`provider:null`), and image enabled state. Active-tool changes are applied immediately through Pi `setActiveTools()`.
- `render.ts`: shared collapsed text result renderer for search/fetch.

Tools:
- `web_search`: search dispatching to configured search provider with provider-specific schema. Common args are `query`, optional `limit`, and optional `fetchResult`; provider-specific args mirror useful API concepts (`source` for Firecrawl/Brave, `category` for Exa, `topic`/`includeImages` for Tavily). Result rendering shows the first few output lines until expanded. `fetchResult` defaults to false; when true and `web_fetch` has a configured provider, the first result is fetched. Image searches first try direct image fetch/resizing and fall back to page markdown fetch only when the result URL is not image content and `web_fetch` is configured.
- `web_fetch`: fetch one URL as cleaned markdown dispatching to configured fetch provider. Common public options are `url`, optional `timeout`, and optional `includeMetadata`; extra provider-specific options are Firecrawl `waitFor`, Exa `maxAgeHours`, and Tavily `extractDepth`. Tool call rendering shows supplied non-default args. Result rendering shows the first few output lines until expanded.
- `web_image`: fetch a direct image URL and return a short text note plus one image content block, matching Pi `read` image behavior. Resizing is controlled by config (`webImage.resize`, default true) and max longest side (`webImage.maxSize`, default 2000 px).

## Provider dispatch
`extensions/lovely-web/config.ts` owns provider registry/config helpers and exports `CONFIG_FILE_NAME` (`xl0-pi-lovely-web.json`). Search and fetch providers are configurable independently in that file (`~/.pi/agent/` global, `.pi/` project, project overrides). `webSearch.provider` defaults to `firecrawl`. `webFetch.provider` has no default; missing or `null` removes `web_fetch` from Pi's active tool list and gates execution. `webImage.enabled` defaults to true; setting it to false removes `web_image`. Malformed config JSON throws a path-specific error; session startup and `/lovely-web` show it as a user-facing error.

API key resolution: `webApiKeys.<providerId>` in config → `process.env[PROVIDER_ENV_KEY]` → error.

`providers/http.ts` contains shared JSON request handling for fetch timeouts, abort propagation, non-2xx errors, and JSON parsing.

## Providers

### Firecrawl (`providers/firecrawl.ts`)
- Base: `https://api.firecrawl.dev/v2`
- Search: POST `/v2/search` with query, limit, optional sources array, optional categories/location/country/tbs. Maps the returned `web`/`news`/`images` arrays into `SearchResult[]`; image searches use `imageUrl` as the result URL when present.
- Fetch: POST `/v2/scrape` with url, formats:["markdown"], `onlyMainContent:true`, optional waitFor.
- Auth: `Authorization: Bearer <key>`.
- Response wrapped in `{ success, data }` — provider checks success before mapping.

### Exa (`providers/exa.ts`)
- Search: POST `/search` with query, numResults, type:"auto", contents:{summary:true}, optional Exa `category`, optional `userLocation` via `country`. Exa has no `source` parameter; if passed, provider errors.
- Search result descriptions use Exa's semantic `summary` field (abstractive, query-tailored page summaries) with a leading `Summary:` label stripped if Exa returns one.
- Fetch: POST `/contents` with urls:[url], text:true, optional maxAgeHours.
- Auth: `x-api-key` header.
- Results normalized from `results[]` array. Fetch checks `statuses` for per-URL errors.

### Tavily (`providers/tavily.ts`)
- Search: POST `/search` with query, max_results, search_depth:"basic", optional topic/time_range/country/include_images. `topic` supports general/news/finance; `includeImages:true` maps Tavily's top-level image URLs into `SearchResult[]`. Tavily has no `source` parameter; if passed, provider errors.
- Search result descriptions use Tavily's `content` field (semantic snippets).
- Fetch: POST `/extract` with urls:[url], configurable extract_depth (default "basic"), format:"markdown". Returns `{results:[{url, raw_content, images, favicon}], failed_results[]}`.
- Auth: `Authorization: Bearer <key>`. Env key: `TAVILY_API_KEY`.

### Brave Search (`providers/brave.ts`)
- Search-only provider (no `fetch` implementation).
- Search: GET `/web/search`, `/news/search`, or `/images/search` with query params `q`, `count`, optional country/search_lang/freshness. Source determines endpoint.
- Web response: `{web:{results:[{title, url, description}]}}`. News response: `{results:[...]}`. Image response: `{results:[{url, title?, description?, properties?, thumbnail?}]}`; normalized URL prefers `properties.url`, then `thumbnail.src`, then page `url`.
- `description` strips HTML tags (`<strong>` etc) from Brave snippets.
- If Brave is configured as the only provider and `web_fetch` is called, it errors with guidance about needing a fetch-capable provider.
- Auth: `X-Subscription-Token` header. Env key: `BRAVE_API_KEY`.

## Shared types (`providers/types.ts`)
```ts
SearchResult { title, url, description?, markdown? }
SearchOptions { limit, source?, timeout?, category?, location?, country?, tbs?, timeRange?, topic?, includeImages?, searchLang?, freshness? }
FetchOptions { timeout?, waitFor?, maxAgeHours?, extractDepth? }
Provider { id, label, envApiKey, searchParameters?, fetchParameters?, search(apiKey, query, SearchOptions), fetch?() }
WebToolsConfig { webSearch?: {provider?: string | null}, webFetch?: {provider?: string | null}, webImage?: {enabled?, resize?, maxSize?}, webApiKeys? }
```

## Shared HTTP (`providers/http.ts`)
`requestJson()` wraps provider HTTP requests with timeout, abort propagation, non-2xx error text, and JSON parsing.
`web_image` downloads with `fetch()`, validates HTTP status, supported image MIME type, response body, and byte cap while streaming; then uses Pi's exported image resize helper to enforce inline image limits. Tool content contains a short text note plus the resized image block (or decode/resize omission note), with URL/mime/bytes/contentLength/dimensions/originalDimensions/wasResized metadata in `details`.

## Formatting (`format.ts`)
Provider-agnostic: `formatSearchOutput(results: SearchResult[])` emits numbered results with concise `title`/`url`/`desc`/`markdown` fields, indents multiline description fields, leaves fetched markdown unindented to avoid token waste, and truncates non-fetched result descriptions at 300 chars; `stringify()`, `asErrorMessage()`.
