import { randomBytes } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const DEFAULT_RAW_OUTPUT_MAX_BYTES = 50_000
export const MAX_RAW_OUTPUT_MAX_BYTES = 100_000_000

export interface TextOutput {
	text: string
	bytes: number
	outputBytes: number
	lines: number
	outputLines: number
	truncated: boolean
}

export function countLines(text: string): number {
	if (!text) return 0
	let lines = text.endsWith("\n") ? 0 : 1
	for (const char of text) if (char === "\n") lines++
	return lines
}

export function limitTextOutput(text: string, maxBytes: number): TextOutput {
	const body = Buffer.from(text)
	const lines = countLines(text)
	if (maxBytes === 0 || body.byteLength <= maxBytes) {
		return { text, bytes: body.byteLength, outputBytes: body.byteLength, lines, outputLines: lines, truncated: false }
	}

	let end = Math.min(maxBytes, body.byteLength)
	let prefix = ""
	while (end > 0) {
		try {
			prefix = new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(0, end))
			break
		} catch {
			end--
		}
	}
	const lastNewline = prefix.lastIndexOf("\n")
	if (lastNewline + 1 >= maxBytes / 2) prefix = prefix.slice(0, lastNewline + 1)
	const outputBytes = Buffer.byteLength(prefix)
	return {
		text: prefix,
		bytes: body.byteLength,
		outputBytes,
		lines,
		outputLines: countLines(prefix) || 1,
		truncated: true
	}
}

export async function saveTextContent(text: string, prefix = "pi-web-fetch", extension = "md"): Promise<string> {
	const path = join(tmpdir(), `${prefix}-${randomBytes(8).toString("hex")}.${extension}`)
	await writeFile(path, text, { encoding: "utf8", flag: "wx", mode: 0o600 })
	return path
}

export function truncationNotice(output: TextOutput, path?: string, label = "content"): string {
	const saved = path ? ` Full ${label}: ${path}` : ""
	return `[Showing lines 1-${output.outputLines} of ${output.lines}; ${output.outputBytes}/${output.bytes} bytes.${saved}]`
}

export function savedContentNotice(path: string, output: Pick<TextOutput, "bytes" | "lines">, label = "Fetched content"): string {
	return `[${label}: ${path} (${output.bytes} bytes, ${output.lines} lines)]`
}
