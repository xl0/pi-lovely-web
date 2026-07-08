export type FindMode = "exact" | "lower" | "fuzzy"

export const FIND_HIGHLIGHT_START = "\uE000"
export const FIND_HIGHLIGHT_END = "\uE001"

const FIND_TEXT_CONTEXT_CHARS = 500
const FIND_TEXT_SNIPPET_CHARS = FIND_TEXT_CONTEXT_CHARS * 2
const FIND_TEXT_MAX_CHARS = FIND_TEXT_SNIPPET_CHARS * 20

interface SnippetRange {
	start: number
	end: number
}

interface TextMatch {
	query: string
	index: number
	length: number
	highlights?: SnippetRange[]
}

interface FindSnippet extends SnippetRange {
	matches: TextMatch[]
}

interface TextToken extends SnippetRange {
	normalized: string
}

function compactSnippetPart(text: string): string {
	return text.replace(/\s+/g, " ").trim()
}

function snippetRange(text: string, index: number, length: number): SnippetRange {
	return {
		start: Math.max(0, index - FIND_TEXT_CONTEXT_CHARS),
		end: Math.min(text.length, index + length + FIND_TEXT_CONTEXT_CHARS)
	}
}

function mergeRanges(ranges: SnippetRange[]): SnippetRange[] {
	const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
	const merged: SnippetRange[] = []
	for (const range of sorted) {
		const last = merged.at(-1)
		if (!last || range.start > last.end) merged.push({ ...range })
		else last.end = Math.max(last.end, range.end)
	}
	return merged
}

function mergeMatchesIntoSnippets(text: string, matches: TextMatch[]): FindSnippet[] {
	const sorted = [...matches].sort((a, b) => a.index - b.index || a.query.localeCompare(b.query))
	const merged: FindSnippet[] = []
	for (const match of sorted) {
		const range = snippetRange(text, match.index, match.length)
		const last = merged.at(-1)
		if (!last || range.start > last.end) merged.push({ ...range, matches: [match] })
		else {
			last.end = Math.max(last.end, range.end)
			last.matches.push(match)
		}
	}
	return merged
}

function matchHighlights(match: TextMatch): SnippetRange[] {
	return match.highlights ?? [{ start: match.index, end: match.index + match.length }]
}

function formatPlainSnippet(text: string, snippet: FindSnippet): string {
	return `${snippet.start > 0 ? "…" : ""}${compactSnippetPart(text.slice(snippet.start, snippet.end))}${snippet.end < text.length ? "…" : ""}`.trim()
}

function formatMarkedSnippet(text: string, snippet: FindSnippet): string {
	const highlights = mergeRanges(
		snippet.matches
			.flatMap(match => matchHighlights(match))
			.map(range => ({ start: Math.max(snippet.start, range.start), end: Math.min(snippet.end, range.end) }))
			.filter(range => range.end > range.start)
	)

	let cursor = snippet.start
	let marked = ""
	for (const range of highlights) {
		marked += text.slice(cursor, range.start)
		marked += `${FIND_HIGHLIGHT_START}${text.slice(range.start, range.end)}${FIND_HIGHLIGHT_END}`
		cursor = range.end
	}
	marked += text.slice(cursor, snippet.end)
	return `${snippet.start > 0 ? "…" : ""}${compactSnippetPart(marked)}${snippet.end < text.length ? "…" : ""}`.trim()
}

function normalizeFindText(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLocaleLowerCase()
}

function normalizeQuery(text: string): string {
	return normalizeFindText(text)
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
}

function tokenize(text: string, baseStart = 0): TextToken[] {
	const tokens: TextToken[] = []
	const re = /[\p{L}\p{N}]+/gu
	let match = re.exec(text)
	while (match) {
		const raw = match[0]
		const normalized = normalizeFindText(raw)
		if (normalized) tokens.push({ normalized, start: baseStart + match.index, end: baseStart + match.index + raw.length })
		match = re.exec(text)
	}
	return tokens
}

function cappedEditDistance(a: string, b: string, max: number): number {
	if (Math.abs(a.length - b.length) > max) return max + 1
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
	for (let i = 1; i <= a.length; i++) {
		const curr = [i]
		let rowMin = curr[0] ?? 0
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1
			const value = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
			curr[j] = value
			rowMin = Math.min(rowMin, value)
		}
		if (rowMin > max) return max + 1
		prev = curr
	}
	return prev[b.length] ?? max + 1
}

