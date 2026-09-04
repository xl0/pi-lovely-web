# Code

## Purpose
Minimal Pi extension package providing multi-provider web access plus direct textual HTTP GET (Firecrawl, Exa, Tavily, Brave) for Pi.

## Package
- Published package name: `@xl0/pi-lovely-web`; package description: "Pi extension package for direct HTTP GET plus web_search, web_fetch, and web_image via Firecrawl, Exa, Tavily, and Brave."
- Pi entry: `extensions/` via `package.json#pi.extensions`.
- Published files include `extensions/`, `README.md`, and `LICENSE`; package gallery image metadata points at GitHub-hosted screenshots under `assets/`.
- Runtime dependency: `@xl0/pi-lovely-config` `^0.1.1`. Pi AI/coding-agent/TUI dev/peer dependencies require `^0.84.0` / `>=0.84.0` (smart query needs the `baseUrl` in `getApiKeyAndHeaders`, present since pi 0.84).

## Test infrastructure
`test/cases.json` — 3 query-pattern cases (`search`, `search-fetch`, `fetch`), each tested against applicable providers. `search` runs on firecrawl+exa+tavily+brave; `search-fetch`/`fetch` run on firecrawl+exa+tavily (brave is search-only). Queries are stable topics to avoid content drift.
`test/references/ref-*.txt` — shared reference snapshots, generated from Tavily (provider-agnostic). All providers compare against the same refs; LLM judges formatting/structure, not content.
`test/.env` — API keys for providers (gitignored), loaded by test scripts without overriding existing environment variables.
`test/env.ts` — tiny `.env` loader shared by test scripts.
`test/run.ts` — runs each case/provider pair sequentially via `spawn("pi", ...)` in Pi JSON mode. Each run gets a timestamped ignored `test/sessions/<run-id>/` directory; each case/provider invocation saves to a named session file printed on the result line as a relative path. Per-provider config is written to `.pi/xl0-pi-lovely-web.json` and removed in a `finally` block. LLM compares field-labeled output structure to reference with per-case expectations; final assistant text must end with exact `OK` or `FAIL: ...`. Summary at end, exits non-zero on failures.
`test/update-references.ts` — calls Tavily provider directly with keys from `test/.env`/environment, saves formatted tool text as reference, exits non-zero on failures.
`test/get.ts` — local deterministic tests for shared UTF-8/line-aware output limits, smart-query context budgeting, config-key migration, `web_fetch` raw/find temp-file behavior, and `web_get` bodyless/text/non-text/error handling.
`test/image.ts` — direct external-network smoke test for `imageImpl`: small PNG from httpbin remains unresized; large Picsum JPEG is resized to Pi inline limits; both preserve their original downloaded files.
`test/smart-prompt.ts` — live smart-prompt evaluation harness, not published because `package.json#files` excludes `test/`. It imports `SMART_QUERY_SYSTEM_PROMPT`, scrapes pages through Firecrawl with cache under ignored `test/smart-cache/`, calls `@earendil-works/pi-ai` directly using `~/.pi/agent/auth.json`, saves full outputs under ignored `test/smart-results/<run-id>/`, and prints costs/warnings for diverse summarization, verbatim example, troubleshooting, config/API, security, missing-info, and legal/admin cases. `bun run test:smart` runs it; options include `--list`, `--case`, `--limit`, `--model`, `--max-tokens`, `--refresh`, and `--fail-warnings`.

## Extension
`extensions/lovely-web/index.ts` is the Pi entrypoint. It applies active-tool config on `session_start`, registers tools via `tools.ts`, and registers `/lovely-web` via `command.ts`.

- `tools.ts`: registers `web_search`, `web_fetch`, `web_get`, and `web_image`; owns schemas, prompts, rendering, provider dispatch, raw output limiting, source-file notices, and find/smart-query execution. `web_search.fetchResult` and raw `web_fetch`/`web_get` use the configured output cap; find and smart query operate on complete fetched text up to provider/download limits.
- `find.ts`: deterministic `web_fetch.findText` implementation. It supports `fuzzy` (default), `exact`, and `lower` modes; lower mode preserves original Unicode offsets for snippets/highlights, and fuzzy mode tokenizes source text with original offsets so accent-insensitive/typo-tolerant matches highlight actual source tokens instead of normalized text positions. Fuzzy ignores 1-character query tokens, requires numeric tokens to match exactly, and highlights a compact matching token window rather than every repeated token in a chunk. Returned tool content is plain text; render-only text uses private highlight markers for the UI.
- `smart.ts`: non-agentic smart-query helper and exported `SMART_QUERY_SYSTEM_PROMPT`. It resolves configured `smartQueryModel` or current Pi model/auth, limits fetched content to `smartQueryInputPercent` (75% default) while reserving configured output, prompt overhead, and 4096 safety tokens, streams through the owning registry provider's `streamSimple()` (extension-registered providers are absent from pi-ai's global compat table), and returns model/usage/truncation/retry details. Retryable smart-query errors retry up to three times at fixed one-second intervals and emit tool progress for each retry. Unknown context uses an 80K-token fallback context. The built-in grounded prompt supports summaries, extraction/comparison, troubleshooting, config/API details, security/migration notes, and verbatim excerpts. Unavailable models disable smart query for the session with a warning.
- `constants.ts`: shared extension constants, currently the default request timeout.
- `get.ts`: streams direct GET responses up to 100 MB, decodes declared textual MIME/charsets, strips HTML script/style blocks, and saves the resulting text to private temp files. Non-text bodies are saved unprocessed. HTTP status does not determine execution failure.
- `output.ts`: shared raw text byte/line counting, UTF-8-safe and line-preferred prefix limiting, private markdown temp-file writing, and source/truncation notice formatting. Default raw cap is 50,000 bytes; `0` means unlimited.
- `image.ts`: exports standalone `imageImpl`; downloads direct image URLs without provider config/API keys. Supports PNG/JPEG/WebP/GIF, default 5 MB download cap, maximum 20 MB, optional timeout/maxBytes. Original downloaded bytes can be saved privately before Pi's `resizeImage()` validates/re-encodes/resizes the inline image; the path is included in tool text/details. If decoding/resizing cannot fit inline limits, the image is omitted with a note.
- `command.ts`: `/lovely-web` opens `ScopedConfigEditor` from `@xl0/pi-lovely-config` to configure providers, API keys, enabled tools, image settings, raw output, and smart-query settings across user/workspace scopes. Active-tool changes apply immediately.
- `render.ts`: shared collapsed text result renderer for search/fetch. It renders plain text, applies render-only `findText` highlight markers as bold accent UI styling, and appends a muted expand hint when collapsed.

