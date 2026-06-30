import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { lovelyWebConfigSpec, providers, resolveApiKey, type WebToolsConfig } from "../extensions/lovely-web/config.js"
import { DEFAULT_TIMEOUT_MS } from "../extensions/lovely-web/constants.js"
import { formatSearchOutput } from "../extensions/lovely-web/format.js"
import type { SearchOptions } from "../extensions/lovely-web/providers/types.js"
import { loadTestEnv } from "./env.js"

interface TestCase {
	id: string
	tool: string
	args: Record<string, unknown>
	providers: string[]
}

loadTestEnv(join(import.meta.dirname, ".env"))

const cases = JSON.parse(readFileSync(join(import.meta.dirname, "cases.json"), "utf-8")) as TestCase[]

const refDir = join(import.meta.dirname, "references")
mkdirSync(refDir, { recursive: true })

let failed = 0

for (const c of cases) {
	const config: WebToolsConfig = {
		...lovelyWebConfigSpec.defaults,
		webSearchProvider: "tavily",
		webFetchProvider: "tavily"
	}

	console.log(`Updating reference: ${c.id} (${c.tool})`)

	try {
		let text: string
		const args = c.args
		const provider = providers["tavily"]
		if (!provider) throw new Error("Tavily provider not found")
		const apiKey = resolveApiKey(provider, config)
		if (c.tool === "search") {
			const options: SearchOptions = { limit: (args["limit"] as number | undefined) ?? 5, timeout: DEFAULT_TIMEOUT_MS }
			const result = await provider.search(apiKey, args["query"] as string, options)
			if (args["fetchResult"] === true && result.results[0]?.url) {
				const fetched = await provider.fetch?.(apiKey, result.results[0].url, { timeout: DEFAULT_TIMEOUT_MS })
				if (fetched) result.results[0].markdown = fetched.markdown
			}
			text = formatSearchOutput(result.results)
		} else if (c.tool === "fetch") {
			const result = await provider.fetch?.(apiKey, args["url"] as string, { timeout: DEFAULT_TIMEOUT_MS })
			text = result?.markdown ?? ""
		} else {
			console.error(`  Unknown tool: ${c.tool}`)
			failed++
			continue
		}
		const refPath = join(refDir, `ref-${c.id}.txt`)
		writeFileSync(refPath, text)
		console.log(`  → wrote ${refPath} (${text.length} chars)`)
	} catch (err) {
		failed++
		console.error(`  ✗ FAILED: ${err instanceof Error ? err.message : String(err)}`)
	}
}

console.log(`\nDone. ${failed} failed.`)
process.exit(failed > 0 ? 1 : 0)