function fuzzyTokenMatches(token: string, chunkToken: string): boolean {
	if (chunkToken === token) return true
	if (/\d/.test(token)) return false
	if (token.length < 6) return false
	const maxDistance = token.length <= 8 ? 1 : 2
	return Math.abs(token.length - chunkToken.length) <= maxDistance && cappedEditDistance(token, chunkToken, maxDistance) <= maxDistance
}

function matchingQueryIndexes(token: string, queryTokens: string[]): number[] {
	return queryTokens.flatMap((queryToken, index) => (fuzzyTokenMatches(queryToken, token) ? [index] : []))
}

function selectFuzzyWindow(tokens: TextToken[], queryTokens: string[], maxSpan: number): { tokens: TextToken[]; coverage: number } {
	const candidates = tokens
		.map(token => ({ token, queryIndexes: matchingQueryIndexes(token.normalized, queryTokens) }))
		.filter(candidate => candidate.queryIndexes.length > 0)
	const minCoverage = queryTokens.length === 1 ? 1 : Math.ceil(queryTokens.length * 0.6)
	for (let target = queryTokens.length; target >= minCoverage; target--) {
		const counts = new Map<number, number>()
		let unique = 0
		let left = 0
		let best: { left: number; right: number; span: number } | undefined
		for (let right = 0; right < candidates.length; right++) {
			for (const queryIndex of candidates[right]?.queryIndexes ?? []) {
				const count = counts.get(queryIndex) ?? 0
				if (count === 0) unique++
				counts.set(queryIndex, count + 1)
			}
			while (unique >= target) {
				const leftToken = candidates[left]?.token
				const rightToken = candidates[right]?.token
				if (leftToken && rightToken) {
					const span = rightToken.end - leftToken.start
					if (!best || span < best.span) best = { left, right, span }
				}
				for (const queryIndex of candidates[left]?.queryIndexes ?? []) {
					const count = (counts.get(queryIndex) ?? 0) - 1
					if (count === 0) {
						counts.delete(queryIndex)
						unique--
					} else counts.set(queryIndex, count)
				}
				left++
			}
		}
		if (best && best.span <= maxSpan) {
			return {
				tokens: candidates.slice(best.left, best.right + 1).map(candidate => candidate.token),
				coverage: target / queryTokens.length
			}
		}
	}
	return { tokens: [], coverage: 0 }
}

function splitChunks(text: string): Array<{ text: string; start: number }> {
	const chunks: Array<{ text: string; start: number }> = []
	const re = /\n\s*\n+/g
	let start = 0
	let match = re.exec(text)
	while (match) {
		const chunkText = text.slice(start, match.index)
		const trimmed = chunkText.trim()
		const firstNonSpace = chunkText.search(/\S/)
		if (trimmed.length > 20 && firstNonSpace >= 0) chunks.push({ text: trimmed, start: start + firstNonSpace })
		start = re.lastIndex
		match = re.exec(text)
	}
	const chunkText = text.slice(start)
	const trimmed = chunkText.trim()
	const firstNonSpace = chunkText.search(/\S/)
	if (trimmed.length > 20 && firstNonSpace >= 0) chunks.push({ text: trimmed, start: start + firstNonSpace })
	return chunks
}

function snippetChars(range: SnippetRange): number {
	return range.end - range.start
}

function clipSnippet(snippet: FindSnippet, maxChars: number): FindSnippet | undefined {
	const end = Math.min(snippet.end, snippet.start + maxChars)
	const matches = snippet.matches.filter(match => match.index < end && match.index + match.length > snippet.start)
	return matches.length > 0 ? { start: snippet.start, end, matches } : undefined
}

function countQueries(matches: TextMatch[]): Array<{ query: string; count: number }> {
	const counts = new Map<string, number>()
	for (const match of matches) counts.set(match.query, (counts.get(match.query) ?? 0) + 1)
	return [...counts].map(([query, count]) => ({ query, count }))
}

function formatQueryCounts(matches: TextMatch[]): string {
	return countQueries(matches)
		.map(({ query, count }) => `"${query}" ×${count}`)
		.join(", ")
}

function collectLiteralMatches(text: string, query: string, mode: "exact" | "lower"): TextMatch[] {
	const needle = query.trim()
	const haystack = mode === "exact" ? text : text.toLocaleLowerCase()
	const searchNeedle = mode === "exact" ? needle : needle.toLocaleLowerCase()
	const matches: TextMatch[] = []
	let index = searchNeedle ? haystack.indexOf(searchNeedle) : -1
	while (index !== -1) {
		matches.push({ query: needle, index, length: needle.length })
		index = haystack.indexOf(searchNeedle, index + searchNeedle.length)
	}
	return matches
}

