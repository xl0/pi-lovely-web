import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { type ConfigFromSchema, defineScopedConfig, field } from "@xl0/pi-lovely-config"
import { braveProvider } from "./providers/brave.js"
import { exaProvider } from "./providers/exa.js"
import { firecrawlProvider } from "./providers/firecrawl.js"
import { tavilyProvider } from "./providers/tavily.js"
import type { Provider } from "./providers/types.js"

export const DEFAULT_PROVIDER_ID = "firecrawl"
export const CONFIG_FILE_NAME = "xl0-pi-lovely-web.json"
export const OLD_CONFIG_FILE_NAME = "xl0-web-tools.json"
export const DISABLED_VALUE = "disabled"

const searchProviderValues = ["firecrawl", "exa", "tavily", "brave"] as const
const fetchProviderValues = ["firecrawl", "exa", "tavily"] as const
const searchProviderSettingValues = [DISABLED_VALUE, ...searchProviderValues] as const
const fetchProviderSettingValues = [DISABLED_VALUE, ...fetchProviderValues] as const

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

const lovelyWebConfigSchema = {
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
	firecrawlApiKey: field.string("", { label: "Firecrawl API key" }),
	exaApiKey: field.string("", { label: "Exa API key" }),
	tavilyApiKey: field.string("", { label: "Tavily API key" }),
	braveApiKey: field.string("", { label: "Brave API key" })
} as const

export type WebToolsConfig = ConfigFromSchema<typeof lovelyWebConfigSchema>

export const lovelyWebConfigSpec = defineScopedConfig({
	fileName: CONFIG_FILE_NAME,
	schema: lovelyWebConfigSchema
})

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

export function loadConfig(cwd: string): WebToolsConfig {
	return loadScopedConfig(cwd).value
}

export function loadScopedConfig(cwd: string): typeof lovelyWebConfigSpec {
	migrateOldConfig(cwd)
	return lovelyWebConfigSpec.load(cwd)
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

type ConfigPatch = Partial<Record<keyof WebToolsConfig, unknown>> & Record<string, unknown>
type OldConfig = {
	webSearch?: { provider?: string | null }
	webFetch?: { provider?: string | null }
	webImage?: { enabled?: boolean; resize?: boolean; maxSize?: number }
	webApiKeys?: Record<string, string>
}

function migrateOldConfig(cwd: string): void {
	for (const scope of lovelyWebConfigSpec.scopes) {
		const newPath = lovelyWebConfigSpec.path(scope, cwd)
		const oldPath = join(dirname(newPath), OLD_CONFIG_FILE_NAME)
		if (!existsSync(oldPath)) continue

		let migrated: ConfigPatch
		try {
			migrated = oldToNewConfig(readJsonObject(oldPath) as OldConfig)
		} catch {
			rmSync(oldPath, { force: true })
			continue
		}
		const existing = existsSync(newPath) ? readJsonObject(newPath) : {}
		writeJsonObject(newPath, { ...migrated, ...existing })
		rmSync(oldPath, { force: true })
	}
}

function oldToNewConfig(old: OldConfig): ConfigPatch {
	const config: ConfigPatch = {}
	setProvider(config, "webSearchProvider", old.webSearch?.provider)
	setProvider(config, "webFetchProvider", old.webFetch?.provider)
	if (typeof old.webImage?.enabled === "boolean") config.webImageEnabled = old.webImage.enabled
	if (typeof old.webImage?.resize === "boolean") config.webImageResize = old.webImage.resize
	if (typeof old.webImage?.maxSize === "number") config.webImageMaxSize = old.webImage.maxSize
	for (const [providerId, key] of Object.entries(old.webApiKeys ?? {})) {
		const keyField = apiKeyFields[providerId as keyof typeof apiKeyFields]
		if (keyField && typeof key === "string") config[keyField] = key
	}
	return config
}

function setProvider(config: ConfigPatch, key: "webSearchProvider" | "webFetchProvider", provider: string | null | undefined): void {
	if (provider === undefined) return
	if (provider === null) {
		config[key] = DISABLED_VALUE
		return
	}
	config[key] = provider
}

function readJsonObject(path: string): ConfigPatch {
	try {
		const value = JSON.parse(readFileSync(path, "utf-8"))
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be an object")
		return value as ConfigPatch
	} catch (error) {
		throw new Error(`Invalid Lovely Web config at ${path}: ${error instanceof Error ? error.message : String(error)}`)
	}
}

function writeJsonObject(path: string, config: ConfigPatch): void {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
}
