import { type Api, type AssistantMessage, completeSimple, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { WebToolsConfig } from "./config.js"

const SMART_INPUT_FALLBACK_CHARS = 60_000 * 3

export const SMART_SYSTEM_PROMPT = `Process one web_fetch result for a coding agent.
Use only facts explicitly stated in the provided page text.
Answer the smart query, not the whole page. Include neighboring/related sections only when needed for the requested task.

Return concise Markdown in the format that best fits the query:
- If the query asks for a specific format, use it.
- For verbatim code, commands, schemas, examples, config, or error text, return the requested excerpt first, exactly as written, preserving indentation and punctuation.
- For summaries, focus on what a coding agent needs: purpose, setup, APIs/options, steps, limits, caveats, security notes, migration/breaking changes, and gotchas that are directly stated.
- For extraction/comparison, use bullet points, preserve exact names, signatures, flags, codes, amounts, dates, deadlines, defaults, and version/platform caveats.
- For troubleshooting, include directly stated symptoms, causes, fixes/workarounds, and warnings.

Grounding rules:
- Include short exact quotes or source context for important claims unless the answer is only a verbatim excerpt.
- There is one fetched page; use a heading like "Evidence (on this page):" for an evidence section. 
- If requested information is absent or partially absent, say "Not found on page." Mention missing fields under a short Missing section when useful.
- Use "None" only when the page explicitly supports it or the query only asks whether requested fields were found.
- For legal/admin pages, state only what the page says and flag when exact amounts/codes require a calculator, form, or agency confirmation.`

let warnedDefaultModel = false
let warnedUnavailableModel = false
let disabledForSession = false

export interface SmartProcessInput {
	query: string
	resultText: string
	sourceUrl?: string
}

export interface SmartProcessResult {
	text: string
	details: {
		query: string
		model: string
		inputChars: number
		originalInputChars: number
		maxInputChars: number
		truncated: boolean
		stopReason: AssistantMessage["stopReason"]
		usage: AssistantMessage["usage"]
	}
}

export function resetSmartRuntimeState(): void {
	warnedDefaultModel = false
	warnedUnavailableModel = false
	disabledForSession = false
}

export function resetSmartConfigState(): void {
	warnedUnavailableModel = false
	disabledForSession = false
}

function modelName(model: Model<Api>): string {
	return `${model.provider}/${model.id}`
}

function warn(ctx: ExtensionContext, message: string): void {
	ctx.ui.notify(message, "warning")
}

function disableSmart(ctx: ExtensionContext, reason: string): void {
	disabledForSession = true
	if (warnedUnavailableModel) return
	warnedUnavailableModel = true
	warn(ctx, `Lovely Web smart search disabled: ${reason}`)
}

function resolveConfiguredModel(ctx: ExtensionContext, configured: string): Model<Api> | undefined {
	const separator = configured.indexOf("/")
	if (separator <= 0 || separator === configured.length - 1) {
		disableSmart(ctx, `configured model must be "provider/model", got "${configured}".`)
		return undefined
	}

	const provider = configured.slice(0, separator)
	const modelId = configured.slice(separator + 1)
	const model = ctx.modelRegistry.getAvailable().find(model => model.provider === provider && model.id === modelId)
	if (!model) {
		disableSmart(ctx, `configured model unavailable: ${configured}`)
		return undefined
	}
	if (!model.input.includes("text")) {
		disableSmart(ctx, `configured model does not support text input: ${configured}`)
		return undefined
	}
	return model
}

function resolveCurrentModel(ctx: ExtensionContext): Model<Api> | undefined {
	const model = ctx.model
	if (!model) {
		disableSmart(ctx, "no current model is selected.")
		return undefined
	}
	if (!model.input.includes("text")) {
		disableSmart(ctx, `current model does not support text input: ${modelName(model)}.`)
		return undefined
	}
	if (!warnedDefaultModel) {
		warnedDefaultModel = true
		warn(ctx, `Lovely Web smart search model not selected; using current model ${modelName(model)}.`)
	}
	return model
}

function resolveSmartModel(config: WebToolsConfig, ctx: ExtensionContext): Model<Api> | undefined {
	if (!config.smartSearchEnabled || disabledForSession) return undefined
	const configured = config.smartSearchModel.trim()
	return configured ? resolveConfiguredModel(ctx, configured) : resolveCurrentModel(ctx)
}

export function validateSmartConfig(config: WebToolsConfig, ctx: ExtensionContext): boolean {
	if (!config.smartSearchEnabled) return true
	return resolveSmartModel(config, ctx) !== undefined
}

function truncateForModel(text: string, model: Model<Api>): { text: string; originalChars: number; maxChars: number; truncated: boolean } {
	const maxChars = model.contextWindow > 0 ? Math.max(4000, Math.floor((model.contextWindow / 2) * 3)) : SMART_INPUT_FALLBACK_CHARS
	if (text.length <= maxChars) return { text, originalChars: text.length, maxChars, truncated: false }
	return { text: text.slice(0, maxChars), originalChars: text.length, maxChars, truncated: true }
}

function extractText(message: AssistantMessage): string {
	return message.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text")
		.map(item => item.text)
		.join("\n")
		.trim()
}

function smartSystemPrompt(config: WebToolsConfig): string {
	return config.smartSearchSystemPrompt.trim() ? config.smartSearchSystemPrompt : SMART_SYSTEM_PROMPT
}

export async function smartProcess(
	config: WebToolsConfig,
	ctx: ExtensionContext,
	input: SmartProcessInput,
	signal?: AbortSignal
): Promise<SmartProcessResult | undefined> {
	const model = resolveSmartModel(config, ctx)
	if (!model) return undefined

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
	if (!auth.ok) {
		disableSmart(ctx, `model auth unavailable for ${modelName(model)}: ${auth.error}`)
		return undefined
	}

	const maxTokens = Math.max(1, config.smartSearchMaxTokens)
	const truncated = truncateForModel(input.resultText, model)
	const sourceUrlText = input.sourceUrl ? `\n\nSource URL:\n${input.sourceUrl}` : ""
	const prompt = `Smart query:\n${input.query}${sourceUrlText}\n\nResult text:\n${truncated.text}`
	const options: SimpleStreamOptions = { maxTokens }
	if (auth.apiKey !== undefined) options.apiKey = auth.apiKey
	if (auth.headers !== undefined) options.headers = auth.headers
	if (auth.env !== undefined) options.env = auth.env
	if (signal !== undefined) options.signal = signal

	const response = await completeSimple(
		model,
		{
			systemPrompt: smartSystemPrompt(config),
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }]
		},
		options
	)

	if (response.stopReason === "error" || response.stopReason === "aborted") {
		throw new Error(`Smart search failed: ${response.errorMessage || response.stopReason}`)
	}

	const answer = extractText(response) || "Not found in provided results."
	const truncationNotice = truncated.truncated
		? `\n\nNote: Smart input was truncated to ${truncated.text.length}/${truncated.originalChars} characters to stay within half of ${modelName(model)} context. Answer may omit trimmed content.`
		: ""
	return {
		text: `${answer}${truncationNotice}`,
		details: {
			query: input.query,
			model: modelName(model),
			inputChars: truncated.text.length,
			originalInputChars: truncated.originalChars,
			maxInputChars: truncated.maxChars,
			truncated: truncated.truncated,
			stopReason: response.stopReason,
			usage: response.usage
		}
	}
}
