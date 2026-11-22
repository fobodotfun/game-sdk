/**
 * What the conformance suite runs against: the SDK's own mock API, or a real Game Center over HTTP (a local
 * fobo.fun, named by the environment). Both are driven by the built SDK, the same way.
 */
import { deflateSync } from 'node:zlib'
import { verifyMessage } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createGame, type FetchLike, type Game } from '@fobo/game-sdk'
import { API_BASE, KEY_HEADER, SESSION_HEADER } from '@fobo/game-sdk/protocol'
import { createServerClient, type ServerClient } from '@fobo/game-sdk/server'
import { createMockApi, TEST_PUBLIC_KEY, TEST_SECRET_KEY } from '@fobo/game-sdk/testing'

/** The game's own site in these tests: the Origin its pages send, and the host the link message names. */
export const DEFAULT_ORIGIN = 'https://game.conformance.test'
/** A site that is not the game's. */
export const FOREIGN_ORIGIN = 'https://stranger.conformance.test'

export interface Target {
    name: string
    /** The API's site (an origin). */
    apiUrl: string
    publicKey: string
    secretKey: string
    /** The game's own origin. */
    origin: string
    /** Whether requests travel over HTTP (then CORS and picture URLs can be checked too). */
    isHttp: boolean
    /** How a page of the game reaches the API (a browser adds the Origin; here the fetch does). */
    pageFetch: FetchLike
    /** How the game's server reaches the API (no Origin). */
    serverFetch: FetchLike
}

/** One answer of a request made without the SDK (for what the SDK refuses to send). */
export interface RawAnswer {
    status: number
    body: { error?: string; code?: string } & Record<string, unknown>
    headers: Headers
}

export interface RawOptions {
    query?: Record<string, string>
    body?: unknown
    /** Bytes sent as they are, with this content type. */
    upload?: { type: string; bytes: Uint8Array<ArrayBuffer> }
    session?: string
    /** Send the secret key, as the game's server does. */
    isServer?: boolean
    publicKey?: string
}

/**
 * A page-like global for the SDK's client in Node: where the page lives, and somewhere to keep the link. No
 * `document`, so the server client still knows it is not in a page.
 */
export function stubPage(origin: string): void {
    const url = new URL(origin)
    const page: Record<string, unknown> = { location: { host: url.host, href: `${url.origin}/`, origin: url.origin } }
    page.parent = page
    page.top = page
    const kept = new Map<string, string>()
    const storage = {
        getItem: (key: string) => kept.get(key) ?? null,
        setItem: (key: string, value: string) => void kept.set(key, value),
        removeItem: (key: string) => void kept.delete(key),
    }
    Object.defineProperty(globalThis, 'window', { value: page, configurable: true })
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
}

/** The SDK's mock API, checking link signatures for real. Call stubPage first: the mock reads the page's host. */
export function mockTarget(origin: string = DEFAULT_ORIGIN): Target {
    const api = createMockApi({
        config: { holdMin: 100 },
        verify: ({ address, signature, message }) =>
            verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` }),
    })
    return {
        name: 'mock',
        apiUrl: 'http://localhost',
        publicKey: TEST_PUBLIC_KEY,
        secretKey: TEST_SECRET_KEY,
        origin,
        isHttp: false,
        pageFetch: api.fetch,
        serverFetch: api.fetch,
    }
}

/** The Game Center named by FOBO_CONFORMANCE_URL, _PK and _SK (and _ORIGIN, one of the game's origins), or null. */
export function siteTarget(env: NodeJS.ProcessEnv = process.env): Target | null {
    const { FOBO_CONFORMANCE_URL: apiUrl, FOBO_CONFORMANCE_PK: publicKey, FOBO_CONFORMANCE_SK: secretKey } = env
    if (!apiUrl || !publicKey || !secretKey) return null
    const origin = env.FOBO_CONFORMANCE_ORIGIN ?? DEFAULT_ORIGIN
    const pageFetch: FetchLike = (input, init = {}) => {
        const headers = new Headers(init.headers)
        headers.set('Origin', origin)
        return fetch(input, { ...init, headers })
    }
    return {
        name: new URL(apiUrl).host,
        apiUrl,
        publicKey,
        secretKey,
        origin,
        isHttp: true,
        pageFetch,
        serverFetch: (input, init) => fetch(input, init),
    }
}

/** A player with a wallet of their own: the SDK's client, linked by a real signature when asked. */
export interface TestPlayer {
    game: Game
    /** The wallet's address, checksummed. */
    address: string
    /** Signs a message with the wallet, as a wallet app would. */
    sign: (message: string) => Promise<string>
}

/** A fresh page of the game, with a new wallet behind its connector. */
export function createPlayer(target: Target, id: string): TestPlayer {
    const account = privateKeyToAccount(generatePrivateKey())
    const game = createGame({
        apiKey: target.publicKey,
        apiUrl: target.apiUrl,
        fetch: target.pageFetch,
        storageKey: `conformance:${target.name}:${id}`,
        connector: {
            sign: async (message) => ({ address: account.address, signature: await account.signMessage({ message }) }),
        },
    })
    return { game, address: account.address, sign: (message) => account.signMessage({ message }) }
}

/** The game's backend. */
export function createServer(target: Target): ServerClient {
    return createServerClient({
        apiKey: target.publicKey,
        secretKey: target.secretKey,
        apiUrl: target.apiUrl,
        fetch: target.serverFetch,
    })
}

/** A request without the SDK: from a page of the game, or from its server. */
export async function raw(target: Target, method: string, path: string, options: RawOptions = {}): Promise<RawAnswer> {
    const { query = {}, body, upload, session, isServer = false, publicKey = target.publicKey } = options
    const search = new URLSearchParams(query).toString()
    const headers: Record<string, string> = { [KEY_HEADER]: publicKey }
    if (session) headers[SESSION_HEADER] = session
    if (isServer) headers.Authorization = `Bearer ${target.secretKey}`
    if (upload) headers['Content-Type'] = upload.type
    else if (body !== undefined) headers['Content-Type'] = 'application/json'
    const send = isServer ? target.serverFetch : target.pageFetch
    const answer = await send(`${target.apiUrl}${API_BASE}${path}${search ? `?${search}` : ''}`, {
        method,
        headers,
        body: upload ? upload.bytes : body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await answer.text()
    return {
        status: answer.status,
        body: text === '' ? {} : (JSON.parse(text) as RawAnswer['body']),
        headers: answer.headers,
    }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
})

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
}

/** A real PNG: a `size` px square of one colour. */
export function pngSquare(size: number, [r, g, b]: [number, number, number]): Uint8Array<ArrayBuffer> {
    const header = new Uint8Array(13)
    const view = new DataView(header.buffer)
    view.setUint32(0, size)
    view.setUint32(4, size)
    header.set([8, 2, 0, 0, 0], 8)
    const row = new Uint8Array(1 + size * 3)
    for (let x = 0; x < size; x++) row.set([r, g, b], 1 + x * 3)
    const pixels = new Uint8Array(row.length * size)
    for (let y = 0; y < size; y++) pixels.set(row, y * row.length)
    const parts = [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(pixels)),
        chunk('IEND', new Uint8Array(0)),
    ]
    const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
        png.set(part, offset)
        offset += part.length
    }
    return png
}
