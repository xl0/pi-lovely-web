import type { TSchema } from "typebox"

export interface SearchResult {
	title: string
	url: string
	description?: string
	markdown?: string // populated for first result when fetchResult=true
}

export interface SearchOptions {
	limit: number
	source?: string
	timeout?: number
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

export interface FetchOptions {
	timeout?: number
	waitFor?: number
	maxAgeHours?: number
	extractDepth?: string
}

export interface Provider {
	readonly id: string
	readonly label: string
	readonly envApiKey: string
	readonly searchParameters?: Record<string, TSchema>
	readonly fetchParameters?: Record<string, TSchema>
	search(apiKey: string, query: string, opts: SearchOptions, signal?: AbortSignal): Promise<{ results: SearchResult[]; raw: unknown }>
	fetch?(
		apiKey: string,
		url: string,
		opts: FetchOptions,
		signal?: AbortSignal
	): Promise<{ markdown: string; metadata?: unknown; raw: unknown }>
}
