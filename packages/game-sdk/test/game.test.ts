import { verifyMessage } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { eip1193Connector } from '../src/connectors.js'
import { GameError } from '../src/errors.js'
import { createGame } from '../src/create.js'
import { buildGame } from '../src/game.js'
import { memoryStore } from '../src/storage.js'
import {
    createMockApi,
    createTestGame,
    TEST_ADDRESS,
    TEST_PUBLIC_KEY,
    TEST_SECRET_KEY,
    testConnector,
} from '../src/testing.js'
import type { SavedLink } from '../src/wallet.js'
import { ACCOUNT, recordingFetch, signingProvider } from './helpers.js'

const HOST = 'game.example'

/** A game on the mock API whose links are checked like fobo.fun checks them: a real signature of the real text. */
function realGame(mock: Parameters<typeof createMockApi>[0] = {}, options: { verifyUrl?: string } = {}) {
    const api = createMockApi({
        verify: ({ address, signature, message }) =>
            verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` }),
        ...mock,
    })
    const store = memoryStore<SavedLink>()
    const provider = signingProvider()
    const fetch: typeof api.fetch = (input, init) => {
        const url = new URL(input)
        return url.pathname.endsWith('/link') ? linkFrom(api, init) : api.fetch(input, init)
    }
    const game = buildGame(
        {
            apiKey: TEST_PUBLIC_KEY,
            apiUrl: 'http://localhost',
            fetch,
            connector: eip1193Connector(provider),
            ...options,
        },
        { store, isFramed: false, host: HOST }
    )
    return { game, api, store, provider }
}

/** POST /link as the page on HOST would send it. */
async function linkFrom(api: ReturnType<typeof createMockApi>, init: RequestInit = {}): Promise<Response> {
    const answer = await api.handle({
        method: 'POST',
        path: '/link',
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        body: JSON.parse(String(init.body)) as unknown,
        host: HOST,
    })
    return new Response(JSON.stringify(answer.body), { status: answer.status })
}

describe('createGame', () => {
    it('refuses a secret key, a bad key, a plain-http API and a loose frame origin', () => {
        expect(() => createGame({ apiKey: TEST_SECRET_KEY })).toThrow(/secret key/)
        expect(() => createGame({ apiKey: 'nope' })).toThrow(/public key/)
        expect(() => createGame({ apiKey: TEST_PUBLIC_KEY, apiUrl: 'http://fobo.fun' })).toThrow(/https/)
        expect(() => createGame({ apiKey: TEST_PUBLIC_KEY, frameOrigins: ['https://fobo.fun/x'] })).toThrow(/origins/)
        expect(() => createGame({ apiKey: TEST_PUBLIC_KEY, verifyUrl: 'http://game.example/verify' })).toThrow(/https/)
    })

    it('sends the public key with every request, to the API under apiUrl', async () => {
        const { fetch, requests } = recordingFetch(() => ({ body: { day: '2026-01-01', top: [], you: null } }))
        const game = buildGame({ apiKey: TEST_PUBLIC_KEY, fetch }, { store: memoryStore(), isFramed: false })
        await game.board({ day: '2026-01-01', name: 'ACE' })
        expect(requests[0]?.url).toBe('https://fobo.fun/api/games/v1/board?day=2026-01-01&name=ACE')
        expect(requests[0]?.headers['x-fobo-game-key']).toBe(TEST_PUBLIC_KEY)
    })
})

describe('boards and scores', () => {
    it('posts scores and reads the board back, best score per name', async () => {
        const game = createTestGame()
        await game.submitScore({ name: 'ACE', score: 10 })
        await game.submitScore({ name: 'BOB', score: 30, meta: { coins: 4 } })
        const board = await game.submitScore({ name: 'ACE', score: 5 })
        expect(board.top.map(({ rank, name, score }) => [rank, name, score])).toEqual([
            [1, 'BOB', 30],
            [2, 'ACE', 10],
        ])
        expect(board.you).toMatchObject({ rank: 2, name: 'ACE', linked: false })
        expect((await game.board()).top[0]?.meta).toEqual({ coins: 4 })
    })

    it("surfaces the API's refusals as GameError", async () => {
        const game = createTestGame()
        await expect(game.submitScore({ name: 'bad name!', score: 1 })).rejects.toMatchObject({
            code: 'http',
            status: 400,
        })
        await expect(game.submitScore({ name: 'ACE', score: -1 })).rejects.toBeInstanceOf(GameError)
    })

    it('loads the config once, in milliseconds, and retries after a failure', async () => {
        const api = createMockApi({ now: () => Date.UTC(2026, 0, 1, 12) })
        let isDown = true
        const fetch = vi.fn<typeof api.fetch>((input, init) =>
            isDown ? Promise.reject(new TypeError('offline')) : api.fetch(input, init)
        )
        const game = buildGame(
            { apiKey: TEST_PUBLIC_KEY, apiUrl: 'http://localhost', fetch },
            { store: memoryStore(), isFramed: false }
        )
        await expect(game.config()).rejects.toMatchObject({ code: 'network' })
        isDown = false
        const [first, second] = await Promise.all([game.config(), game.config()])
        expect(first).toBe(second)
        expect(first.dayEndsAt).toBe(Date.UTC(2026, 0, 2))
        expect(fetch).toHaveBeenCalledTimes(2)
    })
})

describe('linking a wallet', () => {
    it('links with one real signature of the link text and keeps the session', async () => {
        const { game, store, provider } = realGame()
        const changes = vi.fn()
        game.wallet.onChange(changes)
        expect(game.wallet.address).toBeNull()
        const address = await game.link()
        expect(address).toBe(ACCOUNT.address.toLowerCase())
        expect(provider.calls).toEqual(['eth_requestAccounts', 'personal_sign'])
        expect(game.wallet).toMatchObject({ address, holds: true, name: null, isFramed: false, isAvailable: true })
        expect(store.get()?.session).toBe(game.wallet.session)
        expect(changes).toHaveBeenCalledTimes(1)
    })

    it('fails when the signature is for another site', async () => {
        const api = createMockApi({
            verify: ({ address, signature, message }) =>
                verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` }),
        })
        // the page says it is on evil.example, the API sees game.example
        const fetch: typeof api.fetch = (input, init) =>
            new URL(input).pathname.endsWith('/link') ? linkFrom(api, init) : api.fetch(input, init)
        const game = buildGame(
            {
                apiKey: TEST_PUBLIC_KEY,
                apiUrl: 'http://localhost',
                fetch,
                connector: eip1193Connector(signingProvider()),
            },
            { store: memoryStore(), isFramed: false, host: 'evil.example' }
        )
        await expect(game.link()).rejects.toMatchObject({ status: 401 })
        expect(game.wallet.address).toBeNull()
    })

    it('uses a nonce once', async () => {
        const api = createMockApi()
        const { body } = await api.handle({
            method: 'GET',
            path: '/link/nonce',
            headers: { 'X-Fobo-Game-Key': TEST_PUBLIC_KEY },
        })
        const link = {
            method: 'POST',
            path: '/link',
            headers: { 'X-Fobo-Game-Key': TEST_PUBLIC_KEY },
            body: { ...(body as object), address: TEST_ADDRESS, signature: '0x00' },
        }
        expect((await api.handle(link)).status).toBe(200)
        expect((await api.handle(link)).status).toBe(401)
    })

    it('shows one prompt when link is called twice at once', async () => {
        const { game, provider } = realGame()
        const [a, b] = await Promise.all([game.link(), game.link()])
        expect(a).toBe(b)
        expect(provider.calls.filter((method) => method === 'personal_sign')).toHaveLength(1)
    })

    it('asks for no nonce when there is no connector', async () => {
        const { fetch, requests } = recordingFetch(() => ({ body: {} }))
        const game = buildGame({ apiKey: TEST_PUBLIC_KEY, fetch }, { store: memoryStore(), isFramed: false })
        expect(game.wallet.isAvailable).toBe(false)
        await expect(game.link()).rejects.toMatchObject({ code: 'config' })
        expect(requests).toHaveLength(0)
    })

    it('takes a connector later, and tells listeners', async () => {
        const game = createTestGame({ game: { connector: undefined } })
        const changes = vi.fn()
        game.wallet.onChange(changes)
        game.useConnector(testConnector())
        expect(changes).toHaveBeenCalledTimes(1)
        expect(await game.link()).toBe(TEST_ADDRESS.toLowerCase())
    })

    it('keeps one broken listener from stopping the others', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const game = createTestGame()
        const later = vi.fn()
        game.wallet.onChange(() => {
            throw new Error('boom')
        })
        const off = game.wallet.onChange(later)
        await game.link()
        expect(later).toHaveBeenCalledTimes(1)
        off()
        game.wallet.unlink()
        expect(later).toHaveBeenCalledTimes(1)
    })
})

