import { StringEnum } from "@earendil-works/pi-ai"
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { type Component, Text, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui"
import { type TSchema, Type } from "typebox"
import {
	DEFAULT_PROVIDER_ID,
	getImageMaxSize,
	getProvider,
	isFetchEnabled,
	isImageEnabled,
	isImageResizeEnabled,
	loadConfig,
	lovelyWebConfigSpec,
	providers,
	resolveApiKey,
	type WebToolsConfig
} from "./config.js"
import { DEFAULT_TIMEOUT_MS } from "./constants.js"
import { type FindMode, formatFindTextMatches } from "./find.js"
import { asErrorMessage, formatSearchOutput, stringify } from "./format.js"
import { DEFAULT_MAX_IMAGE_BYTES, imageImpl, MAX_IMAGE_BYTES } from "./image.js"
import type { FetchOptions, SearchOptions } from "./providers/types.js"
import { renderTextResult } from "./render.js"
import { smartProcess } from "./smart.js"

interface SearchToolArgs {
	query: string
	limit?: number
	source?: string
	fetchResult?: boolean
	category?: string
	location?: string
	country?: string
	tbs?: string
	timeRange?: string
	topic?: string
	includeImages?: boolean
	searchLang?: string
	freshness?: string
}

interface FetchToolArgs extends FetchOptions {
	url: string
	includeMetadata?: boolean
	smartQuery?: string
	findText?: string[]
	findMode?: FindMode
}

interface WebFetchRenderState {
	smartCost?: string
	smartCostInvalidated?: boolean
}

class WebFetchCallComponent implements Component {
	constructor(
		private readonly oneLine: string,
		private readonly splitLines: string[]
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		return visibleWidth(this.oneLine) <= width ? [this.oneLine] : this.splitLines.flatMap(line => wrapTextWithAnsi(line, width))
	}
}

async function fetchSearchResultImage(config: WebToolsConfig, url: string, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
	return imageImpl(
		{
			url,
			timeout: DEFAULT_TIMEOUT_MS,
			resize: isImageResizeEnabled(config),
			maxSize: getImageMaxSize(config)
		},
		signal
	)
}

async function fetchSearchResultMarkdown(config: WebToolsConfig, url: string, signal?: AbortSignal): Promise<string> {
	const fetchProvider = getProvider("fetch", config)
	const fetchApiKey = resolveApiKey(fetchProvider, config)
	const fetched = await fetchProvider.fetch(fetchApiKey, url, { timeout: DEFAULT_TIMEOUT_MS }, signal)
	return fetched.markdown
}

function getSearchParameters(config: WebToolsConfig) {
	const configured = config.webSearchProvider
	const providerId = configured && providers[configured] ? configured : DEFAULT_PROVIDER_ID
	const params: Record<string, TSchema> = {
		query: Type.String({ description: "The search query." }),
		limit: Type.Optional(
			Type.Integer({
				description: "Maximum number of results to return. Defaults to 5.",
				minimum: 1,
				maximum: 20
			})
		),
		fetchResult: Type.Optional(
			Type.Boolean({
				description: "Whether to fetch the first result. Defaults to false; image searches fetch image content when enabled."
			})
		)
	}

	Object.assign(params, providers[providerId]?.searchParameters)
	return Type.Object(params)
}

function getFetchParameters(config: WebToolsConfig) {
	const configured = config.webFetchProvider
	const providerId = configured && providers[configured]?.fetch ? configured : "firecrawl"
	const params: Record<string, TSchema> & { smartQuery?: TSchema } = {
		url: Type.String({ description: "The URL to fetch.", format: "uri" }),
		timeout: Type.Optional(Type.Integer({ description: "Request timeout in milliseconds. Defaults to 30000.", minimum: 1 })),
		includeMetadata: Type.Optional(
			Type.Boolean({
				description: "Append verbose page metadata to the markdown output. Defaults to false. Full metadata is always available in details."
			})
		),
		findText: Type.Optional(
			Type.Array(Type.String(), {
				description: "Text strings to find in fetched markdown. Returns merged verification snippets."
			})
		),
		findMode: Type.Optional(
			StringEnum(["exact", "lower", "fuzzy"], {
				description:
					"Find mode. fuzzy matches normalized paragraph chunks (default); exact is case-sensitive literal; lower is case-insensitive literal."
			})
		)
	}

	if (config.smartSearchEnabled) {
		params.smartQuery = Type.Optional(
			Type.String({
				description:
					"Fast and intelligent model processes fetched markdown, produces grounded result. Questions, extraction, summarization, troubleshooting, or any other task you can do on a page. Give commanders intent (do what and why). Can be combined with findText; both run independently over the fetched text."
			})
		)
	}

	Object.assign(params, providers[providerId]?.fetchParameters)
	return Type.Object(params)
}

function formatUsd(amount: number): string {
	if (amount === 0) return "$0"
	if (amount < 0.0001) return "<$0.0001"
	if (amount < 0.01) return `$${amount.toFixed(4)}`
	return `$${amount.toFixed(3)}`
}

function smartCostLabel(details: unknown): string | undefined {
	if (!details || typeof details !== "object") return undefined
	const smart = (details as { smart?: unknown }).smart
	if (!smart || typeof smart !== "object") return undefined
	const usage = (smart as { usage?: unknown }).usage
	if (!usage || typeof usage !== "object") return undefined
	const cost = (usage as { cost?: unknown }).cost
	if (cost && typeof cost === "object") {
		const total = (cost as { total?: unknown }).total
		if (typeof total === "number") return `cost:${formatUsd(total)}`
	}
	const totalTokens = (usage as { totalTokens?: unknown }).totalTokens
	return typeof totalTokens === "number" ? `smart:${totalTokens} tok` : undefined
}

export function registerLovelyWebSearchTool(pi: ExtensionAPI, config: WebToolsConfig = lovelyWebConfigSpec.defaults) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the web.",
		promptSnippet: "Use web_search for current web information.",
		promptGuidelines: [
			"Use web_search when the user asks for current web information, discovery, or sources beyond the local workspace.",
			"Use web_fetch after web_search when you need the full content of a specific page."
		],
		parameters: getSearchParameters(config),
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0)
			const input = args as unknown as SearchToolArgs
			const mode = input.includeImages ? "images" : (input.source ?? input.topic ?? input.category ?? "web")
			const bits = [mode, `limit ${input.limit ?? 5}`]
			if (input.fetchResult === true) bits.push("fetch first")
			text.setText(
				`${theme.fg("toolTitle", theme.bold("web_search "))}${theme.fg("muted", `"${input.query}"`)} ${theme.fg("dim", `(${bits.join(", ")})`)}`
			)
			return text
		},
		renderResult(result, { expanded, isPartial }, theme) {
			return renderTextResult(result, expanded, theme, isPartial ? "Searching..." : "No results")
		},
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			try {
				const config = loadConfig(ctx.cwd, ctx)
				const searchProvider = getProvider("search", config)
				const input = params as unknown as SearchToolArgs
				onUpdate?.({
					content: [{ type: "text", text: `Searching web with ${searchProvider.label} for: ${input.query}` }],
					details: undefined
				})

				const { query, fetchResult, limit, ...providerOptions } = input
				const searchOptions: SearchOptions = { ...providerOptions, limit: limit ?? 5, timeout: DEFAULT_TIMEOUT_MS }
				const searchResult = await searchProvider.search(resolveApiKey(searchProvider, config), query, searchOptions, signal)
				if (signal?.aborted) throw new Error("Search cancelled")

				const first = searchResult.results[0]
				let fetchedImage: AgentToolResult<unknown> | undefined
				if (fetchResult === true && first?.url) {
					onUpdate?.({ content: [{ type: "text", text: `Fetching first result: ${first.url}` }], details: undefined })
					try {
						const isImageSearch = input.source === "images" || input.includeImages === true
						if (isImageSearch) {
							try {
								fetchedImage = await fetchSearchResultImage(config, first.url, signal)
							} catch {
								if (signal?.aborted) throw new Error("Search cancelled")
								// Some image-search providers return source pages instead of direct image URLs.
							}
						}
						if (!fetchedImage && isFetchEnabled(config)) first.markdown = await fetchSearchResultMarkdown(config, first.url, signal)
						if (signal?.aborted) throw new Error("Search cancelled")
					} catch (err) {
						if (signal?.aborted) throw err
						first.description = first.description || `[Fetch failed: ${asErrorMessage(err)}]`
					}
				}

				const details = fetchedImage ? { search: searchResult.raw, image: fetchedImage.details } : searchResult.raw
				const result: AgentToolResult<unknown> = {
					content: [{ type: "text", text: formatSearchOutput(searchResult.results) }, ...(fetchedImage?.content || [])],
					details
				}
				onUpdate?.(result)
				return result
			} catch (error) {
				throw new Error(`Web search failed: ${asErrorMessage(error)}`)
			}
		}
	})
}