Tools:
- `web_search`: search dispatching to configured provider with provider-specific schema. `fetchResult:true` fetches first result when a fetch provider is configured; fetched markdown uses configured raw cap and is saved privately. Image searches first try direct image fetch/resizing and fall back to markdown fetch.
- `web_fetch`: provider-produced markdown. Raw mode returns at most configured `rawOutputMaxBytes`, reports shown/total lines and bytes, and always saves complete markdown. `findText` searches complete markdown and returns existing ~20K snippet output; `smartQuery` receives its model-budgeted prefix. Processing modes expose the saved path/stats in output/details. Metadata is included only when requested and participates in saving/processing.
- `web_get`: provider-free direct HTTP GET with 100 MB hard download cap. Declared textual MIME types decode using declared charset or UTF-8, with Windows-1252 fallback for legacy HTML; script/style stripping defaults on. Raw/find/smart behavior matches `web_fetch`; saved textual files contain that decoded/stripped text. Missing/non-text MIME bodies never enter model context and are saved unprocessed. Textual non-2xx responses remain normal tool results with prominent `[HTTP …]` status and body/processing output; network, decoding, and size failures throw. Response status/final URL/headers/MIME/charset/bytes/path live in details.
- `web_image`: fetch a direct image URL and return a short text note plus one image content block, matching Pi `read` image behavior. Resizing is controlled by config (`webImageResize`, default true) and max longest side (`webImageMaxSize`, default 2000 px).

## Provider dispatch
`extensions/lovely-web/config.ts` owns provider registry/scoped config. Raw output uses `rawOutputMaxBytes` (50,000 default; `0` unlimited); fetched content is always saved privately. Smart-query settings are `smartQueryEnabled` (false), `smartQueryModel`, `smartQueryMaxTokens` (2000), `smartQueryInputPercent` (75), and `smartQuerySystemPrompt`. Persisted `smartSearchEnabled/Model/MaxTokens/SystemPrompt` keys migrate in place to `smartQuery*`; old-file provider config migration remains. Invalid JSON throws path-specific errors; invalid known values warn and are ignored.

API key resolution: `<provider>ApiKey` in config (`firecrawlApiKey`, `exaApiKey`, `tavilyApiKey`, `braveApiKey`) → `process.env[PROVIDER_ENV_KEY]` → error. Old `xl0-web-tools.json` nested configs are migrated to the new flat `xl0-pi-lovely-web.json` file per scope, then deleted; malformed old configs are deleted and skipped; existing new-file keys win if both files exist.

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
WebToolsConfig { webSearchProvider, webFetchProvider, webImageEnabled, webImageResize, webImageMaxSize, rawOutputMaxBytes, smartQueryEnabled, smartQueryModel, smartQueryMaxTokens, smartQueryInputPercent, smartQuerySystemPrompt, firecrawlApiKey, exaApiKey, tavilyApiKey, braveApiKey }
```

## Shared HTTP (`providers/http.ts`)
`requestJson()` wraps provider HTTP requests with timeout, abort propagation, non-2xx error text, and JSON parsing.
`web_image` downloads with `fetch()`, validates HTTP status, supported image MIME type, response body, and byte cap while streaming; it saves original downloaded bytes to a private temp file and inserts the path into tool output/details. Pi's image resize helper then enforces inline image limits. Tool content contains the note plus resized image block (or decode/resize omission note), with URL/mime/bytes/contentLength/path/dimensions/originalDimensions/wasResized metadata in `details`.

## Formatting (`format.ts`)
Provider-agnostic: `formatSearchOutput(results: SearchResult[])` emits numbered results with concise `title`/`url`/`desc`/`markdown` fields, indents multiline description fields, leaves fetched markdown unindented to avoid token waste, and truncates non-fetched result descriptions at 300 chars; `stringify()`, `asErrorMessage()`.
