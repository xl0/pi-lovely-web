import type { Theme } from "@earendil-works/pi-coding-agent"
import { Text } from "@earendil-works/pi-tui"
import { FIND_HIGHLIGHT_END, FIND_HIGHLIGHT_START } from "./find.js"

const COLLAPSED_RESULT_LINES = 6

export function renderTextResult(
	result: { content: Array<{ type: string; text?: string }>; details?: unknown },
	expanded: boolean,
	theme: Theme,
	partialLabel: string
) {
	const content = result.content[0]
	if (content?.type !== "text" || content.text === undefined) return new Text(theme.fg("error", "No text output"), 0, 0)
	if (!content.text.trim()) return new Text(theme.fg("dim", partialLabel), 0, 0)

	const renderText = renderTextOverride(result.details) ?? content.text
	const lines = renderText.split("\n")
	const shown = expanded ? lines : lines.slice(0, COLLAPSED_RESULT_LINES)
	let text = shown.map(line => renderHighlightMarkers(line, theme)).join("\n")
	if (!expanded && lines.length > COLLAPSED_RESULT_LINES) {
		text += `\n${theme.fg("muted", `... ${lines.length - COLLAPSED_RESULT_LINES} more lines (ctrl-o to expand)`)}`
	}
	return new Text(text, 0, 0)
}

function renderTextOverride(details: unknown): string | undefined {
	if (!details || typeof details !== "object") return undefined
	const renderText = (details as { renderText?: unknown }).renderText
	return typeof renderText === "string" ? renderText : undefined
}

function renderHighlightMarkers(line: string, theme: Theme): string {
	let rest = line
	let output = ""
	while (true) {
		const start = rest.indexOf(FIND_HIGHLIGHT_START)
		if (start === -1) return output + theme.fg("toolOutput", stripHighlightMarkers(rest))
		const end = rest.indexOf(FIND_HIGHLIGHT_END, start + FIND_HIGHLIGHT_START.length)
		if (end === -1) return output + theme.fg("toolOutput", stripHighlightMarkers(rest))
		output += theme.fg("toolOutput", rest.slice(0, start))
		output += theme.bold(theme.fg("accent", rest.slice(start + FIND_HIGHLIGHT_START.length, end)))
		rest = rest.slice(end + FIND_HIGHLIGHT_END.length)
	}
}

function stripHighlightMarkers(text: string): string {
	return text.replaceAll(FIND_HIGHLIGHT_START, "").replaceAll(FIND_HIGHLIGHT_END, "")
}