export function registerLovelyWebStaticTools(pi: ExtensionAPI, config: WebToolsConfig = lovelyWebConfigSpec.defaults) {
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: "Fetch a page as markdown. Metadata is verbose and opt-in.",
		promptSnippet: "Use web_fetch to fetch a URL as markdown.",
		promptGuidelines: [
			"Use web_fetch when you need the full readable markdown content of a known URL; prefer web_fetch over bash/curl for web pages because web_fetch returns cleaned markdown suitable for agent context.",
			"Use web_fetch.findText for search inside the page. Snippets are returned.",
			...(config.smartSearchEnabled
				? [
						"Use web_fetch.smartQuery for grounded page processing: summarization, extraction, comparison, troubleshooting, config/API details, or verbatim code/command examples. Any task that can be done on a page by a fast and intelligent LLM."
					]
				: [])
		],
		parameters: getFetchParameters(config),
		renderCall(args, theme, context) {
			const input = args as unknown as FetchToolArgs
			const state = context.state as WebFetchRenderState
			const bits: string[] = []
			if (input.waitFor !== undefined) bits.push(`wait ${input.waitFor}ms`)
			if (input.maxAgeHours !== undefined) bits.push(`max age ${input.maxAgeHours}h`)
			if (input.extractDepth !== undefined) bits.push(input.extractDepth)
			if (input.timeout !== undefined) bits.push(`timeout ${input.timeout}ms`)
			if (input.includeMetadata) bits.push("metadata")
			const suffix = bits.length ? ` ${theme.fg("dim", `(${bits.join(", ")})`)}` : ""
			const smart = input.smartQuery ? ` ${theme.fg("dim", `smart:"${input.smartQuery}"`)}` : ""
			const find = input.findText?.length
				? ` ${theme.fg("dim", `find:${input.findMode ?? "fuzzy"}:[${input.findText.map(text => `"${text}"`).join(", ")}]`)}`
				: ""
			const cost = state.smartCost ? ` ${theme.fg("dim", state.smartCost)}` : ""
			const title = `${theme.fg("toolTitle", theme.bold("web_fetch "))}${theme.fg("muted", input.url)}`
			const oneLine = `${title}${smart}${find}${suffix}${cost}`
			const splitLines = [`${title}${suffix}${cost}`]
			if (input.smartQuery) splitLines.push(theme.fg("dim", `smart:"${input.smartQuery}"`))
			if (input.findText?.length) {
				splitLines.push(theme.fg("dim", `find:${input.findMode ?? "fuzzy"}:[${input.findText.map(text => `"${text}"`).join(", ")}]`))
			}
			return new WebFetchCallComponent(oneLine, splitLines)
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			const state = context.state as WebFetchRenderState
			const cost = !isPartial ? smartCostLabel(result.details) : undefined
			if (cost && state.smartCost !== cost) {
				state.smartCost = cost
				if (!state.smartCostInvalidated) {
					state.smartCostInvalidated = true
					queueMicrotask(() => context.invalidate())
				}
			}
			return renderTextResult(result, expanded, theme, isPartial ? "Fetching..." : "No content")
		},
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const input = params as unknown as FetchToolArgs
			let config: WebToolsConfig
			let result: { markdown: string; metadata?: unknown; raw: unknown }
			try {
				config = loadConfig(ctx.cwd, ctx)
				const fetchProvider = getProvider("fetch", config)
				onUpdate?.({
					content: [{ type: "text", text: `Fetching page with ${fetchProvider.label}: ${input.url}` }],
					details: undefined
				})

				result = await fetchProvider.fetch(
					resolveApiKey(fetchProvider, config),
					input.url,
					{
						timeout: input.timeout ?? DEFAULT_TIMEOUT_MS,
						...(input.waitFor !== undefined ? { waitFor: input.waitFor } : {}),
						...(input.maxAgeHours !== undefined ? { maxAgeHours: input.maxAgeHours } : {}),
						...(input.extractDepth !== undefined ? { extractDepth: input.extractDepth } : {})
					},
					signal
				)
				if (signal?.aborted) throw new Error("Fetch cancelled")
			} catch (error) {
				throw new Error(`Web fetch failed: ${asErrorMessage(error)}`)
			}

			const metadata = input.includeMetadata && result.metadata ? `\n\nMetadata:\n${stringify(result.metadata)}` : ""
			const fetchedText = `${result.markdown}${metadata}`
			const outputParts: string[] = []
			const renderParts: string[] = []
			const extraDetails: { smart?: unknown; findText?: unknown; renderText?: string } = {}
			const findText = input.findText?.map(text => text.trim()).filter(Boolean) ?? []
			if (input.smartQuery?.trim()) {
				onUpdate?.({ content: [{ type: "text", text: "Processing fetched page with smart search" }], details: undefined })
				let smartText: string
				try {
					const smart = await smartProcess(
						config,
						ctx,
						{ query: input.smartQuery.trim(), resultText: fetchedText, sourceUrl: input.url },
						signal
					)
					if (!smart) throw new Error("unavailable. Check /lovely-web smart search model and auth config.")
					smartText = smart.text
					extraDetails.smart = smart.details
				} catch (error) {
					if (signal?.aborted) throw error
					smartText = `Smart search failed: ${asErrorMessage(error)}`
					extraDetails.smart = { error: smartText }
					if (findText.length === 0) throw new Error(smartText)
				}
				outputParts.push(smartText)
				renderParts.push(smartText)
			}
			if (findText.length > 0) {
				const found = formatFindTextMatches(fetchedText, findText, input.findMode ?? "fuzzy")
				if (found.text) {
					outputParts.push(found.text)
					renderParts.push(found.renderText)
				}
				extraDetails.findText = found.details
			}
			const hasExtraOutput = outputParts.length > 0
			const outputText = hasExtraOutput ? outputParts.join("\n\n---\n\n") : fetchedText
			const renderText = renderParts.join("\n\n---\n\n")
			if (hasExtraOutput && renderText !== outputText) extraDetails.renderText = renderText
			const toolResult: AgentToolResult<unknown> = {
				content: [{ type: "text", text: outputText }],
				details: hasExtraOutput ? { fetch: result.raw, ...extraDetails } : result.raw
			}
			onUpdate?.(toolResult)
			return toolResult
		}
	})

	pi.registerTool({
		name: "web_image",
		label: "Web Image",
		description: "Fetch an image URL and return it as image content for vision-capable models.",
		promptSnippet: "Use web_image to fetch an image URL as image content.",
		promptGuidelines: [
			"Use web_image when you need to inspect a specific image URL with a vision-capable model.",
			"Prefer web_image only for selected images; web pages can contain many irrelevant images."
		],
		parameters: Type.Object({
			url: Type.String({ description: "The image URL to fetch.", format: "uri" }),
			timeout: Type.Optional(Type.Integer({ description: "Request timeout in milliseconds. Defaults to 30000.", minimum: 1 })),
			maxBytes: Type.Optional(
				Type.Integer({
					description: `Maximum image size in bytes. Defaults to ${DEFAULT_MAX_IMAGE_BYTES}; maximum ${MAX_IMAGE_BYTES}.`,
					minimum: 1,
					maximum: MAX_IMAGE_BYTES
				})
			)
		}),
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0)
			const bits: string[] = []
			if (args.timeout !== undefined) bits.push(`timeout ${args.timeout}ms`)
			if (args.maxBytes !== undefined) bits.push(`max ${args.maxBytes} bytes`)
			const suffix = bits.length ? ` ${theme.fg("dim", `(${bits.join(", ")})`)}` : ""
			text.setText(`${theme.fg("toolTitle", theme.bold("web_image "))}${theme.fg("muted", args.url)}${suffix}`)
			return text
		},
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			try {
				const config = loadConfig(ctx.cwd, ctx)
				if (!isImageEnabled(config)) throw new Error("web_image is disabled. Enable it via /lovely-web.")
				onUpdate?.({
					content: [{ type: "text", text: `Fetching image: ${params.url}` }],
					details: undefined
				})
				return await imageImpl(
					{
						url: params.url,
						timeout: params.timeout,
						maxBytes: params.maxBytes,
						resize: isImageResizeEnabled(config),
						maxSize: getImageMaxSize(config)
					},
					signal,
					onUpdate
				)
			} catch (error) {
				throw new Error(`Web image failed: ${asErrorMessage(error)}`)
			}
		}
	})
}

export function registerLovelyWebTools(pi: ExtensionAPI, config: WebToolsConfig = lovelyWebConfigSpec.defaults) {
	registerLovelyWebSearchTool(pi, config)
	registerLovelyWebStaticTools(pi, config)
}
