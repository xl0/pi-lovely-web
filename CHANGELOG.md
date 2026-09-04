# Changelog

## [Unreleased]

### Fixed

- Smart query streams through the owning registry provider's `streamSimple()` instead of the global compat `completeSimple()`, fixing `No API provider registered` for extension-registered models (e.g. pi-model-auto-router). The credential-derived `baseUrl` is applied to the request model.

### Changed

- Pi dev/peer dependency floor raised to 0.84 (`getApiKeyAndHeaders` reports `baseUrl` since then).

## [0.3.1] - 2026-07-22

### Added

- Transient smart-query failures retry up to three times at fixed one-second intervals, with tool progress for each retry.

## [0.3.0] - 2026-07-16

### Added

- `web_get`: provider-free direct HTTP GET with MIME/text checks, a 100 MB hard cap, decoded/stripped textual temp files, and unprocessed non-text files.
- Complete fetched output is always saved privately; raw output is capped with byte/line counts, and `findText`/`smartQuery` operate on the complete text.

## [0.2.2] - 2026-07-07

### Added

- `findText` and `smartQuery` processing options on fetched results, with configurable smart model, token budget, input share, and system prompt.

### Fixed

- `findText` lower-mode snippet offsets and fuzzy token matching.
- Failed tool calls throw instead of returning silent results.
