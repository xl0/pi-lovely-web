# Plan

## High-level decisions
- Package is `@xl0/pi-lovely-web`; keep it minimal and dependency-free at runtime.
- Keep `web_search`, `web_fetch`, `web_get`, and `web_image` tool names.
- Providers use plain REST via shared `fetch()` helpers, not provider SDKs.
- Search provider defaults to Firecrawl; fetch has no default and is disabled until configured.
- Provider config uses `@xl0/pi-lovely-config` in exported `CONFIG_FILE_NAME` (`xl0-pi-lovely-web.json`) under user `~/.pi/agent/` and workspace `.pi/`; workspace config overrides user.
- Old `xl0-web-tools.json` nested configs migrate to flat `xl0-pi-lovely-web.json` on load, then delete the old file.
- API key resolution: flat `<provider>ApiKey` setting → provider env var → explicit error.
- `/lovely-web` applies tool active-state changes immediately with `setActiveTools()`.
- `web_image` is URL-only and uses Pi image resizing; it does not require provider config/API keys. Preserve original downloaded image bytes privately and include the path in output.
- Raw fetched output defaults to 50 KB with byte/line counts; complete source is always saved privately. `findText` searches complete fetched text up to hard provider/download limits.
- `web_get` is provider-free direct HTTP GET with MIME/text checks, a 100 MB hard cap, decoded/stripped textual temp files, unprocessed non-text files, normal-result HTTP error bodies, and path-only non-text responses.
- `smartQuery` is disabled-by-default, non-agentic post-processing on `web_fetch` and `web_get`. It defaults to 75% of selected model context while reserving prompt/output/safety space; complete source is saved when enabled. Transient failures retry up to three times at fixed one-second intervals. Config/UI terminology is “smart query”; old `smartSearch*` settings migrate.
- Publishing is CI-driven: `bun run release` rolls the human-written `CHANGELOG.md [Unreleased]` section, bumps, tags, and pushes; the tag triggers npm staging plus a GitHub Release. Same flow as pi-lovely-codex.

## Architecture
- `extensions/lovely-web/index.ts` wires session config, tools, and command registration.
- `config.ts` owns provider registry, `@xl0/pi-lovely-config` schema/loading/migration, enabled-state checks, API-key/provider resolution.
- `constants.ts` owns shared constants such as the default timeout.
- `tools.ts` owns tool schemas, render hooks, and execution wrappers.
- `command.ts` owns the `ScopedConfigEditor` settings command.
- `get.ts` owns direct textual HTTP GET handling.
- `output.ts` owns shared raw-output limiting, line/byte stats, and text temp files.
- `image.ts` owns direct image download/resize handling.
- `providers/` contains one provider adapter per external API plus shared HTTP/types.

## Provider decisions
- Firecrawl supports search/fetch and exposes fetch `waitFor`.
- Exa supports search/fetch and exposes fetch `maxAgeHours`.
- Tavily supports search/fetch and exposes fetch `extractDepth`.
- Brave Search supports search only.
- Search/fetch schemas expose provider-specific API concepts directly where useful, but keep fetch extras sparse to avoid context pollution.

## Next useful work
- [ ] Refactor `command.ts` UI item construction after behavior stabilizes.
- [ ] Add cheap deterministic direct tests for config/provider resolution and formatting.
- [x] Keep live-provider integration test sessions under ignored `test/sessions/<run-id>/` and print each session file.
- [ ] Keep live-provider integration tests as smoke coverage, not exact content tests.
