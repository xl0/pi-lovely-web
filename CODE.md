# Code

## Purpose
Minimal Pi extension package providing multi-provider web access (Firecrawl, Exa, Tavily, Brave) for Pi.

## Package
- Published package name: `@xl0/pi-lovely-web`; package description: "Pi extension package for web_search, web_fetch, and web_image via Firecrawl, Exa, Tavily, and Brave."
- Pi entry: `extensions/` via `package.json#pi.extensions`.
- Published files include `extensions/`, `README.md`, and `LICENSE`; package gallery image metadata points at GitHub-hosted screenshots under `assets/`.
- Runtime dependency: `@xl0/pi-lovely-config` `^0.1.1`. Pi APIs and `@earendil-works/pi-ai` are peer dependencies with minimum version `>=0.79.10`.

## Test infrastructure
`test/cases.json` — 3 query-pattern cases (`search`, `search-fetch`, `fetch`), each tested against applicable providers. `search` runs on firecrawl+exa+tavily+brave; `search-fetch`/`fetch` run on firecrawl+exa+tavily (brave is search-only). Queries are stable topics to avoid content drift.
`test/references/ref-*.txt` — shared reference snapshots, generated from Tavily (provider-agnostic). All providers compare against the same refs; LLM judges formatting/structure, not content.
`test/.env` — API keys for providers (gitignored), loaded by test scripts without overriding existing environment variables.
`test/env.ts` — tiny `.env` loader shared by test scripts.
`test/run.ts` — runs each case/provider pair sequentially via `spawn("pi", ...)` in Pi JSON mode. Each run gets a timestamped ignored `test/sessions/<run-id>/` directory; each case/provider invocation saves to a named session file printed on the result line as a relative path. Per-provider config is written to `.pi/xl0-pi-lovely-web.json` and removed in a `finally` block. LLM compares field-labeled output structure to reference with per-case expectations; final assistant text must end with exact `OK` or `FAIL: ...`. Summary at end, exits non-zero on failures.
`test/update-references.ts` — calls Tavily provider directly with keys from `test/.env`/environment, saves formatted tool text as reference, exits non-zero on failures.
`test/image.ts` — direct external-network smoke test for `imageImpl`: small PNG from httpbin remains unresized; large Picsum JPEG is resized to Pi inline limits.
`test/smart-prompt.ts` — live smart-prompt evaluation harness, not published because `package.json#files` excludes `test/`. It imports `SMART_SYSTEM_PROMPT`, scrapes pages through Firecrawl with cache under ignored `test/smart-cache/`, calls `@earendil-works/pi-ai` directly using `~/.pi/agent/auth.json`, saves full outputs under ignored `test/smart-results/<run-id>/`, and prints costs/warnings for diverse summarization, verbatim example, troubleshooting, config/API, security, missing-info, and legal/admin cases. `bun run test:smart` runs it; options include `--list`, `--case`, `--limit`, `--model`, `--max-tokens`, `--refresh`, and `--fail-warnings`.

## Extension
`extensions/lovely-web/index.ts` is the Pi entrypoint. It applies active-tool config on `session_start`, registers tools via `tools.ts`, and registers `/lovely-web` via `command.ts`.

- `tools.ts`: registers `web_search`, `web_fetch`, and `web_image`; owns common tool schemas, prompt snippets/guidelines, call/result rendering hooks, and execute wrappers. Provider-specific `web_search`/`web_fetch` parameters live on provider objects. Tools are registered at extension load, then `web_search`/`web_fetch` are re-registered on session start and after `/lovely-web` config saves so public parameters match the active providers. Tool execute functions resolve configured providers/API keys and call providers directly, and throw execution errors so Pi marks failed tool calls. `web_search` fetches the first result only when `fetchResult:true` and a fetch provider is configured. `web_fetch` supports text snippet search via `findText`/`findMode`; when smart search is enabled, `smartQuery` post-processes fetched markdown via `smart.ts`. `findText` and `smartQuery` read raw fetched markdown independently and concatenate their outputs while preserving raw provider output in `details`.
- `find.ts`: deterministic `web_fetch.findText` implementation. It supports `fuzzy` (default), `exact`, and `lower` modes; lower mode preserves original Unicode offsets for snippets/highlights, and fuzzy mode tokenizes source text with original offsets so accent-insensitive/typo-tolerant matches highlight actual source tokens instead of normalized text positions. Fuzzy ignores 1-character query tokens, requires numeric tokens to match exactly, and highlights a compact matching token window rather than every repeated token in a chunk. Returned tool content is plain text; render-only text uses private highlight markers for the UI.
- `smart.ts`: smart fetch post-processing helper and exported `SMART_SYSTEM_PROMPT` for the live prompt harness. If enabled, resolves configured `smartSearchModel` (`provider/model`) or uses the current Pi model when the resolved config leaves it empty, resolves model auth through Pi, truncates input to half the model context estimate, calls `completeSimple()`, and returns model output plus model/usage metadata. `smartSearchSystemPrompt` defaults to `SMART_SYSTEM_PROMPT` and overrides it when edited. The built-in prompt is flexible rather than fixed-section: it answers only the query using explicitly stated page facts, avoids inferred/assumed gap filling and unrelated neighboring sections, supports summaries, extraction/comparison, troubleshooting, config/API details, security/migration notes, and verbatim code/command/schema/error excerpts, preserves exact concrete fields, includes source quotes/context for important claims when useful without repeating the single fetched URL in every evidence bullet, uses `Not found on page` for absent requested info, and flags legal/admin calculators/forms/agencies when stated. If model context is unknown, fallback cap is about 60k estimated tokens. If input is truncated, the visible tool result includes a note with kept/original character counts. If the configured model is unavailable or lacks auth/text input, smart processing warns once and is disabled for the session.
- `constants.ts`: shared extension constants, currently the default request timeout.
- `image.ts`: exports standalone `imageImpl`; downloads direct image URLs without provider config/API keys. Supports PNG/JPEG/WebP/GIF, default 5 MB download cap, maximum 20 MB, optional timeout/maxBytes. Downloaded images are passed through Pi's `resizeImage()` before returning to the LLM; if decoding/resizing cannot fit inline limits, the image is omitted with a note. Metadata lives in `details`; Pi's generic image-content renderer displays the image block.
- `command.ts`: `/lovely-web` opens `ScopedConfigEditor` from `@xl0/pi-lovely-config` to configure providers, API keys, search/fetch disabled state (`disabled`), image settings, and smart search settings across user/workspace scopes. Active-tool changes are applied immediately through Pi `setActiveTools()`.
- `render.ts`: shared collapsed text result renderer for search/fetch. It renders plain text, applies render-only `findText` highlight markers as bold accent UI styling, and appends a muted expand hint when collapsed.

