import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { completeSimple, getModel } from "@earendil-works/pi-ai/compat"
import { SMART_QUERY_SYSTEM_PROMPT } from "../extensions/lovely-web/smart.js"

interface PromptCase {
	id: string
	url: string
	query: string
	mustInclude?: string[]
	warnIfIncludes?: string[]
}

const DEFAULT_MODEL = "openai-codex/gpt-5.6-luna"
const DEFAULT_MAX_TOKENS = 2400

const cases: PromptCase[] = [
	{
		id: "summary-github-contents-agent",
		url: "https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28",
		query:
			"Summarize this page for a coding agent implementing read/update/delete of repository files. Focus on endpoints, required fields, permissions, limits, media types, and gotchas. Keep it concise.",
		mustInclude: ["GET /repos/{owner}/{repo}/contents/{path}", "1,000", "Contents"]
	},
	{
		id: "verbatim-svelte-raw-example",
		url: "https://svelte.dev/docs/svelte/$state",
		query:
			"Find a code example demonstrating $state.raw. Return the most relevant code block verbatim first, preserving indentation. Then add a one sentence source context.",
		mustInclude: ["```svelte", "$state.raw([0])", "items = [...items, items.length]"]
	},
	{
		id: "cli-vite-cookbook",
		url: "https://vite.dev/guide/",
		query:
			"Extract the documented CLI commands to scaffold, install, run dev, and build a Vite app. Return commands verbatim with a short purpose for each.",
		mustInclude: ["npm create vite@latest", "npm install -D vite", "vite build"]
	},
	{
		id: "troubleshoot-node-exported",
		url: "https://nodejs.org/api/errors.html",
		query:
			"Troubleshoot ERR_PACKAGE_PATH_NOT_EXPORTED. Extract directly stated meaning/cause and any fix/workaround if stated. Say what is not found.",
		mustInclude: ["ERR_PACKAGE_PATH_NOT_EXPORTED", "exports", "Not found"]
	},
	{
		id: "config-ts-module-resolution-table",
		url: "https://www.typescriptlang.org/tsconfig/moduleResolution.html",
		query:
			"Create a compact comparison table of moduleResolution modes. Include when to use each mode and notable caveats directly stated on the page.",
		mustInclude: ["node16", "nodenext", "bundler", "classic"]
	},
	{
		id: "security-python-subprocess-checklist",
		url: "https://docs.python.org/3/library/subprocess.html",
		query:
			"Create a security checklist for using subprocess safely. Include shell=True, metacharacter quoting, Windows batch caveat, and anything the page directly states.",
		mustInclude: ["shell=True", "metacharacters", "Windows"]
	},
	{
		id: "missing-react-usememo",
		url: "https://react.dev/reference/react/useMemo",
		query:
			"Find the default cache size for useMemo and whether it is LRU. If not directly stated, say Not found on page. Also summarize directly stated cache caveats.",
		mustInclude: ["Not found on page", "LRU", "cache"]
	},
	{
		id: "node-fs-readfile",
		url: "https://nodejs.org/api/fs.html",
		query:
			"For fsPromises.readFile, extract directly stated behavior for AbortSignal support and reading a directory path. Include platform differences if stated.",
		mustInclude: ["AbortSignal", "FreeBSD", "directory"]
	},
	{
		id: "github-contents-api",
		url: "https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28",
		query:
			"For GitHub REST contents API, extract directly stated limits/behaviors for file size, directory listing size, and media types. Include auth/permission requirements only if stated on the page.",
		mustInclude: ["100 MB", "1,000", "application/vnd.github.object+json"]
	},
	{
		id: "svelte-state",
		url: "https://svelte.dev/docs/svelte/$state",
		query:
			"Extract directly stated behavior of $state deep reactivity, $state.raw, and $state.snapshot. Include caveats about classes or non-plain objects if stated.",
		mustInclude: ["deeply reactive", "$state.raw", "$state.snapshot", "Class instances"]
	},
	{
		id: "pf-gru-payment",
		url: "https://www.gov.br/pf/pt-br/assuntos/imigracao/lei-de-migracao",
		query:
			"Does this page directly explain how to pay immigration fines or generate a GRU? Extract only directly stated payment/GRU facts and say what is not found on page.",
		mustInclude: ["GRU", "Not found"]
	},
	{
		id: "decree-art-307",
		url: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2017/decreto/d9199.htm",
		query:
			"Extract Art. 307 provisions on staying after migratory document expires or excess of authorized stay, including fine ranges if present.",
		mustInclude: ["Art. 307", "multa por dia", "R$ 100,00"]
	}
]

function argValue(name: string): string | undefined {
	const prefix = `--${name}=`
	const inline = process.argv.find(arg => arg.startsWith(prefix))
	if (inline) return inline.slice(prefix.length)
	const index = process.argv.indexOf(`--${name}`)
	return index >= 0 ? process.argv[index + 1] : undefined
}

function hasArg(name: string): boolean {
	return process.argv.includes(`--${name}`)
}

function readJson(path: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
	} catch {
		return undefined
	}
}

