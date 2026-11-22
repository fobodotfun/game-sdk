/**
 * The three sites the browser tests need, in one process: a stand-in for fobo.fun (the framing page, its wallet
 * and the Game Center API with real signature checks), the game's own site, and a stranger that frames the game.
 */
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { API_BASE, KEY_HEADER, SDK_HEADER, SESSION_HEADER } from '@fobo/game-sdk/protocol'
import { createMockApi } from '@fobo/game-sdk/testing'
import { FOBO_ORIGIN, FOBO_PORT, GAME_ORIGIN, GAME_PORT, STRANGER_PORT, WALLET_KEY } from './ports.ts'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const SDK_DIST = fileURLToPath(new URL('../packages/game-sdk/dist/', import.meta.url))
const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json',
}
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': `Content-Type, Authorization, ${KEY_HEADER}, ${SESSION_HEADER}, ${SDK_HEADER}`,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}

const wallet = privateKeyToAccount(WALLET_KEY)
const api = createMockApi({
    verify: ({ address, signature, message }) =>
        verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` }),
})

/** A request's body: parsed JSON, or the bytes of an upload (a picture). */
async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const bytes = Buffer.concat(chunks)
    if (req.headers['content-type']?.startsWith('image/')) return new Uint8Array(bytes)
    const text = bytes.toString('utf8')
    return text === '' ? undefined : JSON.parse(text)
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
}

/** Serves a file from `root`; pages get the two origins filled in. */
async function sendFile(res: ServerResponse, root: string, path: string): Promise<void> {
    const file = normalize(join(root, path))
    if (!file.startsWith(root)) return send(res, 403, { error: 'Forbidden' })
    let content: string
    try {
        content = await readFile(file, 'utf8')
    } catch {
        return send(res, 404, { error: 'Not found' })
    }
    const page = content.replaceAll('{{FOBO_ORIGIN}}', FOBO_ORIGIN).replaceAll('{{GAME_ORIGIN}}', GAME_ORIGIN)
    res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
    })
    res.end(page)
}

/** The Game Center API, as fobo.fun serves it to other sites. */
async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS)
        res.end()
        return
    }
    const origin = req.headers.origin
    const answer = await api.handle({
        method: req.method ?? 'GET',
        path: url.pathname.slice(API_BASE.length),
        query: url.searchParams,
        headers: req.headers as Record<string, string | undefined>,
        body: await readBody(req),
        // the signed text names the site the player is on, which is the calling page
        host: origin ? new URL(origin).host : undefined,
    })
    send(res, answer.status, answer.body, CORS)
}

/** A site that frames the game: fobo.fun's stand-in, and the stranger (same page, not on the game's allow list). */
async function framingSite(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', FOBO_ORIGIN)
    if (url.pathname.startsWith(API_BASE)) return handleApi(req, res, url)
    if (url.pathname === '/wallet/sign' && req.method === 'POST') {
        // the page's "wallet": signs like an extension would, with a key that never reaches the page
        const { message } = (await readBody(req)) as { message: string }
        return send(res, 200, { address: wallet.address, signature: await wallet.signMessage({ message }) })
    }
    if (url.pathname.startsWith('/sdk/')) return sendFile(res, SDK_DIST, url.pathname.slice('/sdk/'.length))
    return sendFile(res, FIXTURES, 'fobo.html')
}

async function gameSite(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', GAME_ORIGIN)
    if (url.pathname.startsWith('/sdk/')) return sendFile(res, SDK_DIST, url.pathname.slice('/sdk/'.length))
    return sendFile(res, FIXTURES, 'game.html')
}

function listen(port: number, site: (req: IncomingMessage, res: ServerResponse) => Promise<void>): void {
    createServer((req, res) => {
        void (async () => {
            try {
                await site(req, res)
            } catch (err) {
                console.error('[e2e-server]', err)
                send(res, 500, { error: 'Server error' })
            }
        })()
    }).listen(port)
}

listen(FOBO_PORT, framingSite)
listen(STRANGER_PORT, framingSite)
listen(GAME_PORT, gameSite)
