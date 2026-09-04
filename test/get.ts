import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fauxAssistantMessage, fauxProvider, type SimpleStreamOptions } from "@earendil-works/pi-ai"
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { CONFIG_FILE_NAME, loadScopedConfig, lovelyWebConfigSpec } from "../extensions/lovely-web/config.js"
import { MAX_DOWNLOAD_BYTES, webGetImpl } from "../extensions/lovely-web/get.js"
import { limitTextOutput } from "../extensions/lovely-web/output.js"
import { smartProcess, smartQueryInputCharLimit } from "../extensions/lovely-web/smart.js"
import { registerLovelyWebStaticTools } from "../extensions/lovely-web/tools.js"

interface ExecutableTool {
	name: string
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: { cwd: string; modelRegistry: { getAvailable(): never[] } }
	): Promise<AgentToolResult<unknown>>
}

async function withFetch<T>(response: () => Response, run: () => Promise<T>): Promise<T> {
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () => response()) as unknown as typeof fetch
	try {
		return await run()
	} finally {
		globalThis.fetch = originalFetch
	}
}

function resultText(result: AgentToolResult<unknown>): string {
	return result.content.find(block => block.type === "text")?.text ?? ""
}

const unicodeOutput = limitTextOutput("ééé", 5)
assert.equal(unicodeOutput.text, "éé")
assert.equal(unicodeOutput.outputBytes, 4)
assert.equal(unicodeOutput.truncated, true)
const lineOutput = limitTextOutput("one\ntwo\nthree", 9)
assert.equal(lineOutput.text, "one\ntwo\n")
assert.equal(lineOutput.outputLines, 2)
assert.equal(lineOutput.lines, 3)
assert.equal(lovelyWebConfigSpec.defaults.rawOutputMaxBytes, 50_000)
assert.equal(smartQueryInputCharLimit(lovelyWebConfigSpec.defaults, { contextWindow: 100_000 }, 0), 225_000)

let webGetTool: ExecutableTool | undefined
let webFetchTool: ExecutableTool | undefined
registerLovelyWebStaticTools(
	{
		registerTool(tool: unknown) {
			if (typeof tool === "object" && tool && "name" in tool && tool.name === "web_get") webGetTool = tool as ExecutableTool
			if (typeof tool === "object" && tool && "name" in tool && tool.name === "web_fetch") webFetchTool = tool as ExecutableTool
		}
	} as unknown as ExtensionAPI,
	lovelyWebConfigSpec.defaults
)
assert(webGetTool)
assert(webFetchTool)
const getTool = webGetTool
const fetchTool = webFetchTool
const testCwd = await mkdtemp(join(tmpdir(), "pi-lovely-web-test-"))
await mkdir(join(testCwd, ".pi"))
const faux = fauxProvider()
const smartOptions: SimpleStreamOptions[] = []
const smartRetryUpdates: string[] = []
faux.setResponses([
	(_context, options) => {
		smartOptions.push(options ?? {})
		return fauxAssistantMessage("", { stopReason: "error", errorMessage: "503 service unavailable" })
	},
	(_context, options) => {
		smartOptions.push(options ?? {})
		return fauxAssistantMessage("recovered")
	}
])
const smartResult = await smartProcess(
	{ ...lovelyWebConfigSpec.defaults, smartQueryEnabled: true },
	{
		cwd: testCwd,
		model: faux.getModel(),
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test" }),
			getProvider: () => faux.provider
		},
		isProjectTrusted: () => true,
		ui: { notify() {} }
	} as unknown as Parameters<typeof smartProcess>[1],
	{ query: "summarize", resultText: "source" },
	undefined,
	message => smartRetryUpdates.push(message)
)
assert.equal(smartResult?.text, "recovered")
assert.equal(smartResult?.details.retries, 1)
assert.equal(smartOptions.length, 2)
assert.deepEqual(smartRetryUpdates, ["Smart query retry 1/3 in 1s: 503 service unavailable"])
await writeFile(
	join(testCwd, ".pi", CONFIG_FILE_NAME),
	JSON.stringify({
		webFetchProvider: "firecrawl",
		firecrawlApiKey: "test",
		rawOutputMaxBytes: 50_000,
		smartQueryEnabled: false
	})
)
const ctx = { cwd: testCwd, model: undefined, modelRegistry: { getAvailable: () => [] as never[] } }

