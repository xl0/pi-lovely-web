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

- `web_fetch` - The single web page in markdown format
- `web_image` - The single image, returned as media content. Respects the Pi image resizing settings:

![web_image](https://raw.githubusercontent.com/xl0/pi-lovely-web/master/assets/web_image.png)


## Configuration

Run `/lovely-web` in Pi to configure providers interactively:

![settings](https://raw.githubusercontent.com/xl0/pi-lovely-web/master/assets/settings.png)

The settings are stored in `~/.pi/agent/xl0-pi-lovely-web.json` (global) or `.pi/xl0-pi-lovely-web.json` (project):

```json
{
  "webSearch": { "provider": "firecrawl" },
  "webFetch":  { "provider": "firecrawl" },
  "webImage":  { "enabled": true },
  "webApiKeys": {
    "firecrawl": "fc-...",
    "exa": "...",
    "tavily": "...",
    "brave": "..."
  }
}
```

API keys can also be set via environment variables: `FIRECRAWL_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `BRAVE_API_KEY`.

Search defaults to Firecrawl. Fetch has no default; configure `webFetch.provider` to enable `web_fetch` and `fetchResult:true` first-result fetches from `web_search`. Set `provider:null` on `webSearch` or `webFetch` to remove that tool from Pi's active tool list. Set `webImage.enabled:false` to disable `web_image`.

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
| [Pi Lovely IDE](https://github.com/xl0/pi-lovely-ide) | IDE integration |

---

Like this work? [Hire me](https://alexey.work/cv?ref=pi-lovely-web)
