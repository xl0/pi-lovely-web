# Plan

## High-level decisions
- Package is `@xl0/pi-lovely-web`; keep it minimal and dependency-free at runtime.
- Keep `web_search`, `web_fetch`, and `web_image` tool names.
- Providers use plain REST via shared `fetch()` helpers, not provider SDKs.
- Search provider defaults to Firecrawl; fetch has no default and is disabled until configured.
- Provider config uses `@xl0/pi-lovely-config` in exported `CONFIG_FILE_NAME` (`xl0-pi-lovely-web.json`) under user `~/.pi/agent/` and workspace `.pi/`; workspace config overrides user.
- Old `xl0-web-tools.json` nested configs migrate to flat `xl0-pi-lovely-web.json` on load, then delete the old file.
- API key resolution: flat `<provider>ApiKey` setting → provider env var → explicit error.
- `/lovely-web` applies tool active-state changes immediately with `setActiveTools()`.
- `web_image` is URL-only and uses Pi image resizing; it does not require provider config/API keys.
- `smartQuery` is a disabled-by-default post-processing mode on `web_fetch`, not a separate tool. It uses Pi model registry/auth; `/lovely-web` configures its model from authenticated Pi text models and defaults to the current model when unset. `smartSearchSystemPrompt` defaults to the built-in smart prompt and can be edited. `web_fetch.findText` is deterministic snippet search over fetched markdown with default `fuzzy` mode plus `exact`/`lower` modes.

## Architecture
- `extensions/lovely-web/index.ts` wires session config, tools, and command registration.
- `config.ts` owns provider registry, `@xl0/pi-lovely-config` schema/loading/migration, enabled-state checks, API-key/provider resolution.
- `constants.ts` owns shared constants such as the default timeout.
- `tools.ts` owns tool schemas, render hooks, and execution wrappers.
- `command.ts` owns the `ScopedConfigEditor` settings command.
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