describe('a linked player', () => {
    it('sets a name, plays under it, and cannot take a name another wallet owns', async () => {
        const api = createMockApi()
        const make = (address: string) =>
            buildGame(
                {
                    apiKey: TEST_PUBLIC_KEY,
                    apiUrl: 'http://localhost',
                    fetch: api.fetch,
                    connector: testConnector(address),
                },
                { store: memoryStore(), isFramed: false, host: api.host }
            )
        const ace = make(TEST_ADDRESS)
        const bob = make('0x00000000000000000000000000000000000000b0')
        await ace.link()
        await bob.link()
        expect(await ace.wallet.setName('ACE')).toBe('ACE')
        await expect(bob.wallet.setName('ace')).rejects.toMatchObject({ status: 409 })
        await expect(bob.submitScore({ name: 'ACE', score: 9 })).rejects.toMatchObject({ status: 409 })
        const board = await ace.submitScore({ name: 'ignored', score: 7 })
        expect(board.you).toMatchObject({ name: 'ACE', linked: true })
    })

    it('remembers the name the board says the wallet plays under', async () => {
        const game = createTestGame()
        await game.link()
        await game.submitScore({ name: 'ACE', score: 1 })
        expect(game.wallet.name).toBe('ACE')
    })

    it('forgets a session the API no longer knows', async () => {
        const store = memoryStore<SavedLink>()
        store.set({ address: '0x0000…0b0f', session: 'gone', name: 'ACE', holds: true })
        const api = createMockApi()
        const game = buildGame(
            { apiKey: TEST_PUBLIC_KEY, apiUrl: 'http://localhost', fetch: api.fetch },
            { store, isFramed: false }
        )
        expect(game.wallet.address).toBe('0x0000…0b0f')
        await expect(game.submitScore({ name: 'ACE', score: 1 })).rejects.toMatchObject({ status: 401 })
        expect(game.wallet.address).toBeNull()
        expect(store.get()).toBeNull()
    })

    it('ignores a saved value that is not a link', () => {
        const store = memoryStore<SavedLink>()
        store.set({ nope: true } as unknown as SavedLink)
        const game = buildGame({ apiKey: TEST_PUBLIC_KEY, fetch: createMockApi().fetch }, { store, isFramed: false })
        expect(game.wallet.session).toBeNull()
    })

    it('needs a link before a name', async () => {
        await expect(createTestGame().wallet.setName('ACE')).rejects.toMatchObject({ code: 'wallet' })
    })
})

