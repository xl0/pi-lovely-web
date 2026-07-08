# pi-lovely-web

Lovely Pi extension for accessing the web.

## Supply chain

This extension uses plain REST API - not the provider-specific packages.
We add zero dependencies, minimizing the supply chain attack surface.

## Install

```bash
pi install npm:@xl0/pi-lovely-web
```

## Tools

- `web_search` - Compact search results. Set `fetchResult:true` to include markdown from the first result when `web_fetch` is configured.

The plain-text tool output looks like this:

> `web_search "pi coding agent harness earendil" (web, limit 5)`

```
1.
   title: GitHub - earendil-works/pi: AI agent toolkit
   url: https://github.com/earendil-works/pi
   desc: Pi is an AI agent toolkit for coding: CLI, unified LLM API, TUI/Web UI libraries, Slack bot, and vLLM pods.

2.
   title: packages/coding-agent/README.md at main · earendil-works/pi
   url: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md
   desc: The page describes the pi project from earendil-works, a minimal, extensible terminal coding harness designed to adapt to your workflow.

3.
   title: Pi Coding Agent
   url: https://pi.dev/
   desc: Pi Coding Agent is a minimal, highly customizable terminal coding harness.
```

- `web_fetch` - The single web page in markdown format. Set `findText` to an array of strings to return snippets from the fetched markdown. Optional `findMode` is `fuzzy` (default, normalized chunk match), `exact` (case-sensitive literal), or `lower` (case-insensitive literal). When smart search is enabled, set `smartQuery` to have a Pi text model answer/extract from the fetched markdown; `findText` and `smartQuery` can be combined.
- `web_image` - The single image, returned as media content. Respects the Pi image resizing settings:

![web_image](https://raw.githubusercontent.com/xl0/pi-lovely-web/master/assets/web_image.png)


## Configuration

Run `/lovely-web` in Pi to configure providers interactively:

![settings](https://raw.githubusercontent.com/xl0/pi-lovely-web/master/assets/settings.png)

The settings are stored in `~/.pi/agent/xl0-pi-lovely-web.json` (global) or `.pi/xl0-pi-lovely-web.json` (project):

```json
{
  "webSearchProvider": "firecrawl",
  "webFetchProvider": "firecrawl",
  "webImageEnabled": true,
  "smartSearchEnabled": false,
  "smartSearchModel": "anthropic/claude-sonnet-4-5",
  "smartSearchMaxTokens": 2000,
  "smartSearchSystemPrompt": "Process one web_fetch result for a coding agent.\nUse only facts explicitly stated in the provided page text.\n...",
  "firecrawlApiKey": "fc-...",
  "exaApiKey": "...",
  "tavilyApiKey": "...",
  "braveApiKey": "..."
}
```

API keys can also be set via environment variables: `FIRECRAWL_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `BRAVE_API_KEY`.

Search defaults to Firecrawl. Fetch defaults to `disabled`; configure `webFetchProvider` to enable `web_fetch` and `fetchResult:true` first-result fetches from `web_search`. Set `webSearchProvider` or `webFetchProvider` to `disabled` to remove that tool from Pi's active tool list. Set `webImageEnabled:false` to disable `web_image`.

`web_fetch` also supports `findText`, an array of strings to search over fetched markdown. It returns deduped plain-text snippets with 500 characters of context; overlapping contexts are merged, each snippet lists matching queries and counts, UI rendering highlights hits, and returned snippets are capped to about 20k raw characters total. `findMode` defaults to `fuzzy`; `exact` preserves case, `lower` is case-insensitive literal, and `fuzzy` splits text on blank lines, normalizes accents/case/punctuation, scores chunks by query-token coverage plus typo-tolerant token matches, and highlights matched source tokens in the UI.

When `smartSearchEnabled` is true, `smartQuery` post-processes `web_fetch` output with a Pi text model. It supports grounded summaries, extraction, comparisons, troubleshooting, limits/config/API details, security/migration notes, and verbatim code/command/schema examples. The prompt adapts the output format to the query, uses only explicitly stated page facts, preserves exact concrete fields, quotes/source-contexts important claims when useful without repeating the single fetched URL in every evidence bullet, and says `Not found on page.` for absent requested info. `/lovely-web` populates `smartSearchModel` from authenticated Pi text models and defaults to the current model when unset; invalid stored values warn and fall back to the default. `smartSearchSystemPrompt` defaults to the built-in prompt and can be edited. `findText` and `smartQuery` are independent: both read the raw fetched markdown and their outputs are concatenated.

Smart input is limited to half the selected model context estimate. If model context is unknown, the fallback limit is about 60k estimated tokens. If input is trimmed, the tool result includes a visible note with kept/original character counts.

Old `xl0-web-tools.json` configs are migrated to `xl0-pi-lovely-web.json` on load, then deleted.

`web_search` and `web_fetch` parameters are provider-specific and update dynamically when you change providers. Changing providers changes the tool schema and potentially may confuse the model if you change the schema mid-session, but unlikely with modern LLMs.

Search params:

| Provider | Extra `web_search` params |
|----------|---------------------------|
| Firecrawl | `source` selects web/news/images; `category` filters to github/research/pdf; `location`/`country` localize; `tbs` applies Google-style time filters. |
| Exa | `category` narrows Exa's result type; `country` localizes. |
| Tavily | `topic` selects general/news/finance; `includeImages` returns image URLs; `country` localizes; `timeRange` limits recency. |
| Brave Search | `source` selects web/news/images; `country` localizes; `searchLang` sets language; `freshness` limits recency. |

Fetch params:

| Provider | Extra `web_fetch` params |
|----------|--------------------------|
| Firecrawl | `waitFor` waits before scraping, in ms. |
| Exa | `maxAgeHours` allows cached page content up to that age. |
| Tavily | `extractDepth` selects basic or advanced extraction. |


`web_image` fetches a direct image URL without provider config/API keys and returns a short text note plus image content to vision-capable models, matching Pi's `read` image behavior. Supported MIME types: PNG, JPEG, WebP, GIF. Defaults to a 5 MB download cap and resizes through Pi's inline image helper before returning content.

## Providers

| Provider      | Search | Fetch | Auth |
|---------------|--------|-------|------|
| Firecrawl     | ✓      | ✓     | `Authorization: Bearer` |
| Exa           | ✓      | ✓     | `x-api-key` |
| Tavily        | ✓      | ✓     | `Authorization: Bearer` |
| Brave Search  | ✓      | -     | `X-Subscription-Token` |

## Related projects

|  |  |
| --- | --- |
| [Pi Lovely Dev Tools](https://github.com/xl0/pi-lovely-dev-tools) | interactive debugging helpers `/tool` `/show-sysprompt` |
| [Pi Lovely Codex](https://github.com/xl0/pi-lovely-codex) | GPT fast mode and Codex-style `apply_patch` |
| [Pi Lovely IDE](https://github.com/xl0/pi-lovely-ide) | IDE integration |
| [Pi Lovely Config](https://github.com/xl0/pi-lovely-config) | scoped config helpers for Pi extensions |
| [Pi Lovely Comment](https://github.com/xl0/agent-files/tree/master/pi/packages/pi-lovely-comment) | open the last assistant message in your editor and sync edits back into the prompt |
| [Pi Lovely Rename](https://github.com/xl0/agent-files/tree/master/pi/packages/pi-lovely-rename) | automatic and manual session naming |
---

Like this work? [Hire me](https://alexey.work/cv?ref=pi-lovely-web)
