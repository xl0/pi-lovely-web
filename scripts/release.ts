/**
 * Cuts a release: verifies, rolls the changelog over, bumps `package.json`,
 * commits, tags and pushes.
 *
 *   bun run release [patch|minor|major|x.y.z] [--no-push]
 *
 * The tag push is the trigger for `.github/workflows/publish.yml`, which
 * stages the build on npm and creates the GitHub Release. Every check and the
 * verification run before anything is written; the script then pauses with
 * the changelog roll and version bump still uncommitted — the chance to
 * inspect before anything lands in history. One yes covers commit, tag and
 * push, then it waits for the staged version, asks for a 2FA code and
 * approves it; that approval is what actually publishes. `--no-push` stops at
 * the tag; nothing reaches npm until pushed.
 *
 * Writing changelog entries is a human's job, not this script's — everything
 * here is mechanical, which is what makes the unattended push acceptable.
 */

import { $ } from "bun"

const PKG = "@xl0/pi-lovely-web"
const RELEASE_FILES = ["CHANGELOG.md", "package.json"]

const die = (msg: string): never => {
	console.error(msg)
	process.exit(1)
}

const parse = (v: string) => {
	const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/)
	return m ? ([Number(m[1]), Number(m[2]), Number(m[3])] as const) : null
}

