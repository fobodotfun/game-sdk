// The game's server: sets the game up, serves the page, and checks every run before its time goes on the board.
// With no keys in the environment it runs against the SDK's in-memory copy of the API, so it works offline.
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createServerClient, createVerifier, fastestTime, GameError } from '@fobo/game-sdk/server'
import { createMockApi, TEST_PUBLIC_KEY, TEST_SECRET_KEY } from '@fobo/game-sdk/testing'
import { playRun } from './rules.js'

const PORT = 5181
const API_PATH = '/api/games/v1'
const BOARD = 'run'
const BADGE = 'clean-run'

const apiKey = process.env.FOBO_GAME_KEY
const secretKey = process.env.FOBO_GAME_SECRET
const isOffline = !apiKey || !secretKey
const mock = isOffline ? createMockApi() : null

const fobo = createServerClient({
    apiKey: isOffline ? TEST_PUBLIC_KEY : apiKey,
    secretKey: isOffline ? TEST_SECRET_KEY : secretKey,
    ...(mock ? { fetch: mock.fetch } : {}),
})

// THE setup step: boards, items and who may write scores, from code. Safe to run on every start.
await fobo.configure({
    writes: 'server',
    boards: [fastestTime(BOARD, { title: 'Fastest run' })],
    items: [{ key: BADGE, name: 'Clean run', kind: 'badge' }],
})

// tickets, single use, the player check, the replay and posting the score: all inside the verifier
const verifier = createVerifier({ server: fobo, board: BOARD, replay: (seed, lanes) => playRun(seed, lanes) })

const FILES = {
    '/': ['./index.html', 'text/html; charset=utf-8'],
    '/rules.js': ['./rules.js', 'text/javascript; charset=utf-8'],
    '/sdk.js': [import.meta.resolve('@fobo/game-sdk/browser'), 'text/javascript; charset=utf-8'],
}

/** Node's request as the web Request the SDK's handlers take. */
async function toRequest(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    return new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: req.headers,
        ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
    })
}

/** Checks a run, then gives the badge to a player whose best run hit nothing. */
async function verify(request) {
    const response = await verifier.handle(request)
    if (!response.ok) return response
    const { you } = await response.clone().json()
    if (you?.meta?.hits !== 0) return response
    try {
        await fobo.grantItem(you.name, BADGE)
    } catch (err) {
        // they earned it on an earlier run: nothing to do
        if (!(err instanceof GameError && err.apiCode === 'already_owned')) console.error('[time-trial]', err.message)
    }
    return response
}

/** Offline only: this server stands in for fobo.fun's API. */
async function mockApi(request, url) {
    const text = await request.text()
    const { status, body } = await mock.handle({
        method: request.method,
        path: url.pathname.slice(API_PATH.length),
        query: url.searchParams,
        headers: Object.fromEntries(request.headers),
        body: text === '' ? undefined : JSON.parse(text),
        host: url.host,
    })
    return Response.json(body, { status })
}

async function route(request) {
    const url = new URL(request.url)
    if (url.pathname === '/verify') return verify(request)
    if (mock && url.pathname.startsWith(API_PATH)) return mockApi(request, url)
    if (url.pathname === '/config.js') {
        // the page gets the PUBLIC key only: the secret key stays in this process
        const config = { apiKey: isOffline ? TEST_PUBLIC_KEY : apiKey, isOffline }
        return new Response(`export default ${JSON.stringify(config)}`, {
            headers: { 'Content-Type': FILES['/rules.js'][1] },
        })
    }
    const [file, type] = FILES[url.pathname] ?? []
    if (!file) return new Response('Not found', { status: 404 })
    const content = await readFile(fileURLToPath(new URL(file, import.meta.url)))
    return new Response(content, { headers: { 'Content-Type': type } })
}

createServer(async (req, res) => {
    let response
    try {
        response = await route(await toRequest(req))
    } catch (err) {
        console.error('[time-trial]', err.message)
        response = new Response('Server error. Did you run `pnpm build` in the repo root?', { status: 500 })
    }
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
}).listen(PORT, () => console.log(`http://localhost:${PORT}${isOffline ? ' (offline: no keys set)' : ''}`))
