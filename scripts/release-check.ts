/**
 * Everything to look at before a release, in one run: packs the package the way `npm publish` would, then checks
 * what is inside. It never publishes. Run it with `pnpm release:check`.
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { publint } from 'publint'
import { formatMessage } from 'publint/utils'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
/** The one package this repo publishes. */
const PACKAGE_DIR = 'game-sdk'
const PACKAGE_NAME = '@fobo/game-sdk'
/** What every package.json must say. */
const REQUIRED_FIELDS = [
    'name',
    'version',
    'description',
    'license',
    'author',
    'repository',
    'homepage',
    'bugs',
    'keywords',
    'files',
    'exports',
    'types',
    'sideEffects',
    'engines',
]
const REQUIRED_FILES = [
    'package.json',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'llms.txt',
    'assets/logo.png',
    'docs/api-v1.md',
    'dist/index.js',
    'dist/index.d.ts',
]
/** Where a published file is served from: what the README links to, since the repository is private. */
const CDN = 'https://unpkg.com/'
/** A link or picture address in markdown or HTML. */
const LINK = /\]\(([^)\s]+)\)|(?:src|href)="([^"]+)"/g
/** Addresses an outsider cannot open while the repository is private. */
const PRIVATE_LINK = /github\.com\/fobodotfun|raw\.githubusercontent\.com/
/** Paths that must never be in a package. */
const FORBIDDEN_PATHS = [
    /(^|\/)src\//,
    /(^|\/)test\//,
    /\.test\./,
    /\.spec\./,
    /\.map$/,
    /(^|\/)\.env/,
    /tsconfig/,
    /\.tsbuildinfo$/,
]
/** Text that must never be in a package: this machine's paths, keys, source map links. */
const FORBIDDEN_TEXT: [RegExp, string][] = [
    [/\/Users\/[a-z]/, 'a local path'],
    [/\/home\/[a-z]+\//, 'a local path'],
    [/sk_live_[A-Za-z0-9]/, 'a secret key'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
    [/npm_[A-Za-z0-9]{36}/, 'an npm token'],
    [/\/\/# sourceMappingURL=(?!data:)/, 'a link to a source map that is not shipped'],
]
/** The test keys (in /testing and the docs) are public on purpose. */
const TEXT_FILE = /\.(js|ts|json|md|txt)$/
/** Entry points a page may load: none of them may be able to send the secret key. */
const PAGE_ENTRIES = [
    'dist/index.js',
    'dist/format.js',
    'dist/protocol.js',
    'dist/reown.js',
    'dist/privy.js',
    'dist/wagmi.js',
]
/** The entries that must work with no wallet library installed. */
const CORE_ENTRIES = ['dist/index.js', 'dist/format.js', 'dist/protocol.js', 'dist/server.js', 'dist/testing.js']
/** An import of anything that is not the package's own file or Node itself. */
const OUTSIDE_IMPORT = /(?:from|import)\s*["'](?!\.|node:)([^"']+)["']/
/** Each connector, and the libraries one of which Node must name when it is imported without them. */
const CONNECTORS: Record<string, string[]> = {
    reown: ['@reown/appkit', '@reown/appkit-adapter-ethers'],
    privy: ['@privy-io/react-auth', 'react'],
    wagmi: ['@wagmi/core', 'viem'],
}
const SECRET_KEY_MARK = 'Bearer '
/** Words the docs do not use (see RELEASING.md). */
const DOC_WORDS = /\b(bundlers?|bundles?|bundled|guaranteed?)\b/i
const KB = 1024
/**
 * Advisories looked at and accepted, each with the reason. The package has no dependencies, so these can only come
 * from a wallet library a connector is built on (and is inside the no-build-step Reown file). Remove an entry as soon as the library ships a fix.
 */
const ACCEPTED_ADVISORIES: Record<string, string> = {
    'GHSA-mrhx-c7xc-m3w5':
        "zod 3 inside Reown AppKit and Privy, used on their own data in the player's browser; fixed only in zod 4.6.6, which they do not use yet",
}

interface Advisory {
    github_advisory_id: string
    severity: string
    module_name: string
    title: string
}

const problems: string[] = []
const fail = (name: string, message: string): void => void problems.push(`${name}: ${message}`)
const kb = (bytes: number): string => `${(bytes / KB).toFixed(1)} kB`

async function filesUnder(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => relative(dir, join(entry.parentPath, entry.name)))
}

/** Every file a page entry pulls in, following its relative imports. */
async function reachable(dir: string, entry: string, seen = new Set<string>()): Promise<Set<string>> {
    if (seen.has(entry)) return seen
    seen.add(entry)
    const code = await readFile(join(dir, entry), 'utf8')
    for (const [, path] of code.matchAll(/from\s*["'](\.[^"']+)["']/g)) {
        if (path) await reachable(dir, join(entry, '..', path), seen)
    }
    return seen
}

/**
 * Every link in a published text must open for someone who only has the package: a full https address (never the
 * private repository), or a file inside the package. A link to the package's own files names this exact version.
 */
function checkLinks(name: string, file: string, text: string, files: string[], version: string): void {
    const own = `${CDN}${PACKAGE_NAME}@`
    for (const match of text.matchAll(LINK)) {
        const link = (match[1] ?? match[2] ?? '').split('#')[0] ?? ''
        if (link === '') continue
        if (PRIVATE_LINK.test(link)) fail(name, `${file} links to the private repository: ${link}`)
        else if (link.startsWith(own)) {
            const [linked = '', ...path] = link.slice(own.length).split('/')
            if (linked !== version) fail(name, `${file} links to version ${linked}, the package is ${version}: ${link}`)
            if (!files.includes(path.join('/')))
                fail(name, `${file} links to a file the package does not have: ${link}`)
        } else if (!/^(https:|mailto:)/.test(link)) {
            if (file === 'README.md') fail(name, `README.md has a relative link (npmjs.com cannot follow it): ${link}`)
            else if (!files.includes(join(file, '..', link))) fail(name, `${file} links to a missing file: ${link}`)
        }
    }
}

async function checkPackage(name: string, outDir: string): Promise<string> {
    const dir = join(ROOT, 'packages', name)
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
    for (const field of REQUIRED_FIELDS) if (manifest[field] === undefined) fail(name, `package.json has no "${field}"`)
    if (manifest.type !== 'module') fail(name, 'package.json must say "type": "module"')
    if ((manifest.publishConfig as { access?: string } | undefined)?.access !== 'public')
        fail(name, 'publishConfig.access must be "public"')
    if (manifest.private === true) fail(name, 'is marked private')
    if (manifest.name !== PACKAGE_NAME) fail(name, `the package must be named ${PACKAGE_NAME}`)
    if (Object.keys((manifest.dependencies as object | undefined) ?? {}).length > 0)
        fail(name, 'the package must have no runtime dependencies')
    const optional = (manifest.peerDependenciesMeta ?? {}) as Record<string, { optional?: boolean }>
    for (const peer of Object.keys((manifest.peerDependencies as object | undefined) ?? {}))
        if (optional[peer]?.optional !== true) fail(name, `the peer ${peer} must be optional`)

    // packed by pnpm, exactly as it would be published (workspace: versions become real ones)
    const packDir = join(outDir, name)
    execFileSync('pnpm', ['pack', '--pack-destination', packDir], { cwd: dir, stdio: 'pipe' })
    const tarball = join(packDir, (await readdir(packDir)).find((file) => file.endsWith('.tgz')) ?? '')
    const unpacked = join(packDir, 'unpacked')
    await mkdir(unpacked, { recursive: true })
    execFileSync('tar', ['-xzf', tarball, '-C', unpacked])
    const content = join(unpacked, 'package')
    const files = await filesUnder(content)

    for (const file of REQUIRED_FILES) if (!files.includes(file)) fail(name, `the package has no ${file}`)
    for (const file of files) {
        if (FORBIDDEN_PATHS.some((pattern) => pattern.test(file))) fail(name, `${file} must not be published`)
        if (!TEXT_FILE.test(file)) continue
        const text = await readFile(join(content, file), 'utf8')
        for (const [pattern, what] of FORBIDDEN_TEXT) if (pattern.test(text)) fail(name, `${file} contains ${what}`)
        if (file.endsWith('.md') || file === 'llms.txt') {
            const word = DOC_WORDS.exec(text)
            if (word) fail(name, `${file} uses the word "${word[0]}"`)
            checkLinks(name, file, text, files, manifest.version as string)
        }
    }
    const packed = JSON.parse(await readFile(join(content, 'package.json'), 'utf8')) as Record<string, unknown>
    if (JSON.stringify(packed).includes('workspace:'))
        fail(name, 'the packed package.json still has a workspace: version')

    for (const entry of PAGE_ENTRIES) {
        for (const file of await reachable(content, entry)) {
            const code = await readFile(join(content, file), 'utf8')
            if (code.includes(SECRET_KEY_MARK)) fail(name, `${entry} reaches ${file}, which can send the secret key`)
        }
    }
    for (const entry of CORE_ENTRIES) {
        for (const file of await reachable(content, entry)) {
            const outside = OUTSIDE_IMPORT.exec(await readFile(join(content, file), 'utf8'))
            if (outside)
                fail(name, `${entry} reaches ${file}, which imports ${outside[1] ?? ''}: the core imports nothing`)
        }
    }
    let guarded = false
    for (const file of await reachable(content, 'dist/server.js'))
        guarded ||= (await readFile(join(content, file), 'utf8')).includes('servers only')
    if (!guarded) fail(name, 'dist/server.js lost its check against running in a page')
    await checkImports(name, content, packDir, packed)

    const { messages, pkg } = await publint({
        pack: { tarball: (await readFile(tarball)).buffer as ArrayBuffer },
        strict: true,
    })
    for (const message of messages) fail(name, `publint: ${formatMessage(message, pkg, { color: false })}`)

    try {
        execFileSync('pnpm', ['exec', 'attw', tarball, '--profile', 'esm-only', '--no-emoji'], {
            cwd: ROOT,
            stdio: 'pipe',
        })
    } catch (err) {
        const output = (err as { stdout?: Buffer }).stdout?.toString() ?? String(err)
        fail(name, `are the types wrong:\n${output}`)
    }

    const sizes = [`${manifest.name as string}@${manifest.version as string}`]
    sizes.push(`    package   ${kb((await stat(tarball)).size)} packed, ${files.length} files`)
    for (const file of files.filter((path) => /^dist\/[^/]+\.js$|^dist\/browser\/[^/]+\.js$/.test(path)).sort()) {
        const code = await readFile(join(content, file))
        sizes.push(
            `    ${file.padEnd(40)} ${kb(code.length).padStart(10)}  ${kb(gzipSync(code).length).padStart(9)} gzip`
        )
    }
    return sizes.join('\n')
}

/**
 * Installs the unpacked package alone, with no wallet library beside it, and imports every subpath the way a game
 * would: the core ones must load, and each connector must stop with Node's error naming the library to install.
 */
async function checkImports(
    name: string,
    content: string,
    packDir: string,
    packed: Record<string, unknown>
): Promise<void> {
    const home = join(packDir, 'app')
    const installed = join(home, 'node_modules', '@fobo')
    await mkdir(installed, { recursive: true })
    await cp(content, join(installed, 'game-sdk'), { recursive: true })
    const subpaths = Object.keys(packed.exports as Record<string, unknown>).filter((key) => key !== './package.json')
    const connectorPaths = Object.keys(CONNECTORS).flatMap((key) => [`./${key}`, `./browser/${key}`])
    const script = `
        const failures = []
        for (const subpath of ${JSON.stringify(subpaths)}) {
            const specifier = '${PACKAGE_NAME}' + subpath.slice(1)
            try { import.meta.resolve(specifier) } catch (err) { failures.push(specifier + ' does not resolve: ' + err.message) }
            if (${JSON.stringify(connectorPaths)}.includes(subpath)) continue
            // /browser is a page's file: it loads in Node too, since nothing in it touches the page until used
            try { await import(specifier) } catch (err) { failures.push(specifier + ' does not load: ' + err.message) }
        }
        for (const [key, libraries] of Object.entries(${JSON.stringify(CONNECTORS)})) {
            try {
                await import('${PACKAGE_NAME}/' + key)
                failures.push(key + ' loaded with no wallet library installed')
            } catch (err) {
                if (!libraries.some((library) => err.message.includes("'" + library + "'")))
                    failures.push(key + ' failed without naming its library: ' + err.message)
            }
        }
        console.log(JSON.stringify(failures))
    `
    await writeFile(join(home, 'check.mjs'), script)
    const output = execFileSync('node', ['check.mjs'], { cwd: home, stdio: 'pipe' }).toString()
    for (const failure of JSON.parse(output.trim().split('\n').at(-1) ?? '[]') as string[]) fail(name, failure)
}

/** Known advisories in what the packages are built from. Anything not accepted by name in ACCEPTED_ADVISORIES fails. */
function audit(): string {
    let output: string
    try {
        output = execFileSync('pnpm', ['audit', '--json'], { cwd: ROOT, stdio: 'pipe' }).toString()
    } catch (err) {
        // pnpm audit exits with 1 when it finds something: the findings are still on stdout
        output = (err as { stdout?: Buffer }).stdout?.toString() ?? ''
        if (!output) throw err
    }
    const { advisories = {} } = JSON.parse(output) as { advisories?: Record<string, Advisory> }
    const lines: string[] = []
    for (const advisory of Object.values(advisories)) {
        const id = advisory.github_advisory_id
        const label = `${id} (${advisory.severity}) ${advisory.module_name}: ${advisory.title}`
        const reason = ACCEPTED_ADVISORIES[id]
        if (reason) lines.push(`    accepted  ${label}\n              ${reason}`)
        else fail('pnpm audit', label)
    }
    return `pnpm audit: ${Object.keys(advisories).length} advisories\n${lines.join('\n')}`.trimEnd()
}

async function main(): Promise<void> {
    const outDir = await mkdtemp(join(tmpdir(), 'fobo-game-sdk-pack-'))
    const reports: string[] = []
    try {
        reports.push(await checkPackage(PACKAGE_DIR, outDir))
        reports.push(audit())
    } finally {
        await rm(outDir, { recursive: true, force: true })
    }
    console.log(reports.join('\n\n'))
    if (problems.length > 0) {
        console.error(`\n[release-check] ${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
        process.exitCode = 1
        return
    }
    console.log('\nrelease:check passed. Nothing was published: see RELEASING.md for the manual steps.')
}

await main()
