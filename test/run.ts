import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { CONFIG_FILE_NAME } from "../extensions/lovely-web/config.js"
import { loadTestEnv } from "./env.js"

interface TestCase {
	id: string
	tool: string
	args: Record<string, unknown>
	providers: string[]
}

interface CaseResult {
	caseId: string
	provider: string
	sessionPath: string
	status: string
	output: string
}

loadTestEnv(join(import.meta.dirname, ".env"))

const cases = JSON.parse(readFileSync(join(import.meta.dirname, "cases.json"), "utf-8")) as TestCase[]
const projectRoot = resolve(import.meta.dirname, "..")
const refDir = join(import.meta.dirname, "references")
const sessionsDir = join(import.meta.dirname, "sessions")
const runId = new Date().toISOString().replace(/[:.]/g, "-")
const runSessionsDir = join(sessionsDir, runId)
const configPath = join(projectRoot, ".pi", CONFIG_FILE_NAME)

function writePerCaseConfig(provider: string) {
	mkdirSync(join(projectRoot, ".pi"), { recursive: true })
	writeFileSync(
		configPath,
		`${JSON.stringify({ webSearchProvider: provider, webFetchProvider: provider === "brave" ? "disabled" : provider }, null, 2)}\n`,
		"utf-8"
	)
}

const systemPrompt = [
	"You are a test validator.",
	"Use only the read, web_search, and web_fetch tools.",
	"You have NO other tools available.",
	"Follow instructions exactly."
].join(" ")

function runPi(
	args: string[],
	timeout: number
): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; error?: Error }> {
	return new Promise(resolve => {
		const child = spawn("pi", args, {
			cwd: projectRoot,
			env: { ...process.env },
			timeout,
			stdio: ["ignore", "pipe", "pipe"]
		})
		let stdout = ""
		let stderr = ""
		child.stdout?.on("data", d => {
			stdout += d.toString()
		})
		child.stderr?.on("data", d => {
			stderr += d.toString()
		})
		child.on("error", err => resolve({ stdout, stderr, code: null, signal: null, error: err }))
		child.on("close", (code, signal) => resolve({ stdout, stderr, code, signal }))
	})
}

function parseVerdict(stdout: string): { verdict: string; tail: string } {
	const lines = stdout
		.split("\n")
		.map(l => l.trim())
		.filter(Boolean)
	const last = lines.at(-1) ?? ""
	const verdict = last === "OK" || last.startsWith("FAIL:") ? last : ""
	const tail = lines.slice(-3).join("\n")
	return { verdict, tail }
}

async function runCase(c: TestCase, provider: string): Promise<CaseResult> {
	const refPath = join(refDir, `ref-${c.id}.txt`)
	const sessionFile = join(runSessionsDir, `${c.id}-${provider}.jsonl`)
	const sessionPath = relative(projectRoot, sessionFile)
	if (!existsSync(refPath)) return { caseId: c.id, provider, sessionPath, status: "SKIP", output: "reference file not found" }

	const argsStr = Object.entries(c.args)
		.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
		.join(" ")

	const expected =
		c.tool === "search" && c.args["fetchResult"] === true
			? `The output must be a numbered result list with ${c.args["limit"] ?? 5} top-level results. Each result must use concise fields like title/url, and the first result may include a markdown field with meaningful fetched page content. Do not fail solely because markdown is absent. Bullets inside desc/markdown fields are content, not result boundaries. It must not be an error.`
			: c.tool === "search"
				? `The output must be a numbered result list with ${c.args["limit"] ?? 5} top-level results. Each result must use concise fields like title/url/desc. Bullets inside desc fields are content, not result boundaries. It must not be an error.`
				: "The output must be fetched markdown with meaningful page content. It must not be an error. Do not require the same headings, links, or article text as the reference."

	const testPrompt = [
		`Read the file test/references/ref-${c.id}.txt. Then use ${c.tool === "search" ? "web_search" : "web_fetch"} with ${argsStr}.`,
		`Compare formatting and structure against the reference, not provider-specific content. ${expected}`,
		`Reply with exactly: OK or FAIL: <brief reason>`
	].join("\n")

	mkdirSync(runSessionsDir, { recursive: true })
	const { stdout, stderr, code, signal, error } = await runPi(
		[
			"-p",
			"--model",
			"accounts/fireworks/models/kimi-k2p6",
			"--system-prompt",
			systemPrompt,
			"--no-context-files",
			"--session-dir",
			sessionsDir,
			"--session",
			sessionFile,
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--tools",
			"read,web_search,web_fetch",
			"-e",
			"extensions/lovely-web/index.ts",
			testPrompt
		],
		120_000
	)

	if (error) return { caseId: c.id, provider, sessionPath, status: "ERROR", output: error.message }
	if (signal) return { caseId: c.id, provider, sessionPath, status: "ERROR", output: `pi exited by signal ${signal}` }
	if (code !== 0) {
		const debug = stderr.trim() || stdout.trim() || "no output"
		return { caseId: c.id, provider, sessionPath, status: "ERROR", output: `pi exited with code ${code}: ${debug}` }
	}

	const trimmed = stdout.trim()
	const { verdict, tail } = parseVerdict(trimmed)

	if (verdict.startsWith("OK")) {
		return { caseId: c.id, provider, sessionPath, status: "PASS", output: verdict }
	}
	if (verdict.startsWith("FAIL")) {
		return { caseId: c.id, provider, sessionPath, status: "FAIL", output: verdict }
	}

	const debug = `No verdict. Last output:\n    ${tail.replace(/\n/g, "\n    ")}${stderr.trim() ? `\n  stderr:\n    ${stderr.trim().replace(/\n/g, "\n    ")}` : ""}`
	return { caseId: c.id, provider, sessionPath, status: "UNCLEAR", output: debug }
}

const allResults: CaseResult[] = []
let passed = 0
let failed = 0

console.log(`Test session run: ${runId}`)
console.log(`Sessions directory: ${runSessionsDir}`)

try {
	for (const c of cases) {
		process.stdout.write(`Running ${c.providers.length} providers for ${c.id}...\n`)

		for (const provider of c.providers) {
			writePerCaseConfig(provider)
			const r = await runCase(c, provider)
			const line = `  ${r.caseId} (${r.provider}) session ${r.sessionPath} ${r.status}`

			if (r.status === "PASS") {
				console.log(line)
				passed++
			} else if (r.status === "FAIL") {
				console.log(`${line}: ${r.output}`)
				failed++
			} else if (r.status === "ERROR") {
				console.log(`${line}: ${r.output}`)
				failed++
			} else if (r.status === "SKIP") {
				console.log(`${line}: ${r.output}`)
				failed++
			} else {
				console.log(`${line}:\n    ${r.output.replace(/\n/g, "\n    ")}`)
				failed++
			}
			allResults.push(r)
		}
	}
} finally {
	try {
		rmSync(configPath, { force: true })
	} catch {
		/* ok */
	}
}

console.log(`\n───\nResults: ${passed} passed, ${failed} failed, ${allResults.length} total`)

process.exit(failed > 0 ? 1 : 0)