function resolveFirecrawlKey(): string {
	if (process.env["FIRECRAWL_API_KEY"]) return process.env["FIRECRAWL_API_KEY"]
	for (const path of [join(process.env["HOME"] ?? "", ".pi/agent/xl0-pi-lovely-web.json"), ".pi/xl0-pi-lovely-web.json"]) {
		const value = readJson(path)?.["firecrawlApiKey"]
		if (typeof value === "string" && value) return value
	}
	throw new Error("Missing Firecrawl key. Set FIRECRAWL_API_KEY or configure lovely-web.")
}

function resolveModelAuth(provider: string): string {
	const auth = readJson(join(process.env["HOME"] ?? "", ".pi/agent/auth.json"))?.[provider]
	if (!auth || typeof auth !== "object") throw new Error(`Missing auth for ${provider} in ~/.pi/agent/auth.json`)
	const entry = auth as { access?: unknown; key?: unknown }
	if (typeof entry.access === "string") return entry.access
	if (typeof entry.key === "string") return entry.key
	throw new Error(`Missing usable auth token for ${provider} in ~/.pi/agent/auth.json`)
}

function cachePath(url: string): string {
	return join("test/smart-cache", `${encodeURIComponent(url)}.md`)
}

async function scrape(url: string, firecrawlKey: string, refresh: boolean): Promise<string> {
	const path = cachePath(url)
	if (!refresh && existsSync(path)) return readFileSync(path, "utf8")
	const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${firecrawlKey}` },
		body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true })
	})
	if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${await res.text()}`)
	const json = (await res.json()) as { data?: { markdown?: string } }
	const markdown = json.data?.markdown ?? ""
	mkdirSync("test/smart-cache", { recursive: true })
	writeFileSync(path, markdown)
	return markdown
}

function responseText(response: Awaited<ReturnType<typeof completeSimple>>): string {
	return response.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text")
		.map(item => item.text)
		.join("\n")
		.trim()
}

function checkOutput(testCase: PromptCase, output: string): string[] {
	const warnings: string[] = []
	for (const text of testCase.mustInclude ?? []) {
		if (!output.includes(text)) warnings.push(`missing expected text: ${text}`)
	}
	for (const text of testCase.warnIfIncludes ?? []) {
		if (output.includes(text)) warnings.push(`contains unwanted text: ${text}`)
	}
	const sourceRepeats = output.split(testCase.url).length - 1
	if (sourceRepeats > 0) warnings.push(`repeated source URL ${sourceRepeats} time(s)`)
	return warnings
}

function selectedCases(): PromptCase[] {
	if (hasArg("list")) {
		for (const testCase of cases) console.log(testCase.id)
		process.exit(0)
	}
	const ids = argValue("case")?.split(",").filter(Boolean)
	const limit = Number(argValue("limit") ?? "0")
	const picked = ids?.length ? cases.filter(testCase => ids.includes(testCase.id)) : cases
	return limit > 0 ? picked.slice(0, limit) : picked
}

const modelName = argValue("model") ?? DEFAULT_MODEL
const separator = modelName.indexOf("/")
if (separator <= 0) throw new Error(`Model must be provider/model, got ${modelName}`)
const provider = modelName.slice(0, separator)
const modelId = modelName.slice(separator + 1)
const model = getModel(provider as Parameters<typeof getModel>[0], modelId as never)
const modelAuth = resolveModelAuth(provider)
const firecrawlKey = resolveFirecrawlKey()
const maxTokens = Number(argValue("max-tokens") ?? DEFAULT_MAX_TOKENS)
const refresh = hasArg("refresh")
const pickedCases = selectedCases()
const runId = new Date().toISOString().replace(/[:.]/g, "-")
const resultDir = join("test/smart-results", runId)
mkdirSync(resultDir, { recursive: true })

let totalCost = 0
let warningCount = 0

for (const testCase of pickedCases) {
	console.log(`\n## ${testCase.id}`)
	try {
		const page = await scrape(testCase.url, firecrawlKey, refresh)
		const prompt = `Smart query:\n${testCase.query}\n\nSource URL:\n${testCase.url}\n\nResult text:\n${page}`
		const response = await completeSimple(
			model,
			{
				systemPrompt: SMART_QUERY_SYSTEM_PROMPT,
				messages: [{ role: "user", content: prompt, timestamp: Date.now() }]
			},
			{ apiKey: modelAuth, maxTokens }
		)
		const output = responseText(response) || response.errorMessage || ""
		const cost = response.usage?.cost?.total ?? 0
		totalCost += cost
		const warnings = checkOutput(testCase, output)
		warningCount += warnings.length
		writeFileSync(join(resultDir, `${testCase.id}.md`), output)
		console.log(`chars=${page.length} stop=${response.stopReason} cost=${cost}`)
		for (const warning of warnings) console.log(`WARN: ${warning}`)
		console.log(output.slice(0, 6000))
	} catch (error) {
		warningCount++
		console.log(`ERROR: ${error instanceof Error ? error.stack : String(error)}`)
	}
}

console.log(`\nResults: ${resultDir}`)
console.log(`Total cost: ${totalCost}`)
console.log(`Warnings: ${warningCount}`)
if (hasArg("fail-warnings") && warningCount > 0) process.exit(1)