await withFetch(
	() => new Response("ok", { headers: { "Content-Type": "Text/Plain" } }),
	async () => {
		const result = await webGetImpl({ url: "https://example.com/uppercase-mime" })
		assert.equal(result.text, "ok")
		assert.equal(result.details.contentType, "text/plain")
		assert.equal(result.details.textual, true)
		assert(result.details.fullOutputPath)
		await unlink(result.details.fullOutputPath)
	}
)

await withFetch(
	() => new Response(Uint8Array.of(0xe9), { headers: { "Content-Type": "text/plain; charset=windows-1252" } }),
	async () => {
		const result = await webGetImpl({ url: "https://example.com/legacy-text" })
		assert.equal(result.text, "é")
		assert.equal(result.details.charset, "windows-1252")
		assert(result.details.fullOutputPath)
		assert.deepEqual(await readFile(result.details.fullOutputPath), Buffer.from("é", "utf8"))
		await unlink(result.details.fullOutputPath)
	}
)

await withFetch(
	() => new Response(Buffer.from("hello", "utf16le"), { headers: { "Content-Type": "text/plain; charset=utf-16le" } }),
	async () => {
		const result = await webGetImpl({ url: "https://example.com/utf16-text" })
		assert.equal(result.text, "hello")
		assert(result.details.fullOutputPath)
		await unlink(result.details.fullOutputPath)
	}
)

await withFetch(
	() => new Response(`<script>${"x".repeat(50)}</script><p>kept</p>`, { headers: { "Content-Type": "text/html" } }),
	async () => {
		const result = await webGetImpl({ url: "https://example.com/html" })
		assert.equal(result.text, "<p>kept</p>")
		assert.equal(result.details.scriptsAndStylesStripped, true)
		assert(result.details.fullOutputPath)
		assert.equal(await readFile(result.details.fullOutputPath, "utf8"), "<p>kept</p>")
		await unlink(result.details.fullOutputPath)
	}
)

await withFetch(
	() =>
		new Response("too large", {
			headers: { "Content-Type": "text/plain", "Content-Length": String(MAX_DOWNLOAD_BYTES + 1) }
		}),
	async () => {
		await assert.rejects(webGetImpl({ url: "https://example.com/too-large" }), new RegExp(`download limit of ${MAX_DOWNLOAD_BYTES}`))
	}
)

await withFetch(
	() => new Response(null, { status: 204, headers: { "Content-Type": "application/pdf" } }),
	async () => {
		const result = await webGetImpl({ url: "https://example.com/no-content" })
		assert.equal(result.text, "")
		assert.equal(result.details.status, 204)
		assert.equal(result.details.textual, true)
		assert(result.details.fullOutputPath)
		assert.equal((await stat(result.details.fullOutputPath)).size, 0)
		await unlink(result.details.fullOutputPath)
	}
)

await withFetch(
	() => new Response("abcdefghij", { headers: { "Content-Type": "text/plain" } }),
	async () => {
		const result = await getTool.execute("test", { url: "https://example.com/small" }, undefined, undefined, ctx)
		const text = resultText(result)
		assert.match(text, /^abcdefghij/)
		assert.match(text, /Fetched response: \/tmp\/pi-web-get-/)
		const path = (result.details as { get: { fullOutputPath?: string } }).get.fullOutputPath
		assert(path)
		assert.equal(await readFile(path, "utf8"), "abcdefghij")
		await unlink(path)
	}
)

await withFetch(
	() => new Response(`${"x".repeat(60_000)}\nneedle`, { headers: { "Content-Type": "text/plain" } }),
	async () => {
		const result = await getTool.execute(
			"test",
			{ url: "https://example.com/find-full", findText: ["needle"], findMode: "exact" },
			undefined,
			undefined,
			ctx
		)
		assert.match(resultText(result), /needle/)
		assert.match(resultText(result), /Fetched response: \/tmp\/pi-web-get-/)
		const path = (result.details as { get: { fullOutputPath?: string } }).get.fullOutputPath
		assert(path)
		assert.equal((await stat(path)).mode & 0o777, 0o600)
		await unlink(path)
	}
)