const cmp = (a: readonly number[], b: readonly number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const stageList = async () => {
	const list = await $`npm stage list ${PKG} --json`.nothrow().quiet()
	if (list.exitCode !== 0) die(`npm stage list failed:\n${list.stderr.toString()}`)
	return JSON.parse(list.stdout.toString()) as { id: string; version: string }[]
}

const args = process.argv.slice(2)
const push = !args.includes("--no-push")
const target = args.find(arg => !arg.startsWith("-")) ?? "patch"

const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim()
if (branch !== "master") die(`on ${branch}; releases are cut from master`)

// Unrelated uncommitted files are fine — the release commit stages only the
// changelog and manifest — but list them so nothing rides along unnoticed.
// Those two files themselves must be clean: their working-tree state gets
// swept into the release commit.
const dirty = (await $`git status --porcelain`.text()).split("\n").filter(line => line.trim() !== "")
if (dirty.length > 0) {
	const clashes = dirty.filter(line => RELEASE_FILES.includes(line.slice(3)))
	if (clashes.length > 0) die(`uncommitted changes to release-managed files; commit or stash first:\n${clashes.join("\n")}`)
	console.log(`worktree has uncommitted files (left alone by the release):\n${dirty.join("\n")}\n`)
}

// The approval at the end needs an npm login; check before touching anything.
if (push && (await $`npm whoami`.nothrow().quiet()).exitCode !== 0)
	die("not logged in to npm (needed to approve the staged release); run npm login first")

const pkgText = await Bun.file("package.json").text()
const current = (JSON.parse(pkgText).version ?? "") as string
const cur = parse(current) ?? die(`package.json version ${current} is not semver`)

let version: string
if (target === "patch") version = `${cur[0]}.${cur[1]}.${cur[2] + 1}`
else if (target === "minor") version = `${cur[0]}.${cur[1] + 1}.0`
else if (target === "major") version = `${cur[0] + 1}.0.0`
else {
	const explicit = parse(target) ?? die(`not a bump type or a semver version: ${target}`)
	if (cmp(explicit, cur) <= 0) die(`${target} is not greater than the current ${current}`)
	version = target
}

// Check tags and master against origin, not just the local clone: a rejected
// push would otherwise surface only after the release commit and tag exist.
await $`git fetch --quiet --tags origin`
if ((await $`git tag -l ${`v${version}`}`.text()).trim()) die(`tag v${version} already exists`)
if ((await $`git rev-list --count HEAD..origin/master`.text()).trim() !== "0") die("master is behind origin/master; pull first")

// Only a 404 means "not there"; a registry error must not pass as unpublished.
const onNpm = await $`npm view ${`${PKG}@${version}`} version`.nothrow().quiet()
if (onNpm.exitCode === 0 && onNpm.stdout.toString().trim()) die(`${version} is already published to npm`)
if (onNpm.exitCode !== 0 && !onNpm.stderr.toString().includes("E404"))
	die(`could not query npm for ${version}:\n${onNpm.stderr.toString()}`)

// The registry holds one staged build per version and `npm view` cannot see
// it, so a stage left over from an earlier attempt would be the one approved
// at the end — refuse it up front.
if (push) {
	const staged = (await stageList()).find(item => item.version === version)
	if (staged) die(`${version} is already staged on npm as ${staged.id}; npm stage reject ${staged.id} first`)
}

// The [Unreleased] body runs to the next `## [` heading; refuse a release that
// would carry no entries rather than tagging an empty section.
const changelog = await Bun.file("CHANGELOG.md").text()
const heading = "## [Unreleased]"
const start = changelog.indexOf(heading)
if (start < 0) die("CHANGELOG.md has no [Unreleased] section")
const rest = changelog.slice(start + heading.length)
const nextHeading = rest.search(/^## \[/m)
if (!/^- /m.test(nextHeading < 0 ? rest : rest.slice(0, nextHeading))) die("[Unreleased] has no entries — write the changelog first")

const date = new Date().toISOString().slice(0, 10)
const rolled = changelog.replace(`${heading}\n`, `${heading}\n\n## [${version}] - ${date}\n`)
if (rolled === changelog) die("could not roll [Unreleased] over in CHANGELOG.md")

const bumped = pkgText.replace(`"version": "${current}"`, `"version": "${version}"`)
if (bumped === pkgText) die("could not rewrite the version in package.json")

// Verify before writing anything, so a failing check leaves the tree clean.
console.log(`\n=== verifying ${version} ===\n`)
await $`bun run prepublishOnly`
await $`bun pm pack --dry-run`

await Bun.write("CHANGELOG.md", rolled)
await Bun.write("package.json", bumped)

// Pause before anything lands in history: the changelog roll and version bump
// sit in the working tree for inspection from another terminal.
console.log(`\n=== review ${version} ===\n`)
await $`git diff CHANGELOG.md package.json`
const go = prompt(`\ncommit and tag v${version}${push ? ", push, and kick off CI" : ""}? [y/N]`)
	?.trim()
	.toLowerCase()
if (go !== "y" && go !== "yes") {
	console.log(`
Nothing committed; CHANGELOG.md and package.json hold the rolled release.
Discard it, fix up, commit, and re-run:

  git checkout -- CHANGELOG.md package.json
`)
	process.exit(0)
}

console.log(`\n=== committing and tagging ${version} ===\n`)
await $`git add CHANGELOG.md package.json`
await $`git commit -m ${`chore(release): ${version}`}`
await $`git tag -a ${`v${version}`} -m ${`${PKG} ${version}`}`

if (!push) {
	console.log(`
Committed and tagged v${version}; nothing was pushed. Publish it with:

  git push --no-follow-tags origin master && git push origin v${version}

then approve the staged build: npm stage list, npm stage approve <id> --otp <code>.
`)
	process.exit(0)
}

console.log(`\n=== pushing ${version} ===\n`)
// --no-follow-tags: push exactly this release's tag, whatever push.followTags
// is set to locally. An older unpushed tag would otherwise trigger its own run.
await $`git push --no-follow-tags origin master`
await $`git push origin ${`v${version}`}`

console.log(`\n=== waiting for CI to stage ${version} on npm ===\n`)
// CI runs in under a minute; ten is a hung workflow, not a slow one.
const deadline = Date.now() + 10 * 60 * 1000
let stageId: string | undefined
while (!stageId) {
	stageId = (await stageList()).find(item => item.version === version)?.id
	if (!stageId) {
		if (Date.now() > deadline) die("timed out; check the workflow run, then npm stage list + npm stage approve <id>")
		await Bun.sleep(10_000)
		process.stdout.write(".")
	}
}
console.log(`staged as ${stageId}`)

for (let attempt = 1; ; attempt++) {
	const otp = prompt("2FA code to approve and publish:")?.trim()
	if (!otp) die(`no code entered; approve manually with: npm stage approve ${stageId}`)
	if ((await $`npm stage approve ${stageId} --otp ${otp}`.nothrow()).exitCode === 0) break
	if (attempt === 3) die(`approve manually with: npm stage approve ${stageId}`)
}

console.log(`
Approved and published v${version}.
`)
