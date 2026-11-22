import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createGame, GameError, highScore } from '../src/index.js'
import { createServerClient } from '../src/serverClient.js'
import {
    createMockApi,
    createTestGame,
    createTestServer,
    TEST_ADDRESS,
    TEST_PUBLIC_KEY,
    TEST_SECRET_KEY,
} from '../src/testing.js'

const NOTICE = /Test mode: no apiKey/

/** A browser's localStorage, enough of it. */
function fakeStorage() {
    const kept = new Map<string, string>()
    return {
        kept,
        getItem: (key: string) => kept.get(key) ?? null,
        setItem: (key: string, value: string) => void kept.set(key, value),
        removeItem: (key: string) => void kept.delete(key),
    }
}

describe('createGame with no apiKey (test mode)', () => {
    let warn: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    })
    afterEach(() => {
        Reflect.deleteProperty(globalThis, 'localStorage')
    })

    it('runs on a Game Center inside the page, says so once, and a key makes it live', async () => {
        const game = createGame()
        createGame({})
        // once per page: this file's first two games share the one notice
        expect(warn.mock.calls.filter((call: unknown[]) => NOTICE.test(String(call[0])))).toHaveLength(1)
        expect(game.isTest).toBe(true)

        const board = await game.submitRun({ name: 'ACE', score: 1200 })
        expect(board.you).toMatchObject({ rank: 1, name: 'ACE', score: 1200 })
        expect(await game.link()).toBe(TEST_ADDRESS)
        expect((await game.config()).game).toBe('test-game')

        const fetch = vi.fn((_url: string) =>
            Promise.resolve(Response.json({ error: 'Unknown game key' }, { status: 401 }))
        )
        const live = createGame({ apiKey: 'pk_live_0123456789', fetch })
        expect(live.isTest).toBe(false)
        await expect(live.config()).rejects.toMatchObject({ status: 401 })
        expect(fetch).toHaveBeenCalledOnce()
        expect(String(fetch.mock.calls[0]?.[0])).toBe('https://fobo.fun/api/games/v1/config')
        // nothing to forget on a live game
        expect(live.resetTestData()).toBeUndefined()
    })

    it('still refuses a key that is there but wrong', () => {
        expect(() => createGame({ apiKey: '' })).toThrow(/public key/)
        expect(() => createGame({ apiKey: TEST_SECRET_KEY })).toThrow(/secret key/)
        expect(() => createGame({ apiKey: null as unknown as string })).toThrow(GameError)
    })

    it("takes the test Game Center's setup from `test`: boards, items, who writes, a replay", async () => {
        const game = createGame({
            test: {
                boards: [highScore('main'), highScore('weekly-best', { periods: ['weekly'] })],
                items: [{ key: 'gold-ship', name: 'Gold ship', kind: 'skin', slot: 'skin' }],
                replay: (_seed, inputs) => (Array.isArray(inputs) ? inputs.length : 0),
            },
        })
        expect((await game.boards()).map((board) => board.key)).toEqual(['main', 'weekly-best'])
        expect((await game.items.catalog()).map((item) => item.key)).toEqual(['gold-ship'])
        expect((await game.config()).writes).toBe('server')
        await game.link()
        const ticket = await game.startRun()
        const board = await game.submitRun({ name: 'ACE', score: 3, run: { ticket: ticket.id, inputs: [1, 1, 1] } })
        expect(board.you?.score).toBe(3)
    })

    it('keeps test data across a page reload, in localStorage under storageKey', async () => {
        const storage = fakeStorage()
        vi.stubGlobal('localStorage', storage)

        const first = createGame({ storageKey: 'mygame' })
        await first.link()
        await first.wallet.setName('Ace')
        await first.submitRun({ name: 'Ace', score: 700 })
        await first.save.set({ level: 4 })
        await first.player.setAvatar(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2])], { type: 'image/png' }))
        expect([...storage.kept.keys()].sort()).toEqual(['mygame', 'mygame:data'])

        // a reload: a new game on the same storage
        const second = createGame({ storageKey: 'mygame' })
        expect(second.wallet.address).toBe(TEST_ADDRESS)
        expect(second.wallet.name).toBe('Ace')
        expect((await second.board()).top.map((row) => [row.name, row.score, row.linked])).toEqual([['Ace', 700, true]])
        expect(await second.save.get()).toEqual({ level: 4 })
        expect((await second.player.get()).avatarSource).toBe('game')
        // the session from before the reload still stands
        expect((await second.submitRun({ name: 'Ace', score: 900 })).you?.score).toBe(900)

        // another game's test data is its own
        expect((await createGame({ storageKey: 'other' }).board()).top).toEqual([])

        second.resetTestData()
        expect(second.wallet.address).toBeNull()
        expect((await second.board()).top).toEqual([])
        expect(storage.kept.has('mygame:data')).toBe(false)
        expect((await createGame({ storageKey: 'mygame' }).board()).top).toEqual([])
    })

    it('lets a setup written in the code win over the one kept, and keeps what players did', async () => {
        vi.stubGlobal('localStorage', fakeStorage())
        const first = createGame({ test: { boards: [highScore('main'), highScore('old')] } })
        await first.submitRun({ name: 'ACE', score: 5 })
        const second = createGame({ test: { boards: [highScore('main'), highScore('new')] } })
        expect((await second.boards()).map((board) => board.key)).toEqual(['main', 'new'])
        expect((await second.board()).top.map((row) => row.score)).toEqual([5])
    })

    it('starts clean when the kept test data cannot be read, or storage is blocked', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const storage = fakeStorage()
        vi.stubGlobal('localStorage', storage)
        storage.kept.set('fobogame:test:data', JSON.stringify({ version: 0, scores: 'nope' }))
        expect((await createGame().board()).top).toEqual([])
        expect(error).toHaveBeenCalledWith('[fobo-game] reading test data', expect.any(String))

        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('blocked')
            },
            setItem: () => {
                throw new Error('blocked')
            },
            removeItem: () => undefined,
        })
        const game = createGame()
        expect((await game.submitRun({ name: 'ACE', score: 9 })).you?.score).toBe(9)
        expect((await game.board()).top).toHaveLength(1)
    })

    it('stays in memory where there is no storage (Node), and createTestGame keeps nothing unless asked', async () => {
        const game = createGame()
        await game.submitRun({ name: 'ACE', score: 1 })
        expect((await createGame().board()).top).toEqual([])

        const storage = fakeStorage()
        vi.stubGlobal('localStorage', storage)
        const test = createTestGame()
        expect(test.isTest).toBe(true)
        await test.submitRun({ name: 'ACE', score: 1 })
        expect([...storage.kept.keys()].filter((key) => key.endsWith(':data'))).toEqual([])
        await createTestGame({ persist: true }).submitRun({ name: 'ACE', score: 2 })
        expect(storage.kept.has('fobogame:test:data')).toBe(true)
        expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(NOTICE))
    })
})

describe('a server has no silent test mode', () => {
    it('throws, naming the fix, when the secret key is missing', () => {
        for (const secretKey of [undefined, '', null]) {
            expect(() =>
                createServerClient({ apiKey: TEST_PUBLIC_KEY, secretKey: secretKey as unknown as string })
            ).toThrow(/needs your secretKey.*createTestServer/)
        }
        expect(() => createServerClient({ apiKey: TEST_PUBLIC_KEY, secretKey: 'pk_wrong' })).toThrow(/secret key/)
    })

    it('createTestServer is the explicit test path: the server client on a mock Game Center', async () => {
        const api = createMockApi()
        const server = createTestServer(api)
        await server.configure({ title: 'Moon Lander', boards: [highScore('main'), highScore('lap')] })
        const game = createTestGame({ game: { fetch: api.fetch } as never })
        expect((await game.config()).title).toBe('Test Game')
        expect((await createTestServer().settings()).title).toBe('Test Game')
        expect((await server.settings()).boards.map((board) => board.key)).toEqual(['main', 'lap'])
        const board = await server.submitScore({ name: 'ACE', score: 10, board: 'lap' })
        expect(board.you?.rank).toBe(1)
    })
})