await withFetch(
	() => new Response("error body", { status: 404, statusText: "Not Found", headers: { "Content-Type": "text/plain" } }),
	async () => {
		const result = await getTool.execute("test", { url: "https://example.com/missing" }, undefined, undefined, ctx)
		const text = resultText(result)
		assert.match(text, /^\[HTTP 404 Not Found\]\n\nerror body/)
		assert.match(text, /Fetched response: \/tmp\/pi-web-get-/)
		const path = (result.details as { get: { fullOutputPath?: string } }).get.fullOutputPath
		assert(path)
		await unlink(path)
	}
)

await withFetch(
	() => new Response(Uint8Array.of(0, 1, 2), { status: 404, headers: { "Content-Type": "application/octet-stream" } }),
	async () => {
		const result = await getTool.execute("test", { url: "https://example.com/binary" }, undefined, undefined, ctx)
		assert.match(resultText(result), /^\[HTTP 404\]/)
		assert.match(resultText(result), /Non-text response body omitted/)
		const path = (result.details as { get: { fullOutputPath?: string } }).get.fullOutputPath
		assert(path)
		assert.deepEqual(await readFile(path), Buffer.from([0, 1, 2]))
		await unlink(path)
	}
)

await withFetch(
	() => Response.json({ success: true, data: { markdown: "abcdefghij" } }),
	async () => {
		const result = await fetchTool.execute("test", { url: "https://example.com/page" }, undefined, undefined, ctx)
		assert.match(resultText(result), /^abcdefghij/)
		assert.match(resultText(result), /Fetched content: \/tmp\/pi-web-fetch-/)
		const path = (result.details as { source: { path?: string } }).source.path
		assert(path)
		assert.equal(await readFile(path, "utf8"), "abcdefghij")
		await unlink(path)
	}
)

await withFetch(
	() => Response.json({ success: true, data: { markdown: "x".repeat(60_000) } }),
	async () => {
		const result = await fetchTool.execute("test", { url: "https://example.com/default-limit" }, undefined, undefined, ctx)
		const text = resultText(result)
		assert.equal(text.slice(0, 50_000), "x".repeat(50_000))
		assert.match(text, /Showing lines 1-1 of 1; 50000\/60000 bytes/)
		assert(Buffer.byteLength(text) < 50_500)
		const path = (result.details as { source: { path?: string } }).source.path
		assert(path)
		assert.equal((await stat(path)).size, 60_000)
		await unlink(path)
	}
)

await withFetch(
	() => Response.json({ success: true, data: { markdown: `${"x".repeat(60_000)}\nneedle` } }),
	async () => {
		const result = await fetchTool.execute(
			"test",
			{ url: "https://example.com/page", findText: ["needle"], findMode: "exact" },
			undefined,
			undefined,
			ctx
		)
		assert.match(resultText(result), /needle/)
		assert.match(resultText(result), /Fetched content: \/tmp\/pi-web-fetch-/)
		const path = (result.details as { source: { path?: string } }).source.path
		assert(path)
		await unlink(path)
	}
)

await writeFile(
	join(testCwd, ".pi", CONFIG_FILE_NAME),
	JSON.stringify({ smartSearchEnabled: true, smartSearchModel: "provider/model", smartSearchMaxTokens: 1234 })
)
const migrated = loadScopedConfig(testCwd, ctx as unknown as NonNullable<Parameters<typeof loadScopedConfig>[1]>)
assert.equal(migrated.value.smartQueryEnabled, true)
assert.equal(migrated.value.smartQueryModel, "provider/model")
assert.equal(migrated.value.smartQueryMaxTokens, 1234)
const migratedFile = JSON.parse(await readFile(join(testCwd, ".pi", CONFIG_FILE_NAME), "utf8")) as Record<string, unknown>
assert.equal(migratedFile["smartSearchEnabled"], undefined)
assert.equal(migratedFile["smartQueryEnabled"], true)

await rm(testCwd, { recursive: true, force: true })

console.log("web output tests passed")
