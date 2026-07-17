import { randomBytes } from "node:crypto"
import { open, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_TIMEOUT_MS } from "./constants.js"
import { saveTextContent } from "./output.js"

export const MAX_DOWNLOAD_BYTES = 100_000_000
const USER_AGENT = "Mozilla/5.0 (compatible; pi-lovely-web; +https://github.com/xl0/pi-lovely-web)"

export interface WebGetDetails {
	url: string
	finalUrl: string
	status: number
	statusText: string
	contentType: string
	charset?: string
	textual: boolean
	bytes: number
	contentLength?: number
	headers: Record<string, string>
	scriptsAndStylesStripped: boolean
	fullOutputPath?: string
}

function isTextContentType(contentType: string): boolean {
	return (
		contentType.startsWith("text/") ||
		/^application\/(?:[\w.+-]+\+)?(?:json|xml)(?:;|$)/i.test(contentType) ||
		/^application\/(?:javascript|x-javascript|ecmascript|xhtml\+xml)(?:;|$)/i.test(contentType)
	)
}

function stripScriptsAndStyles(html: string): string {
	return html.replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
}

function contentTypeCharset(contentType: string): string | undefined {
	const match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(contentType)
	return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim().toLowerCase()
}

function decodeText(body: Buffer, contentType: string, charset: string | undefined): string {
	if (charset) {
		let decoder: TextDecoder
		try {
			decoder = new TextDecoder(charset as ConstructorParameters<typeof TextDecoder>[0], { fatal: true })
		} catch {
			throw new Error(`Unsupported response charset: ${charset}`)
		}
		try {
			return decoder.decode(body)
		} catch {
			throw new Error(`Response body is not valid ${charset} text`)
		}
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(body)
	} catch {
		if (contentType === "text/html") return new TextDecoder("windows-1252").decode(body)
		throw new Error("Response body is not valid UTF-8 text")
	}
}

export async function webGetImpl(
	params: { url: string; timeout?: number; stripScriptsAndStyles?: boolean },
	signal?: AbortSignal
): Promise<{ text: string; details: WebGetDetails }> {
	const timeoutSignal = AbortSignal.timeout(params.timeout ?? DEFAULT_TIMEOUT_MS)
	const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
	const response = await fetch(params.url, { headers: { "user-agent": USER_AGENT }, redirect: "follow", signal: requestSignal })

	const contentTypeHeader = response.headers.get("content-type") ?? ""
	const contentType = contentTypeHeader.split(";")[0]?.trim().toLowerCase() ?? ""
	const charset = contentTypeCharset(contentTypeHeader)
	const contentLengthHeader = response.headers.get("content-length")
	const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined
	if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
		await response.body?.cancel()
		throw new Error(`Response too large: ${contentLength} bytes exceeds download limit of ${MAX_DOWNLOAD_BYTES}`)
	}

	const bodyKnownEmpty = response.status === 204 || response.status === 205 || contentLength === 0
	const textual = bodyKnownEmpty || Boolean(contentType && isTextContentType(contentType))
	let bytes = 0
	const chunks: Uint8Array[] = []
	let fullOutputPath: string | undefined
	let fullOutput: Awaited<ReturnType<typeof open>> | undefined
	try {
		if (!textual) {
			fullOutputPath = join(tmpdir(), `pi-web-get-${randomBytes(8).toString("hex")}.body`)
			fullOutput = await open(fullOutputPath, "wx", 0o600)
		}
		if (response.body && !bodyKnownEmpty) {
			const reader = response.body.getReader()
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				if (bytes + value.byteLength > MAX_DOWNLOAD_BYTES) {
					await reader.cancel()
					throw new Error(`Response too large: exceeded download limit of ${MAX_DOWNLOAD_BYTES} bytes`)
				}
				bytes += value.byteLength
				if (fullOutput) await fullOutput.writeFile(value)
				if (textual) chunks.push(value)
			}
		}
	} catch (error) {
		if (fullOutputPath) await unlink(fullOutputPath).catch(() => {})
		throw error
	} finally {
		await fullOutput?.close()
	}

	const details: WebGetDetails = {
		url: params.url,
		finalUrl: response.url,
		status: response.status,
		statusText: response.statusText,
		contentType,
		...(charset ? { charset } : {}),
		textual,
		bytes,
		...(contentLength !== undefined && Number.isFinite(contentLength) ? { contentLength } : {}),
		headers: Object.fromEntries(response.headers.entries()),
		scriptsAndStylesStripped: textual && contentType === "text/html" && params.stripScriptsAndStyles !== false,
		...(fullOutputPath ? { fullOutputPath } : {})
	}
	if (!textual) return { text: "", details }

	let text = bytes === 0 ? "" : decodeText(Buffer.concat(chunks), contentType, charset)
	if (text.slice(0, 8192).includes("\0")) {
		throw new Error("Binary response body is not supported.")
	}
	if (details.scriptsAndStylesStripped) text = stripScriptsAndStyles(text)
	fullOutputPath = await saveTextContent(text, "pi-web-get", "txt")
	details.fullOutputPath = fullOutputPath
	return { text, details }
}