function collectFuzzyMatches(text: string, query: string): TextMatch[] {
	const normalizedQuery = normalizeQuery(query)
	const queryTokens = [...new Set(normalizedQuery.split(" ").filter(token => token.length >= 2))].slice(0, 20)
	if (queryTokens.length === 0) return []
	const maxSpan = queryTokens.length <= 2 ? Math.max(60, normalizedQuery.length * 3) : Math.max(30, queryTokens.join(" ").length * 2)

	return splitChunks(text)
		.map(chunk => {
			const tokens = tokenize(chunk.text, chunk.start)
			const normalizedChunk = tokens.map(token => token.normalized).join(" ")
			const phraseHit = normalizedChunk.includes(queryTokens.join(" "))
			const window = selectFuzzyWindow(tokens, queryTokens, maxSpan)
			const matchedTokens = window.tokens
			const coverage = window.coverage
			return { chunk, matchedTokens, phraseHit, coverage, score: coverage + (phraseHit ? 1 : 0) }
		})
		.filter(match => match.phraseHit || (queryTokens.length === 1 ? match.coverage > 0 : match.coverage >= 0.6))
		.sort((a, b) => b.score - a.score || a.chunk.start - b.chunk.start)
		.map(match => {
			const highlights = mergeRanges(match.matchedTokens.map(token => ({ start: token.start, end: token.end })))
			const start = highlights[0]?.start ?? match.chunk.start
			const end = highlights.at(-1)?.end ?? Math.min(text.length, match.chunk.start + 80)
			return { query, index: start, length: end - start, highlights }
		})
}

export function formatFindTextMatches(
	text: string,
	queries: string[],
	mode: FindMode
): { text: string; renderText: string; details: unknown } {
	const trimmedQueries = queries.map(query => query.trim()).filter(Boolean)
	const matches = trimmedQueries.flatMap(query =>
		mode === "fuzzy" ? collectFuzzyMatches(text, query) : collectLiteralMatches(text, query, mode)
	)
	const queryResults = trimmedQueries.map(query => ({ query, matchCount: matches.filter(match => match.query === query).length }))
	const snippets = mergeMatchesIntoSnippets(text, matches)
	const selected: FindSnippet[] = []
	let charsUsed = 0
	for (const snippet of snippets) {
		const remaining = FIND_TEXT_MAX_CHARS - charsUsed
		if (remaining <= 0) break
		const chars = snippetChars(snippet)
		if (chars <= remaining) {
			selected.push(snippet)
			charsUsed += chars
			continue
		}
		const clipped = clipSnippet(snippet, remaining)
		if (clipped) {
			selected.push(clipped)
			charsUsed += snippetChars(clipped)
		}
		break
	}
	const shownMatches = selected.reduce((sum, snippet) => sum + snippet.matches.length, 0)
	const noMatchQueries = queryResults.filter(result => result.matchCount === 0).map(result => `"${result.query}"`)
	const title = matches.length ? `Text matches (${mode}):` : `Text matches (${mode}): no matches`
	const body = selected.map((snippet, i) => `${i + 1}. ${formatQueryCounts(snippet.matches)}\n${formatPlainSnippet(text, snippet)}`)
	const renderBody = selected.map((snippet, i) => `${i + 1}. ${formatQueryCounts(snippet.matches)}\n${formatMarkedSnippet(text, snippet)}`)
	const noMatches = noMatchQueries.length ? `No matches: ${noMatchQueries.join(", ")}` : undefined
	if (noMatches) {
		body.push(noMatches)
		renderBody.push(noMatches)
	}
	return {
		text: body.length ? `${title}\n\n${body.join("\n\n")}` : title,
		renderText: renderBody.length ? `${title}\n\n${renderBody.join("\n\n")}` : title,
		details: {
			mode,
			contextChars: FIND_TEXT_CONTEXT_CHARS,
			snippetChars: FIND_TEXT_SNIPPET_CHARS,
			maxChars: FIND_TEXT_MAX_CHARS,
			charsUsed,
			matchCount: matches.length,
			returnedMatches: shownMatches,
			queryResults,
			snippets: selected.map(snippet => ({
				start: snippet.start,
				end: snippet.end,
				chars: snippetChars(snippet),
				matches: countQueries(snippet.matches)
			}))
		}
	}
}