describe('submitRun', () => {
    it('posts straight to the board when the pages write scores', async () => {
        const game = createTestGame()
        const board = await game.submitRun({ name: 'ACE', score: 12, meta: { stars: 5 }, run: { seed: 1 } })
        expect(board.you).toMatchObject({ score: 12, meta: { stars: 5 } })
    })

    it("goes through the game's verifier when its server writes scores", async () => {
        const api = createMockApi({ scoreWrites: 'server' })
        const verifier = recordingFetch(() => ({ body: { ok: true, you: { name: 'ACE' } } }))
        const fetch: typeof api.fetch = (input, init) =>
            input.startsWith('https://game.example') ? verifier.fetch(input, init) : api.fetch(input, init)
        const game = buildGame(
            {
                apiKey: TEST_PUBLIC_KEY,
                apiUrl: 'http://localhost',
                fetch,
                connector: testConnector(),
                verifyUrl: 'https://game.example/api/verify',
            },
            { store: memoryStore(), isFramed: false, host: api.host }
        )
        await game.link()
        const result = await game.submitRun<{ ok: boolean }>({
            name: 'ACE',
            score: 12,
            meta: { stars: 5 },
            run: { ticket: 't', inputs: [1, 2] },
        })
        expect(result.ok).toBe(true)
        expect(verifier.requests[0]?.body).toEqual({
            ticket: 't',
            inputs: [1, 2],
            name: 'ACE',
            claimed: { score: 12, stars: 5 },
            session: game.wallet.session,
        })
        // the verifier never gets the game key
        expect(verifier.requests[0]?.headers['x-fobo-game-key']).toBeUndefined()
        expect(game.wallet.name).toBe('ACE')
        await expect(game.submitScore({ name: 'ACE', score: 99 })).rejects.toMatchObject({ status: 403 })
    })

    it('says so when a server-written game has no verifier', async () => {
        const game = createTestGame({ scoreWrites: 'server' })
        await expect(game.submitRun({ name: 'ACE', score: 1 })).rejects.toMatchObject({ code: 'config' })
    })
})