Tools:
- `web_search`: search dispatching to configured search provider with provider-specific schema. Common args are `query`, optional `limit`, and optional `fetchResult`; provider-specific args mirror useful API concepts (`source` for Firecrawl/Brave, `category` for Exa, `topic`/`includeImages` for Tavily). Tool call rendering shows the search query and supplied non-default args. Result rendering shows the first few output lines until expanded. `fetchResult` defaults to false; when true and `web_fetch` has a configured provider, the first result is fetched. Image searches first try direct image fetch/resizing and fall back to page markdown fetch only when the result URL is not image content and `web_fetch` is configured.
- `web_fetch`: fetch one URL as cleaned markdown dispatching to configured fetch provider. Common public options are `url`, optional `timeout`, optional `includeMetadata`, optional `findText` (array of strings), optional `findMode` (`fuzzy` default, `exact`, `lower`), and optional `smartQuery` when smart search is enabled; extra provider-specific options are Firecrawl `waitFor`, Exa `maxAgeHours`, and Tavily `extractDepth`. Tool call rendering shows the URL, `smart:"..."` and `find:<mode>:["..."]` when present, supplied non-default args, and post-completion smart model cost/tokens when available; if the call would overflow one line, smart and find render on separate lines below the URL line. Result rendering shows the first few output lines until expanded. `findText` returns globally deduped plain-text snippets with 500 characters of context; overlapping contexts across all queries are merged, each snippet lists matching queries/counts, UI rendering highlights hit ranges, and returned snippets are capped to about 20k raw characters total. `exact` is case-sensitive literal, `lower` is case-insensitive literal, and `fuzzy` scores normalized blank-line chunks by query-token coverage and typo-tolerant token matches. `smartQuery` processes fetched markdown plus optional metadata and URL for grounded summaries, extraction, troubleshooting, comparisons, and verbatim examples, without source numbering. Smart usage/cost lives in tool result `details.smart`. If smart processing fails with `findText`, the tool returns the smart error message plus `findText` results; without `findText`, it throws `Smart search failed: ...`.
- `web_image`: fetch a direct image URL and return a short text note plus one image content block, matching Pi `read` image behavior. Resizing is controlled by config (`webImageResize`, default true) and max longest side (`webImageMaxSize`, default 2000 px).

## Provider dispatch
`extensions/lovely-web/config.ts` owns provider registry/config helpers and exports `CONFIG_FILE_NAME` (`xl0-pi-lovely-web.json`). Config is defined via `@xl0/pi-lovely-config`, loaded from `~/.pi/agent/` user scope and `.pi/` workspace scope, with workspace overriding user. Search and fetch providers are flat settings: `webSearchProvider` defaults to `firecrawl`, `webFetchProvider` defaults to `disabled`; `disabled` removes the tool from Pi's active tool list and gates execution. `webImageEnabled` defaults to true; setting it to false removes `web_image`. `webImageResize` defaults true and `webImageMaxSize` defaults 2000. Smart post-processing config is `smartSearchEnabled` (default false), `smartSearchModel` (`provider/model`, exposed in `/lovely-web` as a searchable enum of authenticated Pi text models when available), `smartSearchMaxTokens` (default 2000), and `smartSearchSystemPrompt` (default `SMART_SYSTEM_PROMPT`). Invalid JSON throws a path-specific error; invalid known values become warnings and are ignored while resolving.

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
WebToolsConfig { webSearchProvider, webFetchProvider, webImageEnabled, webImageResize, webImageMaxSize, smartSearchEnabled, smartSearchModel, smartSearchMaxTokens, smartSearchSystemPrompt, firecrawlApiKey, exaApiKey, tavilyApiKey, braveApiKey }
```

## Shared HTTP (`providers/http.ts`)
`requestJson()` wraps provider HTTP requests with timeout, abort propagation, non-2xx error text, and JSON parsing.
`web_image` downloads with `fetch()`, validates HTTP status, supported image MIME type, response body, and byte cap while streaming; then uses Pi's exported image resize helper to enforce inline image limits. Tool content contains a short text note plus the resized image block (or decode/resize omission note), with URL/mime/bytes/contentLength/dimensions/originalDimensions/wasResized metadata in `details`.

## Formatting (`format.ts`)
Provider-agnostic: `formatSearchOutput(results: SearchResult[])` emits numbered results with concise `title`/`url`/`desc`/`markdown` fields, indents multiline description fields, leaves fetched markdown unindented to avoid token waste, and truncates non-fetched result descriptions at 300 chars; `stringify()`, `asErrorMessage()`.
