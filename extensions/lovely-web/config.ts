import { existsSync, readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { type ConfigFromSchema, defineScopedConfig, field, type ScopedConfig } from "@xl0/pi-lovely-config"
import { braveProvider } from "./providers/brave.js"
import { exaProvider } from "./providers/exa.js"
import { firecrawlProvider } from "./providers/firecrawl.js"
import { tavilyProvider } from "./providers/tavily.js"
import type { Provider } from "./providers/types.js"
import { SMART_SYSTEM_PROMPT } from "./smart.js"

export const DEFAULT_PROVIDER_ID = "firecrawl"
export const CONFIG_FILE_NAME = "xl0-pi-lovely-web.json"
export const OLD_CONFIG_FILE_NAME = "xl0-web-tools.json"
export const DISABLED_VALUE = "disabled"

const searchProviderValues = ["firecrawl", "exa", "tavily", "brave"] as const
const fetchProviderValues = ["firecrawl", "exa", "tavily"] as const
const searchProviderSettingValues = [DISABLED_VALUE, ...searchProviderValues] as const
const fetchProviderSettingValues = [DISABLED_VALUE, ...fetchProviderValues] as const
type SmartModelConfigContext = Pick<ExtensionContext, "model" | "modelRegistry">

export const providers: Record<string, Provider> = {
	firecrawl: firecrawlProvider,
	exa: exaProvider,
	tavily: tavilyProvider,
	brave: braveProvider
}

const apiKeyFields = {
	firecrawl: "firecrawlApiKey",
	exa: "exaApiKey",
	tavily: "tavilyApiKey",
	brave: "braveApiKey"
} as const

function modelId(model: ExtensionContext["model"]): string | undefined {
	return model ? `${model.provider}/${model.id}` : undefined
}

function smartSearchModelField(ctx?: SmartModelConfigContext) {
	const availableModels = ctx?.modelRegistry.getAvailable().filter(model => model.input.includes("text")) ?? []
	const [firstModelId, ...otherModelIds] = availableModels.map(model => `${model.provider}/${model.id}`)
	if (firstModelId === undefined) {
		return field.string("", {
			label: "Smart search model",
			description: "Text model as provider/model. No authenticated text models are currently available.",
			depth: 1,
			visibleWhen: ({ get }) => get("smartSearchEnabled") === true
		})
	}

	const modelValues = [firstModelId, ...otherModelIds] as [string, ...string[]]
	const currentModelId = modelId(ctx?.model)
	const defaultModel = currentModelId && modelValues.includes(currentModelId) ? currentModelId : modelValues[0]
	const valueDescriptions = Object.fromEntries(availableModels.map(model => [`${model.provider}/${model.id}`, model.name || model.id]))
	return field.enum(modelValues, defaultModel, {
		label: "Smart search model",
		description: "Pi text model for smartQuery post-processing.",
		search: true,
		valueDescriptions,
		depth: 1,
		visibleWhen: ({ get }) => get("smartSearchEnabled") === true
	})
}

function createLovelyWebConfigSchema(ctx?: SmartModelConfigContext) {
	return {
		webSearchProvider: field.enum(searchProviderSettingValues, DEFAULT_PROVIDER_ID, {
			label: "web_search",
			description: "Search provider, or disabled to remove web_search from active tools."
		}),
		webFetchProvider: field.enum(fetchProviderSettingValues, DISABLED_VALUE, {
			label: "web_fetch",
			description: "Fetch provider, or disabled to remove web_fetch from active tools."
		}),
		webImageEnabled: field.boolean(true, {
			label: "web_image",
			description: "Enable or disable direct image URL fetching."
		}),
		webImageResize: field.boolean(true, {
			label: "Resize images",
			description: "Resize fetched images to fit within the max size limit.",
			depth: 1,
			visibleWhen: ({ get }) => get("webImageEnabled") === true
		}),
		webImageMaxSize: field.number(2000, {
			label: "Max image size",
			description: "Maximum longest side in pixels for resized images.",
			min: 1,
			step: 100,
			depth: 1,
			visibleWhen: ({ get }) => get("webImageEnabled") === true && get("webImageResize") === true
		}),
		smartSearchEnabled: field.boolean(false, {
			label: "Smart search",
			description: "Enable smartQuery post-processing for web_fetch."
		}),
		smartSearchModel: smartSearchModelField(ctx),
		smartSearchMaxTokens: field.number(2000, {
			label: "Smart search max tokens",
			description: "Maximum output tokens for smartQuery post-processing.",
			min: 1,
			step: 100,
			depth: 1,
			visibleWhen: ({ get }) => get("smartSearchEnabled") === true
		}),
		smartSearchSystemPrompt: field.text(SMART_SYSTEM_PROMPT, {
			label: "Smart search system prompt",
			description: "System prompt for smartQuery post-processing. Unset to use the built-in default.",
			depth: 1,
			visibleWhen: ({ get }) => get("smartSearchEnabled") === true
		}),
		firecrawlApiKey: field.string("", { label: "Firecrawl API key" }),
		exaApiKey: field.string("", { label: "Exa API key" }),
		tavilyApiKey: field.string("", { label: "Tavily API key" }),
		braveApiKey: field.string("", { label: "Brave API key" })
	} as const
}

const lovelyWebConfigSchema = createLovelyWebConfigSchema()

export type WebToolsConfig = ConfigFromSchema<typeof lovelyWebConfigSchema>

export const lovelyWebConfigSpec = createLovelyWebConfigSpec()

export function createLovelyWebConfigSpec(ctx?: SmartModelConfigContext): ScopedConfig<WebToolsConfig> {
	return defineScopedConfig({
		fileName: CONFIG_FILE_NAME,
		schema: createLovelyWebConfigSchema(ctx)
	}) as ScopedConfig<WebToolsConfig>
}

export function isSearchEnabled(config: WebToolsConfig): boolean {
	return config.webSearchProvider !== DISABLED_VALUE
}

export function isFetchEnabled(config: WebToolsConfig): boolean {
	return config.webFetchProvider !== DISABLED_VALUE
}

export function isImageEnabled(config: WebToolsConfig): boolean {
	return config.webImageEnabled
}

export function isImageResizeEnabled(config: WebToolsConfig): boolean {
	return config.webImageResize
}

export function getImageMaxSize(config: WebToolsConfig): number {
	return config.webImageMaxSize
}

function resolveProviderId(type: "search" | "fetch", config: WebToolsConfig): string {
	if (type === "search" && !isSearchEnabled(config)) throw new Error("web_search is disabled. Enable it via /lovely-web.")
	if (type === "fetch" && !isFetchEnabled(config)) throw new Error("web_fetch is disabled. Enable it via /lovely-web.")

	const id = type === "search" ? config.webSearchProvider : config.webFetchProvider
	if (!providers[id]) throw new Error(`Unknown provider "${id}". Available: ${Object.keys(providers).join(", ")}.`)
	return id
}

export function getProvider(type: "fetch", config: WebToolsConfig): Provider & { fetch: NonNullable<Provider["fetch"]> }
export function getProvider(type: "search", config: WebToolsConfig): Provider
export function getProvider(type: "search" | "fetch", config: WebToolsConfig): Provider {
	const id = resolveProviderId(type, config)
	const provider = providers[id]
	if (!provider) throw new Error(`Provider "${id}" not found.`)
	if (type === "fetch" && !provider.fetch) {
		throw new Error(
			`${provider.label} does not support fetching pages. Configure a fetch-capable provider (e.g. firecrawl, exa, tavily) via /lovely-web.`
		)
	}
	return provider as Provider & { fetch: NonNullable<Provider["fetch"]> }
}

export function resolveApiKey(provider: Provider, config: WebToolsConfig): string {
	const keyField = apiKeyFields[provider.id as keyof typeof apiKeyFields]
	const key = keyField ? config[keyField] : undefined
	if (key) return key
	const envKey = process.env[provider.envApiKey]
	if (envKey) return envKey
	throw new Error(`No API key for ${provider.label}. Set it via /lovely-web or set the ${provider.envApiKey} environment variable.`)
}

export function loadConfig(cwd: string, ctx?: SmartModelConfigContext): WebToolsConfig {
	return loadScopedConfig(cwd, ctx).value
}

export function loadScopedConfig(cwd: string, ctx?: SmartModelConfigContext): ScopedConfig<WebToolsConfig> {
	const config = createLovelyWebConfigSpec(ctx).load(cwd)
	migrateOldConfig(config)
	return config
}

export function applyToolConfig(pi: ExtensionAPI, config: WebToolsConfig): void {
	const active = new Set(pi.getActiveTools())
	if (isSearchEnabled(config)) active.add("web_search")
	else active.delete("web_search")
	if (isFetchEnabled(config)) active.add("web_fetch")
	else active.delete("web_fetch")
	if (isImageEnabled(config)) active.add("web_image")
	else active.delete("web_image")
	pi.setActiveTools([...active])
}

type OldConfig = {
	webSearch?: { provider?: string | null }
	webFetch?: { provider?: string | null }
	webImage?: { enabled?: boolean; resize?: boolean; maxSize?: number }
	webApiKeys?: Record<string, string>
}

function migrateOldConfig(config: ScopedConfig<WebToolsConfig>): void {
	for (const scope of config.scopes) {
		const newPath = config.path(scope)
		const oldPath = join(dirname(newPath), OLD_CONFIG_FILE_NAME)
		if (!existsSync(oldPath)) continue

		try {
			const old = JSON.parse(readFileSync(oldPath, "utf-8")) as OldConfig
			if (!old || typeof old !== "object" || Array.isArray(old)) throw new Error("old config must be an object")
			const update = <Key extends keyof WebToolsConfig & string>(key: Key, value: WebToolsConfig[Key]) => {
				if (config.scoped[scope][key] === undefined) config.update(scope, key, value)
			}

			const searchProvider = old.webSearch?.provider
			if (searchProvider === null) update("webSearchProvider", DISABLED_VALUE)
			else if (typeof searchProvider === "string" && (searchProviderSettingValues as readonly string[]).includes(searchProvider)) {
				update("webSearchProvider", searchProvider as WebToolsConfig["webSearchProvider"])
			}

			const fetchProvider = old.webFetch?.provider
			if (fetchProvider === null) update("webFetchProvider", DISABLED_VALUE)
			else if (typeof fetchProvider === "string" && (fetchProviderSettingValues as readonly string[]).includes(fetchProvider)) {
				update("webFetchProvider", fetchProvider as WebToolsConfig["webFetchProvider"])
			}

			if (typeof old.webImage?.enabled === "boolean") update("webImageEnabled", old.webImage.enabled)
			if (typeof old.webImage?.resize === "boolean") update("webImageResize", old.webImage.resize)
			if (typeof old.webImage?.maxSize === "number" && old.webImage.maxSize >= 1) update("webImageMaxSize", old.webImage.maxSize)

			for (const [providerId, key] of Object.entries(old.webApiKeys ?? {})) {
				const keyField = apiKeyFields[providerId as keyof typeof apiKeyFields]
				if (keyField && typeof key === "string") update(keyField, key)
			}
		} catch {
			// Best-effort legacy migration: malformed/stale old config should not block startup.
		} finally {
			rmSync(oldPath, { force: true })
		}
	}
}
